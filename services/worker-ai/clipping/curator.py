"""Fase A — kurasi: gabungan heatmap, acoustic peak, dan LLM scoring.

Tiga sinyal objektif digabung menjadi daftar kandidat klip:

1. **Heatmap YouTube** — bagian yang paling sering ditonton ulang.
2. **Acoustic energy (RMS)** — lonjakan emosi: tawa, perdebatan, jeda dramatis.
3. **LLM semantic scoring** — hook 3 detik pertama, kelengkapan cerita, dan
   potensi share. Output dipaksa JSON terstruktur.

Bila LLM belum dikonfigurasi (`LLM_URL`/`LLM_MODEL` kosong), curator memakai
skoring heuristik dari sinyal #1 dan #2 sehingga pipeline tetap berjalan.
"""

from __future__ import annotations

import json
import logging
import math
import re
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from config import settings
from llm import chat_complete, is_configured
from nlp.normalizer import clean_text

from .pipeline import format_timestamp, run, run_one, set_source_status

logger = logging.getLogger("clipping.curator")

WINDOW_SECONDS = 2.0
LLM_CHUNK_SECONDS = 600.0
LLM_CHUNK_OVERLAP_SECONDS = 60.0


@dataclass
class Candidate:
    start: float
    end: float
    score: float
    reason: str
    title: str = ""
    heat: float = 0.0
    energy: float = 0.0


# ── Signal extraction ─────────────────────────────────────────


def _wav_acoustic_peaks(audio_path: str) -> list[tuple[float, float]] | None:
    """Hitung RMS per 2 detik langsung dari `.wav` secara streaming (hemat RAM & <0.1s)."""
    path = Path(audio_path)
    if path.suffix.lower() != ".wav" or not path.exists():
        return None
    try:
        import numpy as np  # type: ignore
    except Exception:
        return None

    try:
        with wave.open(str(path), "rb") as wf:
            channels = wf.getnchannels()
            sample_width = wf.getsampwidth()
            rate = wf.getframerate()
            if channels != 1 or sample_width != 2 or rate <= 0:
                return None

            window_frames = int(rate * WINDOW_SECONDS)
            raw_rms: list[float] = []
            while True:
                raw = wf.readframes(window_frames)
                if not raw:
                    break
                block = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
                if block.size == 0:
                    continue
                raw_rms.append(float(np.sqrt(np.mean(block * block))))
    except (wave.Error, OSError):
        return None

    if not raw_rms:
        return []
    peak = max(raw_rms) or 1.0
    return [
        (round(index * WINDOW_SECONDS, 2), round(value / peak, 4))
        for index, value in enumerate(raw_rms)
    ]


def acoustic_peaks(audio_path: str) -> list[tuple[float, float]]:
    """RMS energy per 2 detik → `(waktu, energi)` ternormalisasi 0..1."""
    fast = _wav_acoustic_peaks(audio_path)
    if fast is not None:
        return fast

    try:  # pragma: no cover - librosa optional & heavy
        import librosa  # type: ignore
        import numpy as np  # type: ignore
    except Exception:
        logger.info("librosa tidak terpasang — sinyal akustik dilewati.")
        return []

    try:
        samples, sr = librosa.load(audio_path, sr=16_000, mono=True)
        hop = int(sr * WINDOW_SECONDS)
        rms = librosa.feature.rms(y=samples, frame_length=hop * 2, hop_length=hop)[0]
        if rms.size == 0:
            return []
        peak = float(np.max(rms)) or 1.0
        return [
            (round(index * WINDOW_SECONDS, 2), round(float(value) / peak, 4))
            for index, value in enumerate(rms)
        ]
    except Exception as error:  # pragma: no cover
        logger.warning("analisis akustik gagal: %s", error)
        return []


def heatmap_score(heatmap: list[dict[str, float]], start: float, end: float) -> float:
    """Rata-rata nilai heatmap pada rentang [start, end]."""
    if not heatmap:
        return 0.0
    values = [
        point["value"]
        for point in heatmap
        if point["endTime"] > start and point["startTime"] < end
    ]
    if not values:
        return 0.0
    return round(sum(values) / len(values), 4)


