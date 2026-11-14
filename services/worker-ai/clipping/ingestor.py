"""Fase A — ingestion: yt-dlp metadata + heatmap + fast-path subtitle / chunked Whisper."""

from __future__ import annotations

import json
import logging
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import wave
from dataclasses import dataclass
from importlib.util import find_spec
from pathlib import Path
from typing import Any

import requests

from config import settings

from .pipeline import (
    ClipPaths,
    format_timestamp,
    has_ffmpeg,
    probe_duration,
    publish_update,
    run,
    run_one,
    set_source_status,
    which,
)

logger = logging.getLogger("clipping.ingestor")

# Dependensi opsional — diimpor lazily supaya worker tetap bisa start.
try:  # pragma: no cover - environment dependent
    import yt_dlp  # type: ignore
except Exception:  # pragma: no cover
    yt_dlp = None  # type: ignore

try:  # pragma: no cover
    from faster_whisper import WhisperModel  # type: ignore
except Exception:  # pragma: no cover
    WhisperModel = None  # type: ignore

_SILENCE_START_RE = re.compile(r"silence_start:\s*([\d.]+)")
_SILENCE_END_RE = re.compile(r"silence_end:\s*([\d.]+)")

#: Prompt awal ringan agar Whisper tidak salah eja nama/kosakata Indonesia umum.
INDONESIAN_PROMPT = (
    "Transkrip percakapan dan berita berbahasa Indonesia dengan tanda baca yang jelas."
)

MLX_MODEL_MAP = {
    "tiny": "mlx-community/whisper-tiny-mlx",
    "base": "mlx-community/whisper-base-mlx",
    "small": "mlx-community/whisper-small-mlx",
    "medium": "mlx-community/whisper-medium-mlx",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
    "turbo": "mlx-community/whisper-large-v3-turbo",
}


@dataclass
class IngestResult:
    title: str | None
    duration: int | None
    raw_path: str | None
    heatmap: list[dict[str, float]]
    transcript: list[dict[str, Any]]


def _ytdlp_metadata(url: str) -> dict[str, Any]:
    """Ambil metadata + heatmap tanpa mengunduh video."""
    binary = which("yt-dlp")
    if binary:
        command = [binary, "-J", "--no-warnings", "--skip-download", url]
        try:
            output = subprocess.run(
                command, capture_output=True, text=True, timeout=120, check=True
            ).stdout
            return json.loads(output)
        except (subprocess.SubprocessError, json.JSONDecodeError) as error:
            logger.warning("yt-dlp metadata via CLI gagal: %s", error)

    if yt_dlp is None:
        return {}
    options = {"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True}
    try:
        with yt_dlp.YoutubeDL(options) as ydl:  # type: ignore[union-attr]
            payload = ydl.extract_info(url, download=False)
        return dict(payload or {})
    except Exception as error:  # pragma: no cover - network dependent
        logger.warning("yt-dlp metadata gagal: %s", error)
        return {}


def _ytdlp_format_selector(height: int) -> str:
    """Prioritaskan H.264 (`avc1`) agar decode & `-c copy` cepat di semua OS."""
    return (
        f"bestvideo[height<=?{height}][vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/"
        f"bestvideo[height<=?{height}][ext=mp4]+bestaudio[ext=m4a]/"
        f"best[height<=?{height}][ext=mp4]/best[height<=?{height}]/best"
    )


def _download(url: str, target: Path) -> Path | None:
    """Unduh video sumber (mp4, maksimum `clip_ytdlp_max_height`)."""
    if target.exists() and target.stat().st_size > 0:
        return target

    template = str(target.with_suffix("")) + ".%(ext)s"
    height = settings.clip_ytdlp_max_height
    fmt = _ytdlp_format_selector(height)
    binary = which("yt-dlp")
    if binary:
        command = [
            binary,
            "-f",
            fmt,
            "--merge-output-format",
            "mp4",
            "--no-playlist",
            "--no-warnings",
            "-o",
            template,
            url,
        ]
        try:
            subprocess.run(command, capture_output=True, text=True, timeout=3600, check=True)
        except subprocess.CalledProcessError as error:
            # Sertakan stderr yt-dlp: tanpa ini pesan hanya "gagal unduh" dan
            # penyebab asli (video privat, geo-block, butuh login, 403) hilang.
            detail = (error.stderr or error.stdout or "").strip().splitlines()
            logger.warning(
                "yt-dlp download gagal (exit %s): %s",
                error.returncode,
                detail[-1] if detail else "tanpa stderr",
            )
        except (subprocess.SubprocessError, OSError) as error:
            logger.warning("yt-dlp download gagal: %s", error)
    elif yt_dlp is not None:
        options = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "format": fmt,
            "merge_output_format": "mp4",
            "outtmpl": template,
        }
        try:
            with yt_dlp.YoutubeDL(options) as ydl:  # type: ignore[union-attr]
                ydl.download([url])
        except Exception as error:  # pragma: no cover
            logger.warning("yt-dlp download gagal: %s", error)

    candidates = sorted(target.parent.glob(f"{target.stem}.*"))
    for candidate in candidates:
        if candidate.suffix in {".mp4", ".mkv", ".webm", ".mov"}:
            if candidate != target:
                try:
                    shutil.move(str(candidate), str(target))
                except OSError:
                    return candidate
            return target
    return None