def energy_score(peaks: list[tuple[float, float]], start: float, end: float) -> float:
    if not peaks:
        return 0.0
    values = [value for moment, value in peaks if start <= moment <= end]
    if not values:
        return 0.0
    return round(sum(values) / len(values), 4)


def transcript_text(words: list[dict[str, Any]], start: float, end: float) -> str:
    return " ".join(
        str(word.get("word", ""))
        for word in words
        if float(word.get("end", 0)) > start and float(word.get("start", 0)) < end
    ).strip()


def transcript_nearest_boundary(words: list[dict[str, Any]], moment: float) -> float:
    """Snap ke batas kata terdekat agar klip tidak memotong di tengah kalimat."""
    if not words:
        return moment
    best = moment
    best_gap = float("inf")
    for word in words:
        for edge in (float(word.get("start", 0)), float(word.get("end", 0))):
            gap = abs(edge - moment)
            if gap < best_gap:
                best, best_gap = edge, gap
    return round(best, 2)


def _snap_sentence_end(
    words: list[dict[str, Any]], min_end: float, target_end: float, max_end: float
) -> float:
    """Cari akhir kalimat terdekat di rentang `[min_end, max_end]` agar tidak terputus."""
    best = target_end
    best_gap = float("inf")
    for word in words:
        w_end = float(word.get("end", 0))
        if w_end < min_end or w_end > max_end:
            continue
        token = str(word.get("word", "")).strip()
        if token.endswith((".", "!", "?")):
            gap = abs(w_end - target_end)
            if gap < best_gap:
                best, best_gap = w_end, gap
    return round(best, 2)


# ── Heuristic candidate generation ────────────────────────────


def heuristic_candidates(
    words: list[dict[str, Any]],
    heatmap: list[dict[str, float]],
    peaks: list[tuple[float, float]],
    duration: float,
    max_clips: int,
) -> list[Candidate]:
    """Sliding window adaptif diskor dari heatmap + energi akustik + kepadatan kata."""
    if duration <= 0:
        return []

    min_len = max(10, settings.clip_min_seconds)
    max_len = max(min_len, min(settings.clip_max_seconds, int(duration)))
    target_len = min(max_len, max(min_len, int(round(min_len + 0.55 * (max_len - min_len)))))
    stride = max(5.0, min_len / 3)
    candidates: list[Candidate] = []

    start = 0.0
    while start + min_len <= duration:
        ideal_end = min(duration, start + target_len)
        end = _snap_sentence_end(
            words,
            min_end=min(duration, start + min_len),
            target_end=ideal_end,
            max_end=min(duration, start + max_len),
        )
        heat = heatmap_score(heatmap, start, end)
        energy = energy_score(peaks, start, end)
        text = transcript_text(words, start, end)
        density = min(1.0, len(text.split()) / max(1.0, (end - start) * 3.2))
        score = 0.55 * heat + 0.30 * energy + 0.15 * density
        if score > 0:
            basis = "heatmap + energi audio" if heat else "energi audio + kepadatan kata"
            candidates.append(
                Candidate(
                    start=round(start, 2),
                    end=round(end, 2),
                    score=round(score * 100, 1),
                    reason=f"[Fallback heuristik] {basis}",
                    heat=heat,
                    energy=energy,
                )
            )
        start += stride

    # Buang kandidat yang tumpang tindih >60% dengan skor lebih tinggi.
    candidates.sort(key=lambda item: item.score, reverse=True)
    selected: list[Candidate] = []
    for candidate in candidates:
        if len(selected) >= max_clips:
            break
        if not _overlaps_existing(candidate, selected, max_ratio=0.6):
            selected.append(candidate)
    return sorted(selected, key=lambda item: item.start)


def _overlaps_existing(
    candidate: Candidate, chosen_list: list[Candidate], *, max_ratio: float = 0.5
) -> bool:
    for chosen in chosen_list:
        intersection = min(candidate.end, chosen.end) - max(candidate.start, chosen.start)
        span = min(candidate.end - candidate.start, chosen.end - chosen.start) or 1
        if intersection / span > max_ratio:
            return True
    return False


# ── LLM scoring ───────────────────────────────────────────────

SYSTEM_PROMPT = """Kamu adalah editor short-form video viral untuk TikTok/Reels/Shorts berbahasa Indonesia.

Tugas: pilih potongan klip terbaik dari transkrip video panjang.

Aturan WAJIB:
1. Kalimat/detik pertama (< 3 detik) harus berupa pertanyaan, pernyataan kontroversial,
   angka mengejutkan, atau pattern interrupt.
2. Setiap klip harus ditutup dengan kalimat selesai/kesimpulan.
3. Durasi ideal {min_seconds}-{max_seconds} detik.
4. Skor virality 1-100 berdasarkan: kekuatan hook, emosi, kontroversi, kelengkapan cerita.
5. `start` dan `end` HARUS angka detik (float) dalam rentang durasi segmen yang diberikan.
6. Jangan membuat klip yang tumpang tindih lebih dari 50%.

Balas HANYA dengan JSON valid berbentuk:
{{"clips":[{{"title":"hook judul maks 80 karakter","start":12.5,"end":68.0,"viralityScore":87,"reasoning":"alasan singkat 1-2 kalimat"}}]}}
Maksimum {max_clips} klip. Tidak ada teks lain di luar JSON."""


def _parse_llm_json(raw: str) -> list[dict[str, Any]]:
    """Ambil array `clips` dari respons yang mungkin dibungkus ```json."""
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    if not text.startswith("{") and not text.startswith("["):
        brace = re.search(r"[\{\[].*[\}\]]", text, re.S)
        if brace:
            text = brace.group(0)
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return []
    if isinstance(payload, dict):
        clips = payload.get("clips") or payload.get("result") or []
    elif isinstance(payload, list):
        clips = payload
    else:
        return []
    return [clip for clip in clips if isinstance(clip, dict)]


def _compact_transcript_lines(words: list[dict[str, Any]]) -> list[tuple[float, str]]:
    """Padatkan transkrip per ~10 detik → daftar `(detik_awal, baris)` agar hemat token."""
    if not words:
        return []
    lines: list[tuple[float, str]] = []
    bucket: list[str] = []
    bucket_start = float(words[0].get("start", 0))
    for word in words:
        bucket.append(str(word.get("word", "")))
        if float(word.get("end", 0)) - bucket_start >= 10:
            lines.append((bucket_start, f"[{format_timestamp(bucket_start)}] ({bucket_start:.1f}s) {' '.join(bucket)}"))
            bucket = []
            bucket_start = float(word.get("end", 0))
    if bucket:
        lines.append((bucket_start, f"[{format_timestamp(bucket_start)}] ({bucket_start:.1f}s) {' '.join(bucket)}"))
    return lines