# ── Fast-path: subtitle / auto-caption sumber ─────────────────


def _distribute_words_in_span(
    text: str, start_sec: float, end_sec: float
) -> list[dict[str, Any]]:
    """Bagi durasi segmen menjadi estimasi waktu per kata secara proporsional."""
    tokens = [tok for tok in text.split() if tok]
    if not tokens:
        return []
    span = max(0.2, end_sec - start_sec)
    total_chars = sum(max(1, len(tok)) for tok in tokens)
    words: list[dict[str, Any]] = []
    cursor = start_sec
    for token in tokens:
        share = span * (max(1, len(token)) / total_chars)
        word_end = min(end_sec, cursor + share) if end_sec > start_sec else cursor + share
        words.append(
            {
                "start": round(cursor, 3),
                "end": round(max(cursor + 0.05, word_end), 3),
                "word": token,
            }
        )
        cursor = word_end
    return words


def parse_json3_subtitles(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Konversi JSON3 YouTube (`events` + `segs`) ke daftar kata `{start, end, word}`."""
    events = payload.get("events")
    if not isinstance(events, list):
        return []

    words: list[dict[str, Any]] = []
    for index, event in enumerate(events):
        if not isinstance(event, dict):
            continue
        segs = event.get("segs")
        if not isinstance(segs, list) or not segs:
            continue

        start_ms = float(event.get("tStartMs") or 0.0)
        duration_ms = float(event.get("dDurationMs") or 0.0)
        if duration_ms <= 0 and index + 1 < len(events):
            next_start = float((events[index + 1] or {}).get("tStartMs") or start_ms)
            duration_ms = max(300.0, min(5000.0, next_start - start_ms))
        event_end_ms = start_ms + max(200.0, duration_ms)

        has_offsets = any(
            isinstance(seg, dict) and seg.get("tOffsetMs") is not None for seg in segs
        )
        if has_offsets:
            for seg_idx, seg in enumerate(segs):
                if not isinstance(seg, dict):
                    continue
                raw_text = str(seg.get("utf8") or "").replace("\n", " ").strip()
                if not raw_text or (raw_text.startswith("[") and raw_text.endswith("]")):
                    continue
                offset_ms = float(seg.get("tOffsetMs") or 0.0)
                seg_start = (start_ms + offset_ms) / 1000.0
                if seg_idx + 1 < len(segs) and isinstance(segs[seg_idx + 1], dict):
                    next_off = float(segs[seg_idx + 1].get("tOffsetMs") or (offset_ms + 300.0))
                    seg_end = (start_ms + max(offset_ms + 80.0, next_off)) / 1000.0
                else:
                    seg_end = max(seg_start + 0.15, event_end_ms / 1000.0)

                tokens = [tok for tok in raw_text.split() if tok]
                if len(tokens) == 1:
                    words.append(
                        {
                            "start": round(seg_start, 3),
                            "end": round(seg_end, 3),
                            "word": tokens[0],
                        }
                    )
                else:
                    words.extend(_distribute_words_in_span(raw_text, seg_start, seg_end))
        else:
            joined = " ".join(
                str(seg.get("utf8") or "").replace("\n", " ").strip()
                for seg in segs
                if isinstance(seg, dict)
            ).strip()
            if not joined or (joined.startswith("[") and joined.endswith("]")):
                continue
            words.extend(
                _distribute_words_in_span(joined, start_ms / 1000.0, event_end_ms / 1000.0)
            )

    return words


def fetch_source_subtitles(url: str, language: str | None = None) -> list[dict[str, Any]]:
    """Ambil subtitle/auto-caption `json3` via `yt-dlp` agar Whisper bisa dilewati."""
    if not settings.clip_prefer_source_subtitles:
        return []
    binary = which("yt-dlp")
    if not binary:
        return []

    langs: list[str] = []
    for candidate in (language, "id", "en"):
        if candidate and candidate not in langs:
            langs.append(candidate)
    sub_langs = ",".join(langs)

    with tempfile.TemporaryDirectory(prefix="clip_sub_") as tmpdir:
        template = str(Path(tmpdir) / "sub")
        command = [
            binary,
            "--skip-download",
            "--no-playlist",
            "--no-warnings",
            "--write-subs",
            "--write-auto-subs",
            "--sub-format",
            "json3",
            "--sub-langs",
            sub_langs,
            "-o",
            template,
            url,
        ]
        try:
            subprocess.run(command, capture_output=True, text=True, timeout=60, check=False)
        except (subprocess.SubprocessError, OSError) as error:
            logger.debug("yt-dlp subtitle fetch gagal: %s", error)
            return []

        files = sorted(Path(tmpdir).glob("*.json3"))
        if not files:
            return []

        # Prioritaskan urutan bahasa yang diminta pengguna.
        chosen = files[0]
        for lang in langs:
            match = next((file for file in files if f".{lang}." in file.name), None)
            if match is not None:
                chosen = match
                break

        try:
            payload = json.loads(chosen.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []

        words = parse_json3_subtitles(payload)
        if len(words) < 5:
            return []
        logger.info("⚡ fast-path subtitle sumber (%s): %d kata", chosen.name, len(words))
        return words


#: Durasi & transkrip sintetis untuk `CLIP_DRY_RUN=true` (uji alur tanpa
#: yt-dlp/ffmpeg/whisper). Nilainya sengaja jelas-jelas placeholder.
_WHISPER_MODEL: Any | None = None

DRY_RUN_DURATION_SECONDS = 120
DRY_RUN_SENTENCE = (
    "Ini transkrip contoh dari mode dry-run pipeline klip. "
    "Hook pembuka harus singkat dan memancing rasa ingin tahu penonton. "
    "Bagian tengah menjelaskan konteks isu secara ringkas dan faktual. "
    "Penutup memberi kesimpulan yang jelas agar klip terasa utuh."
)


def _dry_run_placeholder(target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_bytes(b"dry-run placeholder video\n")
    return target


def _dry_run_transcript(duration: int) -> list[dict[str, Any]]:
    """Transkrip word-level sintetis agar kurasi & caption tetap bisa diuji."""
    tokens = DRY_RUN_SENTENCE.split()
    words: list[dict[str, Any]] = []
    moment = 0.0
    index = 0
    while moment + 0.4 < duration:
        token = tokens[index % len(tokens)]
        words.append(
            {
                "start": round(moment, 3),
                "end": round(moment + 0.38, 3),
                "word": token,
            }
        )
        moment += 0.4
        index += 1
    return words


def _heatmap_points(payload: dict[str, Any]) -> list[dict[str, float]]:
    """Normalisasi `heatmap` YouTube (`start_time`/`end_time`/`value`)."""
    raw = payload.get("heatmap") or []
    if not isinstance(raw, list):
        return []
    points: list[dict[str, float]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            points.append(
                {
                    "startTime": float(item.get("start_time") or 0),
                    "endTime": float(item.get("end_time") or 0),
                    "value": round(float(item.get("value") or 0), 5),
                }
            )
        except (TypeError, ValueError):
            continue
    return points


# ── Chunking & cross-OS audio decoding ────────────────────────


def audio_duration_seconds(audio_path: Path) -> float:
    """Baca durasi `.wav` secara instan via `wave`; fallback ke `ffprobe`."""
    if audio_path.suffix.lower() == ".wav":
        try:
            with wave.open(str(audio_path), "rb") as wf:
                rate = wf.getframerate() or 16_000
                return wf.getnframes() / float(rate)
        except (wave.Error, OSError):
            pass
    return float(probe_duration(audio_path) or 0.0)


def detect_silences(audio_path: Path) -> list[float]:
    """Cari titik tengah jeda hening via FFmpeg `silencedetect` agar chunk tidak memotong kata."""
    binary = which("ffmpeg")
    if not binary:
        return []
    try:
        stderr = subprocess.run(
            [
                binary,
                "-hide_banner",
                "-nostats",
                "-i",
                str(audio_path),
                "-af",
                "silencedetect=noise=-32dB:d=0.35",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        ).stderr
    except (subprocess.SubprocessError, OSError):
        return []

    midpoints: list[float] = []
    current_start: float | None = None
    for line in stderr.splitlines():
        start_match = _SILENCE_START_RE.search(line)
        if start_match:
            current_start = float(start_match.group(1))
            continue
        end_match = _SILENCE_END_RE.search(line)
        if end_match:
            end_val = float(end_match.group(1))
            start_val = current_start if current_start is not None else end_val
            midpoints.append(round((start_val + end_val) / 2.0, 2))
            current_start = None
    return midpoints


def plan_audio_chunks(
    duration: float,
    chunk_seconds: int = 180,
    silences: list[float] | None = None,
) -> list[tuple[float, float]]:
    """Pecah durasi menjadi rentang `[start, end]`, snap ke jeda hening terdekat."""
    if duration <= 0:
        return []
    if chunk_seconds <= 0 or duration <= chunk_seconds + 20:
        return [(0.0, round(duration, 3))]

    silences = sorted(silences or [])
    chunks: list[tuple[float, float]] = []
    cursor = 0.0
    min_chunk = min(30.0, chunk_seconds * 0.4)
    tolerance = min(25.0, chunk_seconds * 0.25)

    while cursor < duration:
        target = cursor + chunk_seconds
        if target >= duration - 15.0:
            chunks.append((round(cursor, 3), round(duration, 3)))
            break

        split_at = target
        best_gap = float("inf")
        for moment in silences:
            if moment < cursor + min_chunk:
                continue
            if moment > target + tolerance:
                break
            gap = abs(moment - target)
            if gap < best_gap and gap <= tolerance:
                best_gap = gap
                split_at = moment

        chunks.append((round(cursor, 3), round(split_at, 3)))
        cursor = split_at

    return chunks


def _decode_wav_window(audio_path: Path, start: float, end: float | None) -> "Any | None":
    """Baca tepat satu window `.wav` ke float32 mono 16 kHz tanpa memuat seluruh file."""
    if audio_path.suffix.lower() != ".wav":
        return None
    try:
        import numpy as np  # type: ignore
    except Exception:
        return None

    try:
        with wave.open(str(audio_path), "rb") as wf:
            channels = wf.getnchannels()
            sample_width = wf.getsampwidth()
            rate = wf.getframerate()
            total_frames = wf.getnframes()
            if channels != 1 or sample_width != 2 or rate != 16_000:
                return None
            start_frame = max(0, min(total_frames, int(start * rate)))
            end_frame = total_frames if end is None else max(start_frame, min(total_frames, int(end * rate)))
            wf.setpos(start_frame)
            raw = wf.readframes(end_frame - start_frame)
            if not raw:
                return np.zeros(0, dtype=np.float32)
            return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    except (wave.Error, OSError):
        return None


def _decode_to_pcm(audio_path: Path, start: float = 0.0, end: float | None = None) -> "Any":
    """Dekode window audio → numpy float32 mono 16 kHz (fast-path `.wav`, fallback PyAV).

    faster-whisper meneruskan `metadata_errors="ignore"` ke `av.open()`; argumen
    itu dihapus di PyAV ≥ 15 sehingga `WhisperModel.transcribe(path)` gagal dengan
    `open() got an unexpected keyword argument`. Mendekode sendiri membuat kita
    tidak bergantung pada detail internal PyAV versi tertentu.
    """
    wav_pcm = _decode_wav_window(audio_path, start, end)
    if wav_pcm is not None:
        if wav_pcm.size == 0:
            raise RuntimeError("hasil dekode audio kosong")
        return wav_pcm

    try:  # pragma: no cover - butuh PyAV & numpy
        import av  # type: ignore
        import numpy as np  # type: ignore
    except Exception as error:
        raise RuntimeError(f"PyAV/numpy tidak tersedia: {error}") from error

    chunks: list[bytes] = []
    with av.open(str(audio_path)) as container:
        stream = container.streams.audio[0]
        if start > 0 and stream.time_base:
            try:
                container.seek(int(start / float(stream.time_base)), stream=stream)
            except Exception:
                pass
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16_000)
        for frame in container.decode(stream):
            pts_sec = float(frame.pts * stream.time_base) if (frame.pts is not None and stream.time_base) else 0.0
            if pts_sec + 1.0 < start:
                continue
            if end is not None and pts_sec > end:
                break
            for resampled in resampler.resample(frame):
                chunks.append(bytes(resampled.to_ndarray().tobytes()))
        for resampled in resampler.resample(None):
            chunks.append(bytes(resampled.to_ndarray().tobytes()))

    raw = b"".join(chunks)
    if not raw:
        raise RuntimeError("hasil dekode audio kosong")
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


# ── Cross-OS Whisper backend routing ──────────────────────────


def is_apple_silicon() -> bool:
    return sys.platform == "darwin" and platform.machine().lower() in {"arm64", "aarch64"}


def resolve_whisper_backend() -> str:
    """Pilih backend tercepat sesuai OS & konfigurasi: `api` | `mlx` | `faster-whisper`."""
    explicit = settings.clip_whisper_backend
    if explicit in {"api", "mlx", "faster-whisper"}:
        return explicit

    if settings.clip_whisper_api_url and settings.clip_whisper_api_key:
        return "api"
    if is_apple_silicon() and find_spec("mlx_whisper") is not None:
        return "mlx"
    return "faster-whisper"


def _resolve_faster_whisper_device() -> tuple[str, str]:
    """Deteksi CUDA di Windows/Linux dengan aman, fallback ke CPU int8."""
    device = (settings.clip_whisper_device or "auto").strip().lower()
    compute = (settings.clip_whisper_compute or "int8").strip().lower()

    if device == "auto":
        has_cuda = False
        try:
            import ctranslate2  # type: ignore

            has_cuda = int(ctranslate2.get_cuda_device_count()) > 0
        except Exception:
            try:
                import torch  # type: ignore

                has_cuda = bool(torch.cuda.is_available())
            except Exception:
                has_cuda = False
        device = "cuda" if has_cuda else "cpu"

    if device == "cuda":
        if compute in {"auto", ""}:
            compute = "float16"
    else:
        if compute in {"auto", "float16", ""}:
            compute = "int8"

    return device, compute


def _default_cpu_threads() -> int:
    if settings.clip_whisper_cpu_threads > 0:
        return settings.clip_whisper_cpu_threads
    cores = os.cpu_count() or 4
    return max(1, min(4, cores // 2))


def release_whisper(model: Any | None) -> None:
    """Bebaskan model Whisper & cache alokator dari RAM.

    `faster-whisper` memakai CTranslate2 yang menyimpan buffer di native heap,
    jadi `del` saja tidak cukup — perlu `gc.collect()` dan (bila ada) pembersihan
    cache CUDA/Metal. Dipanggil di `finally` agar tetap jalan walau transkripsi gagal.
    """
    global _WHISPER_MODEL
    if model is not None:
        try:
            del model
        except Exception:  # pragma: no cover
            pass
    _WHISPER_MODEL = None
    try:
        import gc

        gc.collect()
    except Exception:  # pragma: no cover
        pass
    try:  # pragma: no cover - hanya bila CUDA
        import torch  # type: ignore

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
    try:  # pragma: no cover - hanya bila Apple Silicon mlx
        import mlx.core as mx  # type: ignore

        mx.metal.clear_cache()
    except Exception:
        pass


def _transcribe_api_chunks(
    audio_path: Path,
    chunks: list[tuple[float, float]],
    language: str | None,
    source_id: int | None = None,
) -> list[dict[str, Any]]:
    """Kirim potongan audio terkompresi ke OpenAI-compatible `/audio/transcriptions`."""
    ffmpeg_bin = which("ffmpeg")
    words: list[dict[str, Any]] = []

    with tempfile.TemporaryDirectory(prefix="clip_wapi_") as tmpdir:
        for index, (chunk_start, chunk_end) in enumerate(chunks, start=1):
            chunk_file = Path(tmpdir) / f"chunk_{index}.mp3"
            if ffmpeg_bin:
                subprocess.run(
                    [
                        ffmpeg_bin,
                        "-y",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-ss",
                        f"{chunk_start:.3f}",
                        "-t",
                        f"{max(0.5, chunk_end - chunk_start):.3f}",
                        "-i",
                        str(audio_path),
                        "-ac",
                        "1",
                        "-ar",
                        "16000",
                        "-b:a",
                        "48k",
                        str(chunk_file),
                    ],
                    check=True,
                    timeout=180,
                )
                upload_path = chunk_file
            else:
                upload_path = audio_path

            with upload_path.open("rb") as handle:
                data: list[tuple[str, str]] = [
                    ("model", settings.clip_whisper_api_model),
                    ("response_format", "verbose_json"),
                    ("timestamp_granularities[]", "word"),
                ]
                if language:
                    data.append(("language", language))
                response = requests.post(
                    settings.clip_whisper_api_url,
                    headers={"Authorization": f"Bearer {settings.clip_whisper_api_key}"},
                    data=data,
                    files={"file": (upload_path.name, handle, "audio/mpeg")},
                    timeout=180,
                )
            if not response.ok:
                raise RuntimeError(f"Whisper API HTTP {response.status_code}: {response.text[:200]}")
            payload = response.json()
            raw_words = payload.get("words") or []
            if raw_words:
                for item in raw_words:
                    text = str(item.get("word") or "").strip()
                    if not text:
                        continue
                    words.append(
                        {
                            "start": round(chunk_start + float(item.get("start") or 0.0), 3),
                            "end": round(chunk_start + float(item.get("end") or 0.0), 3),
                            "word": text,
                        }
                    )
            else:
                for seg in payload.get("segments") or []:
                    seg_text = str(seg.get("text") or "").strip()
                    seg_start = chunk_start + float(seg.get("start") or 0.0)
                    seg_end = chunk_start + float(seg.get("end") or seg_start + 0.5)
                    words.extend(_distribute_words_in_span(seg_text, seg_start, seg_end))

            logger.info("transkrip API chunk %d/%d selesai (%d kata)", index, len(chunks), len(words))
            if source_id is not None:
                publish_update(
                    {
                        "type": "source",
                        "sourceId": source_id,
                        "status": "transcribing",
                        "progress": round(index / max(1, len(chunks)) * 100),
                    }
                )
    return words


def _transcribe_mlx_chunks(
    audio_path: Path,
    chunks: list[tuple[float, float]],
    language: str | None,
    source_id: int | None = None,
) -> list[dict[str, Any]]:
    """Transkripsi via Apple Silicon Metal (`mlx-whisper`) secara bertahap per chunk."""
    import mlx_whisper  # type: ignore

    repo = MLX_MODEL_MAP.get(settings.clip_whisper_model, settings.clip_whisper_model)
    words: list[dict[str, Any]] = []
    prompt = INDONESIAN_PROMPT if (not language or language.startswith("id")) else None

    for index, (chunk_start, chunk_end) in enumerate(chunks, start=1):
        samples = _decode_to_pcm(audio_path, start=chunk_start, end=chunk_end)
        try:
            result = mlx_whisper.transcribe(
                samples,
                path_or_hf_repo=repo,
                language=language or None,
                word_timestamps=True,
                condition_on_previous_text=False,
                initial_prompt=prompt,
            )
            for segment in result.get("segments") or []:
                seg_words = segment.get("words") or []
                if seg_words:
                    for item in seg_words:
                        text = str(item.get("word") or "").strip()
                        if not text:
                            continue
                        words.append(
                            {
                                "start": round(chunk_start + float(item.get("start") or 0.0), 3),
                                "end": round(chunk_start + float(item.get("end") or 0.0), 3),
                                "word": text,
                            }
                        )
                else:
                    words.extend(
                        _distribute_words_in_span(
                            str(segment.get("text") or ""),
                            chunk_start + float(segment.get("start") or 0.0),
                            chunk_start + float(segment.get("end") or 0.0),
                        )
                    )
        finally:
            del samples

        logger.info("transkrip MLX chunk %d/%d selesai (%d kata)", index, len(chunks), len(words))
        if source_id is not None:
            publish_update(
                {
                    "type": "source",
                    "sourceId": source_id,
                    "status": "transcribing",
                    "progress": round(index / max(1, len(chunks)) * 100),
                }
            )
    return words


def transcribe(
    audio_path: Path,
    language: str | None = None,
    *,
    source_id: int | None = None,
) -> list[dict[str, Any]]:
    """Transkrip word-level lintas OS dengan audio chunking agar RAM & CPU ringan."""
    backend = resolve_whisper_backend()
    if backend == "faster-whisper" and WhisperModel is None:
        logger.info("faster-whisper tidak terpasang — transkrip dilewati.")
        return []

    duration = audio_duration_seconds(audio_path)
    chunk_size = max(0, int(settings.clip_whisper_chunk_seconds))
    silences = detect_silences(audio_path) if (duration > chunk_size > 0) else []
    chunks = plan_audio_chunks(duration, chunk_size, silences) if duration > 0 else [(0.0, None)]

    model = None
    try:
        if backend == "api":
            return _transcribe_api_chunks(audio_path, chunks, language, source_id=source_id)

        if backend == "mlx":
            return _transcribe_mlx_chunks(audio_path, chunks, language, source_id=source_id)

        device, compute = _resolve_faster_whisper_device()
        cpu_threads = _default_cpu_threads()
        beam_size = max(1, int(settings.clip_whisper_beam_size))
        logger.info(
            "▶ whisper faster-whisper · model=%s · device=%s (%s) · threads=%d · beam=%d · %d chunk",
            settings.clip_whisper_model,
            device,
            compute,
            cpu_threads,
            beam_size,
            len(chunks),
        )
        model = WhisperModel(
            settings.clip_whisper_model,
            device=device,
            compute_type=compute,
            cpu_threads=cpu_threads,
        )

        prompt = INDONESIAN_PROMPT if (not language or language.startswith("id")) else None
        words: list[dict[str, Any]] = []
        for index, (chunk_start, chunk_end) in enumerate(chunks, start=1):
            samples = _decode_to_pcm(audio_path, start=chunk_start, end=chunk_end)
            try:
                segments, _info = model.transcribe(
                    samples,
                    language=language or None,
                    word_timestamps=True,
                    vad_filter=True,
                    beam_size=beam_size,
                    condition_on_previous_text=False,
                    initial_prompt=prompt,
                )
                for segment in segments:
                    for word in getattr(segment, "words", None) or []:
                        text = str(getattr(word, "word", "")).strip()
                        if not text:
                            continue
                        words.append(
                            {
                                "start": round(chunk_start + float(word.start), 3),
                                "end": round(chunk_start + float(word.end), 3),
                                "word": text,
                            }
                        )
            finally:
                del samples

            logger.info(
                "transkrip chunk %d/%d selesai (%d kata)",
                index,
                len(chunks),
                len(words),
            )
            if source_id is not None:
                publish_update(
                    {
                        "type": "source",
                        "sourceId": source_id,
                        "status": "transcribing",
                        "progress": round(index / max(1, len(chunks)) * 100),
                    }
                )
        return words
    except Exception as error:  # pragma: no cover - model/runtime dependent
        logger.warning("transkripsi (%s) gagal: %s", backend, error)
        return []
    finally:
        # Lepaskan model + buffer sebelum FFmpeg dijalankan. Tanpa ini RAM
        # worker menumpuk (Whisper small ±500 MB) dan render bisa OOM.
        release_whisper(model)


def extract_audio(video_path: Path) -> Path | None:
    """Ekstrak audio mono 16 kHz untuk Whisper + analisis akustik."""
    if not has_ffmpeg():
        return None
    target = video_path.with_suffix(".wav")
    if target.exists() and target.stat().st_size > 0:
        return target
    try:
        # `-vn` penting: tanpa itu FFmpeg tetap membuka & mendekode stream video
        # (sumber bisa AV1 1080p) sehingga ekstraksi audio memakan RAM/CPU besar.
        subprocess.run(
            [
                which("ffmpeg") or "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(video_path),
                "-vn",
                "-acodec",
                "pcm_s16le",
                "-ac",
                "1",
                "-ar",
                "16000",
                str(target),
            ],
            check=True,
            timeout=1800,
        )
        return target
    except (subprocess.SubprocessError, OSError) as error:
        logger.warning("ekstraksi audio gagal: %s", error)
        return None


def _missing_ytdlp_message() -> str:
    """Pesan actionable saat yt-dlp tidak terpasang sama sekali.

    Tanpa ini pengguna hanya melihat "Gagal mengunduh video sumber (yt-dlp)",
    yang terlihat seperti masalah jaringan padahal dependensinya memang tidak
    ada. Sertakan perintah pemasangannya.
    """
    return (
        "yt-dlp belum terpasang, jadi video tidak bisa diunduh. Pasang dengan "
        "`bun run worker:setup:clip`, atau jalankan worker dengan "
        "CLIP_DRY_RUN=true untuk menguji alur tanpa unduhan."
    )


def _claim_source(source_id: int) -> bool:
    """Ambil kepemilikan pemrosesan sumber ini.

    Mengembalikan `False` bila job lain sudah memegangnya (status aktif) atau
    sumber sudah selesai — duplikat job dari klik ganda / retry tidak boleh
    mengulang unduhan dan menimpa hasil yang sudah baik. Retry manual lewat
    API menyetel status ke `pending` lebih dulu, jadi tetap bisa diproses.
    """
    row = run_one(
        """
        UPDATE clip_sources
        SET status = 'downloading', error_message = NULL, updated_at = now()
        WHERE id = %s AND status NOT IN ('downloading', 'transcribing', 'analyzing', 'completed')
        RETURNING id
        """,
        (source_id,),
    )
    return row is not None


def ingest(job: dict[str, Any]) -> None:
    """Entry point job `clip:ingest`."""
    source_id = int(job["sourceId"])
    url = str(job["url"])
    language = job.get("language") or None
    paths = ClipPaths.from_settings().ensure()

    # Idempotensi: beberapa job untuk sumber yang sama bisa masuk antrean
    # (klik ganda, retry, restart worker). Hanya job pertama yang memproses;
    # sisanya dilewati agar tidak mengunduh/menimpa hasil yang sama.
    if not _claim_source(source_id):
        logger.info("ingest #%s dilewati: sudah diproses job lain", source_id)
        return

    logger.info("▶ ingest #%s %s", source_id, url)
    set_source_status(source_id, "downloading", error=None)

    payload = _ytdlp_metadata(url)
    heatmap = _heatmap_points(payload)
    title = payload.get("title") or payload.get("fulltitle")
    duration = payload.get("duration")
    duration_seconds = int(duration) if isinstance(duration, (int, float)) else None

    run(
        """
        UPDATE clip_sources
        SET title = COALESCE(%s, title),
            duration_seconds = COALESCE(%s, duration_seconds),
            heatmap_json = %s::jsonb,
            updated_at = now()
        WHERE id = %s
        """,
        (
            title,
            duration_seconds,
            json.dumps(heatmap) if heatmap else None,
            source_id,
        ),
    )

    target = paths.sources / f"source_{source_id}.mp4"
    raw_path = _download(url, target)
    audio: Path | None = None
    if raw_path is None and settings.clip_dry_run:
        # Dry run: sediakan artefak placeholder + transkrip sintetis supaya
        # kurasi, render, dan distribusi bisa diuji tanpa jaringan.
        raw_path = _dry_run_placeholder(target)
        duration_seconds = duration_seconds or DRY_RUN_DURATION_SECONDS
        transcript = _dry_run_transcript(duration_seconds)
        logger.warning(
            "dry-run: unduhan dilewati untuk #%s, memakai placeholder %ss",
            source_id,
            duration_seconds,
        )
    elif raw_path is None:
        raise RuntimeError(
            _missing_ytdlp_message()
            if which("yt-dlp") is None and yt_dlp is None
            else "Gagal mengunduh video sumber (yt-dlp). Periksa log worker untuk detail "
            "dari yt-dlp — biasanya video privat, geo-block, atau butuh login."
        )
    elif settings.clip_dry_run:
        # Placeholder dari ingest sebelumnya BUKAN video valid. Memanggil
        # ffmpeg di sini gagal (exit 183) lalu menimpa transkrip sintetis
        # dengan `None` sehingga kurasi kehilangan sinyal.
        transcript = _dry_run_transcript(duration_seconds or DRY_RUN_DURATION_SECONDS)
        duration_seconds = duration_seconds or DRY_RUN_DURATION_SECONDS
    else:
        set_source_status(source_id, "transcribing")
        audio = extract_audio(raw_path)
        transcript = fetch_source_subtitles(url, language)
        if not transcript and audio:
            transcript = transcribe(audio, language, source_id=source_id)
        if audio and not duration_seconds:
            duration_seconds = int(audio_duration_seconds(audio) or 0) or None

    run(
        "UPDATE clip_sources SET raw_file_path = %s, updated_at = now() WHERE id = %s",
        (str(raw_path), source_id),
    )

    run(
        """
        UPDATE clip_sources
        SET transcript_json = %s::jsonb,
            duration_seconds = COALESCE(%s, duration_seconds),
            status = 'analyzing',
            updated_at = now()
        WHERE id = %s
        """,
        (json.dumps(transcript) if transcript else None, duration_seconds, source_id),
    )
    if not transcript and not settings.clip_dry_run and audio:
        # Transkrip kosong padahal audio ada: hampir selalu berarti dependensi
        # (Whisper/PyAV) bermasalah. Tanpa peringatan ini klip tetap dihasilkan
        # tetapi tanpa caption dan skor kurasi jadi asal-asalan.
        logger.warning(
            "⚠ ingest #%s: audio ada tapi transkrip kosong — cek faster-whisper/PyAV "
            "(lihat pesan peringatan di atas). Klip akan dibuat tanpa caption.",
            source_id,
        )

    logger.info(
        "✓ ingest #%s · %s · %d kata · %d titik heatmap",
        source_id,
        format_timestamp(duration_seconds or 0),
        len(transcript),
        len(heatmap),
    )


def source_row(source_id: int) -> dict[str, Any] | None:
    return run_one("SELECT * FROM clip_sources WHERE id = %s", (source_id,))