def _score_llm_window(
    lines: list[tuple[float, str]],
    words: list[dict[str, Any]],
    heatmap: list[dict[str, float]],
    peaks: list[tuple[float, float]],
    win_start: float,
    win_end: float,
    total_duration: float,
    max_clips: int,
) -> list[Candidate]:
    win_lines = [text for moment, text in lines if win_start - 5 <= moment <= win_end]
    if not win_lines:
        return []

    hot = sorted(
        [p for p in heatmap if p["endTime"] >= win_start and p["startTime"] <= win_end],
        key=lambda point: point["value"],
        reverse=True,
    )[:6]
    hot_text = ", ".join(
        f"{format_timestamp(point['startTime'])}/{point['startTime']:.1f}s ({point['value']:.2f})"
        for point in hot
    )
    loud = sorted(
        [(m, v) for m, v in peaks if win_start <= m <= win_end],
        key=lambda item: item[1],
        reverse=True,
    )[:6]
    loud_text = ", ".join(
        f"{format_timestamp(moment)}/{moment:.1f}s ({value:.2f})" for moment, value in loud
    )

    prompt = (
        f"Rentang segmen: {format_timestamp(win_start)} – {format_timestamp(win_end)} "
        f"({win_start:.1f}s – {win_end:.1f}s dari total {total_duration:.1f}s)\n\n"
        f"Segmen paling sering di-replay (heatmap):\n{hot_text or '(tidak tersedia)'}\n\n"
        f"Puncak energi audio (RMS):\n{loud_text or '(tidak tersedia)'}\n\n"
        f"Transkrip:\n" + "\n".join(win_lines)
    )
    system = SYSTEM_PROMPT.format(
        min_seconds=settings.clip_min_seconds,
        max_seconds=settings.clip_max_seconds,
        max_clips=max_clips,
    )

    # Model reasoning butuh headroom token & timeout lebih besar agar jawaban
    # JSON tidak terpotong di tengah chain-of-thought.
    answer, model, _provider = chat_complete(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        timeout=max(settings.llm_timeout, 120),
        max_tokens=max(settings.llm_max_tokens, 6000),
    )

    parsed = _parse_llm_json(answer)
    candidates: list[Candidate] = []
    for clip in parsed:
        try:
            start = float(clip.get("start"))
            end = float(clip.get("end"))
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        start = max(0.0, transcript_nearest_boundary(words, start))
        end = min(total_duration, transcript_nearest_boundary(words, end))
        if end - start < 8:
            continue
        if end - start > settings.clip_max_seconds + 15:
            end = start + settings.clip_max_seconds
        title = clean_text(str(clip.get("title") or "")).strip(" -–—.,\"'")[:80]
        candidates.append(
            Candidate(
                start=round(start, 2),
                end=round(end, 2),
                score=float(clip.get("viralityScore") or 0),
                reason=clean_text(str(clip.get("reasoning") or ""))[:600],
                title=title,
                heat=heatmap_score(heatmap, start, end),
                energy=energy_score(peaks, start, end),
            )
        )
    logger.info("LLM (%s) [%.0f–%.0fs] → %d kandidat", model, win_start, win_end, len(candidates))
    return candidates


def llm_candidates(
    words: list[dict[str, Any]],
    heatmap: list[dict[str, float]],
    peaks: list[tuple[float, float]],
    duration: float,
    max_clips: int,
) -> list[Candidate]:
    if not is_configured() or not words:
        return []

    lines = _compact_transcript_lines(words)
    if not lines:
        return []

    # Video panjang dipecah per jendela ~10 menit agar reasoning LLM tajam,
    # tidak kehabisan max_tokens, dan mencakup seluruh durasi video secara adil.
    windows: list[tuple[float, float]] = []
    if duration <= LLM_CHUNK_SECONDS + 120 and len(lines) <= 85:
        windows.append((0.0, duration))
    else:
        cursor = 0.0
        while cursor < duration:
            end = min(duration, cursor + LLM_CHUNK_SECONDS)
            windows.append((cursor, end))
            if end >= duration:
                break
            cursor = max(cursor + 60.0, end - LLM_CHUNK_OVERLAP_SECONDS)

    per_window = max(2, min(max_clips, math.ceil(max_clips / len(windows)) + 1))
    all_candidates: list[Candidate] = []
    for win_start, win_end in windows:
        try:
            all_candidates.extend(
                _score_llm_window(
                    lines, words, heatmap, peaks, win_start, win_end, duration, per_window
                )
            )
        except Exception as error:  # pragma: no cover - network dependent
            logger.warning(
                "LLM scoring window [%.0f–%.0fs] gagal: %s", win_start, win_end, error
            )

    if not all_candidates:
        return []

    # Gabungkan kandidat antar window: prioritaskan skor tertinggi & hindari overlap >50%.
    all_candidates.sort(key=lambda item: item.score, reverse=True)
    selected: list[Candidate] = []
    for candidate in all_candidates:
        if len(selected) >= max_clips:
            break
        if not _overlaps_existing(candidate, selected, max_ratio=0.5):
            selected.append(candidate)
    return sorted(selected, key=lambda item: item.start)


# ── Entry point ───────────────────────────────────────────────


def curate(source_id: int, max_clips: int | None = None, render_mode: str = "split_screen") -> int:
    """Jalankan kurasi dan simpan hasilnya ke `generated_clips`."""
    row = run_one("SELECT * FROM clip_sources WHERE id = %s", (source_id,))
    if not row:
        raise RuntimeError(f"sumber #{source_id} tidak ditemukan")

    words = row.get("transcript_json") or []
    if isinstance(words, str):
        try:
            words = json.loads(words)
        except json.JSONDecodeError:
            words = []
    heatmap = row.get("heatmap_json") or []
    if isinstance(heatmap, str):
        try:
            heatmap = json.loads(heatmap)
        except json.JSONDecodeError:
            heatmap = []

    duration = float(row.get("duration_seconds") or 0)
    if duration <= 0 and words:
        duration = float(words[-1].get("end") or 0)
    if duration <= 0:
        raise RuntimeError("durasi video tidak diketahui; transkripsi gagal?")

    limit = int(max_clips or settings.clip_max_per_source)
    raw_path = row.get("raw_file_path")
    audio_path = str(raw_path).rsplit(".", 1)[0] + ".wav" if raw_path else ""
    peaks = acoustic_peaks(audio_path) if audio_path else []
    if not peaks:
        logger.info("tanpa sinyal akustik; skor hanya dari heatmap/LLM")

    set_source_status(source_id, "analyzing", error=None)

    candidates = llm_candidates(words, heatmap, peaks, duration, limit)
    if not candidates:
        logger.info("memakai kandidat heuristik untuk sumber #%s", source_id)
        candidates = heuristic_candidates(words, heatmap, peaks, duration, limit)

    if not candidates:
        # Video tanpa transkrip & heatmap: tetap hasilkan potongan merata supaya
        # pengguna mendapat sesuatu untuk dirender/diedit manual.
        span = min(settings.clip_max_seconds, max(15.0, duration))
        step = max(span, duration / max(1, limit))
        cursor = 0.0
        while cursor + 5 < duration and len(candidates) < limit:
            candidates.append(
                Candidate(
                    start=round(cursor, 2),
                    end=round(min(duration, cursor + span), 2),
                    score=50.0,
                    reason="[Fallback otomatis] Potongan merata (tanpa sinyal AI/transkrip).",
                )
            )
            cursor += step

    run("DELETE FROM generated_clips WHERE source_id = %s", (source_id,))
    for candidate in candidates:
        title = (
            candidate.title
            if len(candidate.title) >= 6
            else _hook_title(words, candidate.start, candidate.end)
        )
        run(
            """
            INSERT INTO generated_clips (
                source_id, title_hook, start_time, end_time, virality_score,
                ai_reasoning, render_mode
            ) VALUES (%s, %s, %s, %s, %s, %s, %s::clip_render_mode)
            """,
            (
                source_id,
                title,
                candidate.start,
                candidate.end,
                max(1, min(100, int(round(candidate.score or 50)))),
                candidate.reason,
                render_mode,
            ),
        )

    set_source_status(source_id, "completed", error=None)
    logger.info("✓ kurasi #%s · %d klip", source_id, len(candidates))
    return len(candidates)


def _hook_title(words: list[dict[str, Any]], start: float, end: float) -> str:
    """Judul ringkas dari kalimat pertama klip; fallback ke rentang waktu."""
    buffer: list[str] = []
    length = 0
    for word in words:
        moment = float(word.get("start", 0))
        if moment < start:
            continue
        if moment > start + 12:
            break
        token = str(word.get("word", "")).strip()
        if not token:
            continue
        buffer.append(token)
        length += len(token) + 1
        # Berhenti di batas kalimat atau saat judul cukup panjang.
        if token.endswith((".", "!", "?")) or length >= 70:
            break

    text = clean_text(" ".join(buffer)).strip(" -–—.,")
    if len(text) >= 12:
        if len(text) > 80:
            text = text[:77].rsplit(" ", 1)[0] + "…"
        return text
    return f"Klip {format_timestamp(start)} – {format_timestamp(end)}"
