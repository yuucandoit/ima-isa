"""Fase B — render klip 9:16 + caption ASS + mutasi hash anti-duplikat.

Mode render:
  * **split_screen**  : video utama 1080x960 (atas) + filler 1080x960 (bawah)
  * **face_reframe**  : 9:16 penuh, crop dinamis mengikuti wajah (MediaPipe
                        bila tersedia, jika tidak crop tengah)
  * **blur_background**: 16:9 di tengah dengan latar gaussian blur

Caption dibakar dari file `.ass` word-by-word (highlight kata aktif).
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import re
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

from config import settings

from .pipeline import (
    ClipPaths,
    ass_timestamp,
    has_ffmpeg,
    probe_duration,
    publish_update,
    run_one,
    set_clip_fields,
    set_clip_render_progress,
    set_source_status,
    which,
)

logger = logging.getLogger("clipping.renderer")

TARGET_W = 1080
TARGET_H = 1920
HALF_H = 960
FILLER_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm"}


def _threads() -> list[str]:
    """Batasi thread FFmpeg agar RAM tidak meledak saat beberapa klip dirender."""
    value = max(1, min(8, int(settings.clip_ffmpeg_threads)))
    return ["-threads", str(value)]


def video_encoder_args() -> list[str]:
    """Pilih encoder video terbaik yang tersedia.

    Di Apple Silicon, `h264_videotoolbox` memindahkan encoding ke Media Engine
    sehingga CPU/RAM utama jauh lebih ringan (terukur ~4x lebih hemat CPU).
    Fallback ke `libx264` bila tidak tersedia (mis. Linux tanpa GPU).
    """
    if settings.clip_hw_encode == "none":
        return ["-c:v", "libx264", "-preset", "veryfast", "-crf", str(random.randint(20, 23))]

    wanted = settings.clip_hw_encode
    encoders = _encoder_names()
    if wanted in ("auto", "videotoolbox") and "h264_videotoolbox" in encoders:
        # `-b:v` lebih andal daripada `-q:v` pada VideoToolbox.
        return ["-c:v", "h264_videotoolbox", "-b:v", "5M", "-allow_sw", "1"]
    if wanted in ("auto", "nvenc") and "h264_nvenc" in encoders:
        return ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "23"]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", str(random.randint(20, 23))]


def _ffmpeg(
    args: list[str],
    timeout: int = 1800,
    *,
    duration: float | None = None,
    progress_cb: Callable[[float], None] | None = None,
) -> None:
    binary = which("ffmpeg") or "ffmpeg"
    if progress_cb is None or not duration or duration <= 0:
        command = [
            binary,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            *_threads(),
            *args,
        ]
        try:
            subprocess.run(command, check=True, timeout=timeout, capture_output=True, text=True)
        except subprocess.TimeoutExpired as error:
            raise RuntimeError(
                f"Render melewati batas waktu {timeout}s. Coba durasi klip lebih pendek "
                "atau preset encoder lebih cepat."
            ) from error
        except subprocess.CalledProcessError as error:
            detail = (error.stderr or "").strip().splitlines()[-3:]
            raise RuntimeError("FFmpeg gagal: " + " | ".join(detail)) from error
        return

    command = [
        binary,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-stats_period",
        "0.2",
        "-progress",
        "pipe:1",
        *_threads(),
        *args,
    ]
    proc = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    deadline = time.monotonic() + timeout
    try:
        assert proc.stdout is not None
        for raw_line in proc.stdout:
            if time.monotonic() > deadline:
                proc.kill()
                raise RuntimeError(
                    f"Render melewati batas waktu {timeout}s. Coba durasi klip lebih pendek "
                    "atau preset encoder lebih cepat."
                )
            line = raw_line.strip()
            if line.startswith("out_time_us="):
                try:
                    us = int(line.split("=", 1)[1])
                    ratio = max(0.0, min(1.0, (us / 1_000_000.0) / duration))
                    progress_cb(ratio)
                except ValueError:
                    pass
            elif line.startswith("out_time_ms="):
                try:
                    us = int(line.split("=", 1)[1])
                    ratio = max(0.0, min(1.0, (us / 1_000_000.0) / duration))
                    progress_cb(ratio)
                except ValueError:
                    pass
        remaining = max(1.0, deadline - time.monotonic())
        returncode = proc.wait(timeout=remaining)
        if returncode != 0:
            stderr_text = proc.stderr.read() if proc.stderr else ""
            detail = stderr_text.strip().splitlines()[-3:]
            raise RuntimeError("FFmpeg gagal: " + " | ".join(detail))
    except subprocess.TimeoutExpired as error:
        proc.kill()
        raise RuntimeError(
            f"Render melewati batas waktu {timeout}s. Coba durasi klip lebih pendek "
            "atau preset encoder lebih cepat."
        ) from error
    finally:
        if proc.stdout:
            proc.stdout.close()
        if proc.stderr:
            proc.stderr.close()


# ── Captions ──────────────────────────────────────────────────

ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,Arial Black,{hook_size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,5,60,60,180,1
Style: Caption,Arial Black,{caption_size},&H00FFFFFF,&H0000E8FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,3,{alignment},60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _escape_ass(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", " ")


def _caption_groups(words: list[dict[str, Any]], chunk: int = 3) -> list[list[dict[str, Any]]]:
    """Kelompokkan kata menjadi 2–3 kata per baris caption."""
    groups: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for word in words:
        current.append(word)
        if len(current) >= chunk or str(word.get("word", "")).endswith((".", "!", "?", ",")):
            groups.append(current)
            current = []
    if current:
        groups.append(current)
    return groups


def build_ass(
    words: list[dict[str, Any]],
    clip_start: float,
    clip_end: float,
    *,
    hook_title: str | None = None,
    alignment: int = 2,
    margin_v: int = 260,
) -> str:
    """Bangun file ASS dengan highlight kata aktif (word-by-word)."""
    header = ASS_HEADER.format(
        width=TARGET_W,
        height=TARGET_H,
        caption_size=76,
        hook_size=58,
        alignment=alignment,
        margin_v=margin_v,
    )
    lines: list[str] = []

    if hook_title:
        hook_end = min(clip_end, clip_start + 3.2)
        lines.append(
            "Dialogue: 0,{start},{end},Hook,,0,0,0,,{{\\an5\\pos({x},{y})\\fad(120,180)}}{text}".format(
                start=ass_timestamp(0.0),
                end=ass_timestamp(hook_end - clip_start),
                x=TARGET_W // 2,
                y=150,
                text=_escape_ass(hook_title.upper()[:70]),
            )
        )

    # Satu event per kata: kata yang sedang diucapkan berwarna aksen, kata yang
    # belum diucapkan diredupkan, kata sebelumnya tetap putih. Ini menghasilkan
    # efek "word-by-word pop" khas caption short-form.
    for group in _caption_groups(words):
        try:
            group_start = max(clip_start, float(group[0].get("start", clip_start)))
            group_end = min(clip_end, float(group[-1].get("end", clip_end)))
        except (TypeError, ValueError):
            continue
        if group_end <= group_start:
            continue

        tokens = [str(word.get("word", "")).strip() for word in group]
        for index, word in enumerate(group):
            try:
                word_start = max(group_start, float(word.get("start", group_start)))
                word_end = min(group_end, float(word.get("end", word_start)))
            except (TypeError, ValueError):
                continue
            if word_end <= word_start:
                continue
            if index + 1 < len(group):
                try:
                    following = max(word_end, float(group[index + 1].get("start", word_end)))
                except (TypeError, ValueError):
                    following = word_end
                event_end = min(group_end, following)
            else:
                event_end = group_end

            pieces: list[str] = []
            for position, token in enumerate(tokens):
                if not token:
                    continue
                escaped = _escape_ass(token)
                if position < index:
                    pieces.append(escaped)
                elif position == index:
                    pieces.append(r"{\c&H0000E8FF&}" + escaped + r"{\c&HFFFFFF&}")
                else:
                    pieces.append(r"{\alpha&H60&}" + escaped + r"{\alpha&H00&}")

            lines.append(
                "Dialogue: 1,{start},{end},Caption,,0,0,0,,{text}".format(
                    start=ass_timestamp(word_start - clip_start),
                    end=ass_timestamp(event_end - clip_start),
                    text=" ".join(pieces),
                )
            )

    return header + "\n".join(lines) + "\n"


def _words_in_range(words: list[dict[str, Any]], start: float, end: float) -> list[dict[str, Any]]:
    return [
        word
        for word in words
        if float(word.get("end", 0)) > start and float(word.get("start", 0)) < end
    ]


def _write_ass(
    words: list[dict[str, Any]],
    start: float,
    end: float,
    target: Path,
    hook_title: str | None,
) -> Path | None:
    selected = _words_in_range(words, start, end)
    if not selected:
        return None
    target.write_text(
        build_ass(selected, start, end, hook_title=hook_title), encoding="utf-8"
    )
    return target


# ── Pillow caption overlay (fallback tanpa libass) ────────────

CAPTION_FONTS = (
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/Library/Fonts/Arial Black.ttf",
    "C:/Windows/Fonts/ariblk.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/opt/homebrew/share/fonts/DejaVuSans-Bold.ttf",
)
MAX_OVERLAY_STATES = 360

_FONT_CACHE: dict[int, Any] = {}

#: Batas waktu membangun track caption (detik). Overlay per-state sangat mahal
#: di build FFmpeg tanpa libass, jadi bila melewati batas ini kita lebih baik
#: merender tanpa caption terbakar (sidecar `.ass` tetap disimpan).
CAPTION_TRACK_TIMEOUT_SECONDS = 90

#: Batas waktu render satu klip (detik). Tanpa batas, FFmpeg bisa menggantung.
RENDER_TIMEOUT_SECONDS = 900

#: Batas waktu potong segmen `-c copy` (detik).
SEGMENT_TIMEOUT_SECONDS = 300


def _caption_font(size: int):
    if size in _FONT_CACHE:
        return _FONT_CACHE[size]
    try:  # pragma: no cover - depends on host fonts
        from PIL import ImageFont  # type: ignore
    except Exception:
        return None
    loaded = None
    for path in CAPTION_FONTS:
        if Path(path).exists():
            try:
                loaded = ImageFont.truetype(path, size)
                break
            except OSError:
                continue
    if loaded is None:
        try:
            loaded = ImageFont.load_default(size)
        except TypeError:  # Pillow < 10
            loaded = ImageFont.load_default()
    _FONT_CACHE[size] = loaded
    return loaded


def _wrap_caption(text: str, limit: int = 18) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        if sum(len(item) + 1 for item in current) + len(word) > limit and current:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    return lines[:3]


def render_caption_png(
    tokens: list[str],
    active: int,
    target: Path,
    *,
    y: int = 1240,
    font_size: int = 78,
) -> bool:
    """Render satu state caption ke PNG transparan berukuran 1080x1920.

    `active` = indeks kata yang sedang diucapkan (warna aksen). Nilai negatif
    berarti "semua putih" (dipakai untuk kartu hook).
    """
    try:  # pragma: no cover - Pillow optional
        from PIL import Image, ImageDraw  # type: ignore
    except Exception:
        return False
    font = _caption_font(font_size)
    if font is None:
        return False

    image = Image.new("RGBA", (TARGET_W, TARGET_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    lines = _wrap_caption(" ".join(token for token in tokens if token))
    line_height = int(font_size * 1.22)
    cursor = y - (len(lines) * line_height) // 2
    position = 0

    for line in lines:
        words = line.split()
        widths = [draw.textlength(word, font=font) for word in words]
        space = draw.textlength(" ", font=font)
        total = sum(widths) + space * max(0, len(words) - 1)
        x = (TARGET_W - total) / 2
        for word, width in zip(words, widths):
            if active < 0 or position < active:
                fill = (255, 255, 255, 255)
            elif position == active:
                fill = (0, 232, 255, 255)  # aksen cyan
            else:
                fill = (168, 168, 175, 255)
            draw.text(
                (x, cursor),
                word,
                font=font,
                fill=fill,
                stroke_width=7,
                stroke_fill=(0, 0, 0, 255),
            )
            x += width + space
            position += 1
        cursor += line_height

    image.save(target, "PNG", compress_level=1)
    return True


def build_hook_overlay(
    hook_title: str | None,
    target: Path,
    duration: float,
) -> tuple[Path, float, float] | None:
    """Render kartu hook terpisah dari track caption kata agar tidak menggeser timing kata."""
    if not hook_title:
        return None
    target.parent.mkdir(parents=True, exist_ok=True)
    tokens = hook_title.upper()[:60].split()
    if not tokens:
        return None
    if render_caption_png(tokens, -1, target, y=170, font_size=64):
        return (target, 0.0, min(3.2, max(0.5, duration)))
    return None


def build_caption_overlays(
    words: list[dict[str, Any]],
    clip_start: float,
    clip_end: float,
    outdir: Path,
    *,
    hook_title: str | None = None,
    y: int = 1240,
    include_hook: bool = True,
    on_progress: Callable[[int, int], None] | None = None,
) -> list[tuple[Path, float, float]]:
    """Daftar `(png, start_local, end_local)` untuk di-overlay saat render.

    Dipakai bila build FFmpeg tidak punya libass. Jika jumlah kata melewati
    `MAX_OVERLAY_STATES`, otomatis beralih ke mode per-frasa (3 kata) agar
    tidak ada kata yang hilang.
    """
    selected = _words_in_range(words, clip_start, clip_end)
    if not selected:
        return []

    overlays: list[tuple[Path, float, float]] = []
    outdir.mkdir(parents=True, exist_ok=True)

    if include_hook and hook_title:
        hook_overlay = build_hook_overlay(
            hook_title, outdir / "hook.png", clip_end - clip_start
        )
        if hook_overlay:
            overlays.append(hook_overlay)

    groups = _caption_groups(selected, chunk=3)
    phrase_only = len(selected) > MAX_OVERLAY_STATES
    total_units = len(groups) if phrase_only else len(selected)

    counter = 0
    for group in groups:
        tokens = [str(word.get("word", "")).strip() for word in group]
        if not any(tokens):
            continue
        try:
            group_start = max(clip_start, float(group[0].get("start", clip_start)))
            group_end = min(clip_end, float(group[-1].get("end", clip_end)))
        except (TypeError, ValueError):
            continue
        if group_end <= group_start:
            continue

        if phrase_only:
            counter += 1
            png = outdir / f"cap_{counter:03d}.png"
            if not render_caption_png(tokens, -1, png, y=y):
                return []
            overlays.append((png, group_start - clip_start, group_end - clip_start))
            if on_progress is not None:
                on_progress(counter, max(counter, total_units))
            continue

        for index, word in enumerate(group):
            try:
                word_start = max(group_start, float(word.get("start", group_start)))
                word_end = min(group_end, float(word.get("end", word_start)))
            except (TypeError, ValueError):
                continue
            if index + 1 < len(group):
                try:
                    following = max(word_end, float(group[index + 1].get("start", word_end)))
                except (TypeError, ValueError):
                    following = word_end
                state_end = min(group_end, following)
            else:
                state_end = group_end
            if state_end <= word_start:
                continue

            counter += 1
            png = outdir / f"cap_{counter:03d}.png"
            if not render_caption_png(tokens, index, png, y=y):
                return []
            overlays.append((png, word_start - clip_start, state_end - clip_start))
            if on_progress is not None:
                on_progress(counter, max(counter, total_units))

    return overlays


def overlay_inputs(overlays: list[tuple[Path, float, float]]) -> list[str]:
    """Argumen `-loop 1 -i` untuk setiap PNG overlay."""
    args: list[str] = []
    for png, _start, _end in overlays:
        args += ["-loop", "1", "-framerate", "30", "-i", str(png)]
    return args


def overlay_filter(
    overlays: list[tuple[Path, float, float]],
    base_label: str,
    input_offset: int = 1,
    label_prefix: str = "ov",
) -> tuple[str, str]:
    """Rantai `overlay` dengan `enable='between(t,start,end)'` per state.

    Mengembalikan `(filter_chain, label_output_terakhir)`. `input_offset` adalah
    indeks input FFmpeg untuk overlay pertama (input #0 selalu video utama,
    filler bila ada menempati #1).
    """
    if not overlays:
        return "", base_label
    chain: list[str] = []
    current = base_label
    for offset, (_png, start, end) in enumerate(overlays):
        output = f"{label_prefix}{offset}"
        chain.append(
            f"[{current}][{input_offset + offset}:v]overlay=0:0:"
            f"enable='between(t,{start:.3f},{end:.3f})'[{output}]"
        )
        current = output
    return ";".join(chain), current


# ── Filler library ────────────────────────────────────────────


def build_caption_track(
    overlays: list[tuple[Path, float, float]],
    target: Path,
    duration: float,
    *,
    scratch: Path | None = None,
) -> Path | None:
    """Bakar state caption menjadi SATU video transparan (qtrle).

    Implementasi sebelumnya merangkai satu `overlay` per state. Biayanya
    kuadratik karena setiap `overlay` memproses ulang seluruh canvas per frame:
    terukur 10 state = 15 s, 20 state = 65 s, 40 state = 241 s — untuk klip 75
    detik dengan ~90 state itu belasan menit.

    Sekarang state dirangkai dengan **concat demuxer** (hanya menyalin frame PNG,
    tanpa compositing): 40 state = 0,9 s. Jedanya diisi frame transparan.
    """
    if not overlays:
        return None
    binary = which("ffmpeg")
    if not binary:
        return None

    scratch = scratch or target.parent
    scratch.mkdir(parents=True, exist_ok=True)

    # Frame transparan penuh untuk mengosongkan caption di antara state.
    empty_png = scratch / "empty.png"
    if not empty_png.exists():
        try:  # pragma: no cover - butuh Pillow
            from PIL import Image  # type: ignore

            Image.new("RGBA", (TARGET_W, TARGET_H), (0, 0, 0, 0)).save(empty_png, "PNG")
        except Exception:
            return None

    lines: list[str] = []
    timeline = 0.0
    last_png: Path | None = None
    for png, raw_start, raw_end in overlays:
        start = max(timeline, float(raw_start))
        end = max(start, float(raw_end))
        if end - start < 0.02:
            continue
        gap = round(start - timeline, 3)
        if gap >= 0.02:
            lines.append(f"file '{empty_png}'")
            lines.append(f"duration {gap:.3f}")
            timeline = round(timeline + gap, 3)
        span = round(max(0.04, end - timeline), 3)
        lines.append(f"file '{png}'")
        lines.append(f"duration {span:.3f}")
        timeline = round(timeline + span, 3)
        last_png = png

    if last_png is None:
        return None

    if duration > timeline + 0.02:
        tail = round(duration - timeline, 3)
        lines.append(f"file '{empty_png}'")
        lines.append(f"duration {tail:.3f}")
        last_png = empty_png
    # `concat` butuh entri terakhir diulang tanpa `duration`.
    lines.append(f"file '{last_png}'")

    list_file = scratch / "captions.txt"
    list_file.write_text("\n".join(lines), encoding="utf-8")

    try:
        subprocess.run(
            [
                binary,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                *_threads(),
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(list_file),
                "-vsync",
                "vfr",
                "-c:v",
                "qtrle",
                "-t",
                f"{max(0.1, duration):.3f}",
                str(target),
            ],
            capture_output=True,
            text=True,
            timeout=CAPTION_TRACK_TIMEOUT_SECONDS,
            check=True,
        )
    except (subprocess.SubprocessError, OSError) as error:
        logger.warning("pembuatan track caption gagal: %s", error)
        return None

    return target if target.exists() and target.stat().st_size > 0 else None


def pick_filler(paths: ClipPaths) -> Path | None:
    """Ambil filler acak dari `assets/filler_library/` (9:16 / 1:1)."""
    if not paths.fillers.exists():
        return None
    assets = [
        item
        for item in paths.fillers.iterdir()
        if item.is_file() and item.suffix.lower() in FILLER_SUFFIXES
    ]
    return random.choice(assets) if assets else None


# ── Filter graphs ─────────────────────────────────────────────

_FILTER_CACHE: set[str] | None = None


def available_filters() -> set[str]:
    """Set nama filter FFmpeg yang tersedia pada build ini.

    Build Homebrew tanpa `libass`/`freetype` tidak punya filter `subtitles`
    maupun `drawtext`; caption tidak bisa dibakar dan cukup disimpan sebagai
    sidecar `.ass`.
    """
    global _FILTER_CACHE
    if _FILTER_CACHE is not None:
        return _FILTER_CACHE
    binary = which("ffmpeg")
    if not binary:
        _FILTER_CACHE = set()
        return _FILTER_CACHE
    try:
        output = subprocess.run(
            [binary, "-hide_banner", "-filters"],
            capture_output=True,
            text=True,
            timeout=30,
        ).stdout
    except (subprocess.SubprocessError, OSError):
        _FILTER_CACHE = set()
        return _FILTER_CACHE
    names: set[str] = set()
    for line in output.splitlines():
        parts = line.split()
        if len(parts) >= 2 and not line.startswith("Filters:"):
            names.add(parts[1])
    _FILTER_CACHE = names
    return names


_ENCODER_CACHE: set[str] | None = None


def _encoder_names() -> set[str]:
    """Daftar encoder yang tersedia (di-cache; `ffmpeg -encoders` ±30 ms)."""
    global _ENCODER_CACHE
    if _ENCODER_CACHE is not None:
        return _ENCODER_CACHE
    binary = which("ffmpeg")
    if not binary:
        _ENCODER_CACHE = set()
        return _ENCODER_CACHE
    try:
        output = subprocess.run(
            [binary, "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=30,
        ).stdout
    except (subprocess.SubprocessError, OSError):
        _ENCODER_CACHE = set()
        return _ENCODER_CACHE
    names: set[str] = set()
    for line in output.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0].startswith("V"):
            names.add(parts[1])
    _ENCODER_CACHE = names
    return names


def supports_subtitles() -> bool:
    return "subtitles" in available_filters() or "ass" in available_filters()


FONT_DIRS = (
    "/System/Library/Fonts",
    "/Library/Fonts",
    "/usr/share/fonts",
    "/usr/local/share/fonts",
)


def _escape_filter_path(path: str) -> str:
    # FFmpeg filter parser memperlakukan ':' dan '\' secara khusus.
    return str(path).replace("\\", "/").replace(":", r"\:").replace("'", r"\'")


def _subtitles_filter(ass_path: Path) -> str:
    """Filter `subtitles` dengan fontsdir yang benar-benar ada di host.

    Nama filter memakai `ass` bila build FFmpeg hanya menyediakan varian itu.
    """
    name = "subtitles" if "subtitles" in available_filters() else "ass"
    fonts = next((folder for folder in FONT_DIRS if Path(folder).exists()), None)
    base = f"{name}={_escape_filter_path(str(ass_path))}"
    if fonts and name == "subtitles":
        base += f":fontsdir={_escape_filter_path(fonts)}"
    return base


def _split_screen_filter(filler: Path | None, offset: float, duration: float) -> str:
    """Stack 1080x960 (utama) + 1080x960 (filler) → `[stacked]`."""
    base = f"[0:v]trim=start={offset}:duration={duration},setpts=PTS-STARTPTS,"
    main = (
        f"{base}scale={TARGET_W}:{HALF_H}:force_original_aspect_ratio=increase,"
        f"crop={TARGET_W}:{HALF_H},setsar=1[top]"
    )
    if filler is not None:
        filler_start = max(0.0, random.uniform(0, 25))
        bottom = (
            f"[1:v]trim=start={filler_start}:duration={duration},setpts=PTS-STARTPTS,"
            f"scale={TARGET_W}:{HALF_H}:force_original_aspect_ratio=increase,"
            f"crop={TARGET_W}:{HALF_H},setsar=1[bottom]"
        )
    else:
        # Tanpa stok filler: pakai versi blur dari video utama sebagai pengganti.
        bottom = (
            f"{base}scale={TARGET_W}:{HALF_H}:force_original_aspect_ratio=increase,"
            f"crop={TARGET_W}:{HALF_H},boxblur=24:2,setsar=1[bottom]"
        )
    return f"{main};{bottom};[top][bottom]vstack=inputs=2[stacked]"


def _blur_background_filter(offset: float, duration: float) -> str:
    """16:9 di tengah + latar gaussian blur → `[stacked]`."""
    base = f"trim=start={offset}:duration={duration},setpts=PTS-STARTPTS"
    return (
        f"[0:v]{base},split=2[bg][fg];"
        f"[bg]scale={TARGET_W}:{TARGET_H}:force_original_aspect_ratio=increase,"
        f"crop={TARGET_W}:{TARGET_H},gblur=sigma=32[blurred];"
        f"[fg]scale={TARGET_W}:-2:force_original_aspect_ratio=decrease[front];"
        f"[blurred][front]overlay=(W-w)/2:(H-h)/2[stacked]"
    )


def _face_reframe_filter(offset: float, duration: float, face_center: float) -> str:
    """Crop 9:16 penuh yang mengikuti pusat wajah (fraksi 0..1 lebar) → `[stacked]`."""
    base = f"trim=start={offset}:duration={duration},setpts=PTS-STARTPTS"
    x = max(0.0, min(1.0, face_center))
    # Skala berdasarkan TINGGI agar frame selalu >= 1920 px sebelum crop 9:16.
    return (
        f"[0:v]{base},scale=-2:{TARGET_H}:force_original_aspect_ratio=increase,"
        f"crop={TARGET_W}:{TARGET_H}:(iw-{TARGET_W})*{x:.4f}:0[stacked]"
    )


def detect_face_center(video: Path, timestamp: float) -> float:
    """MediaPipe opsional; default 0.5 (crop tengah)."""
    try:  # pragma: no cover - mediapipe heavy & optional
        import cv2  # type: ignore
        import mediapipe as mp  # type: ignore

        capture = cv2.VideoCapture(str(video))
        capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
        ok, frame = capture.read()
        capture.release()
        if not ok:
            return 0.5
        height, width = frame.shape[:2]
        detector = mp.solutions.face_detection.FaceDetection(
            model_selection=0, min_detection_confidence=0.4
        )
        result = detector.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        if not result.detections:
            return 0.5
        box = result.detections[0].location_data.relative_bounding_box
        return max(0.0, min(1.0, box.xmin + box.width / 2))
    except Exception:
        return 0.5


# ── Render ────────────────────────────────────────────────────


def nearest_keyframe_before(video: Path, timestamp: float) -> float | None:
    """Cari PTS keyframe video terakhir pada/sebelum `timestamp` via ffprobe."""
    if timestamp <= 0.5:
        return 0.0
    binary = which("ffprobe")
    if not binary:
        return None
    window_start = max(0.0, timestamp - 30.0)
    window_end = timestamp + 0.5
    try:
        proc = subprocess.run(
            [
                binary,
                "-v",
                "error",
                "-read_intervals",
                f"{window_start:.3f}%{window_end:.3f}",
                "-select_streams",
                "v:0",
                "-show_entries",
                "packet=pts_time,flags",
                "-of",
                "csv=p=0",
                str(video),
            ],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    if proc.returncode != 0:
        return None

    best: float | None = None
    for line in proc.stdout.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 2 or "K" not in parts[1]:
            continue
        try:
            pts = float(parts[0])
        except ValueError:
            continue
        if pts <= timestamp + 0.02 and (best is None or pts > best):
            best = pts
    return best


def has_audio_stream(video: Path) -> bool:
    """Cek apakah berkas sumber memiliki stream audio."""
    binary = which("ffprobe")
    if not binary:
        return True
    try:
        proc = subprocess.run(
            [
                binary,
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=index",
                "-of",
                "csv=p=0",
                str(video),
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (subprocess.SubprocessError, OSError):
        return True
    if proc.returncode != 0:
        return False
    return bool(proc.stdout.strip())


def extract_segment(raw_path: Path, start: float, duration: float, target: Path) -> Path:
    """Potong segmen sumber dengan `-c copy` — instan dan nyaris tanpa RAM.

    Tanpa langkah ini, `filter_complex` membaca seluruh video (bisa AV1 1080p
    berdurasi 1 jam) lalu baru memangkasnya, sehingga decode + scaling berjalan
    untuk frame yang akhirnya dibuang. Memotong dulu membuat tahap berat hanya
    menyentuh durasi klip (30–75 detik).
    """
    binary = which("ffmpeg")
    if not binary:
        return raw_path
    if target.exists() and target.stat().st_size > 0:
        return target
    try:
        subprocess.run(
            [
                binary,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{max(0.0, start):.3f}",
                "-i",
                str(raw_path),
                "-t",
                f"{max(0.5, duration):.3f}",
                "-c",
                "copy",
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
                "-avoid_negative_ts",
                "make_zero",
                str(target),
            ],
            capture_output=True,
            text=True,
            timeout=SEGMENT_TIMEOUT_SECONDS,
            check=True,
        )
    except (subprocess.SubprocessError, OSError) as error:
        logger.warning("potong segmen gagal (fallback ke sumber utuh): %s", error)
        return raw_path
    return target if target.exists() and target.stat().st_size > 0 else raw_path


def cleanup_render_scratch(clip_id: int, paths: ClipPaths, *, keep_ass: bool = True) -> None:
    """Hapus artefak sementara render (PNG caption, segmen, track alpha).

    Tanpa ini setiap render meninggalkan ratusan PNG 1080x1920 (~20 KB each)
    plus segmen video, sehingga disk cepat penuh pada pemakaian rutin.
    """
    import shutil

    caps_dir = paths.clips / f"clip_{clip_id}_caps"
    if caps_dir.exists():
        shutil.rmtree(caps_dir, ignore_errors=True)
    for artifact in (
        paths.clips / f"clip_{clip_id}_caps.mov",
        paths.clips / f"clip_{clip_id}_seg.mp4",
    ):
        if artifact.exists():
            try:
                artifact.unlink()
            except OSError:
                pass
    if not keep_ass:
        ass = paths.clips / f"clip_{clip_id}.ass"
        if ass.exists():
            try:
                ass.unlink()
            except OSError:
                pass


def render_clip(
    clip_id: int,
    *,
    render_mode: str | None = None,
    start: float | None = None,
    end: float | None = None,
    filler_asset: str | None = None,
) -> Path | None:
    row = run_one(
        """
        SELECT c.*, s.raw_file_path, s.transcript_json, s.title AS source_title, s.id AS source_id
        FROM generated_clips c
        JOIN clip_sources s ON s.id = c.source_id
        WHERE c.id = %s
        """,
        (clip_id,),
    )
    if not row:
        raise RuntimeError(f"klip #{clip_id} tidak ditemukan")

    mode = render_mode or str(row.get("render_mode") or "split_screen")
    clip_start = float(start if start is not None else row["start_time"])
    clip_end = float(end if end is not None else row["end_time"])
    duration = max(1.0, clip_end - clip_start)
    title_hook = str(row.get("title_hook") or "")

    raw_path = row.get("raw_file_path")
    if not raw_path or not Path(str(raw_path)).exists():
        raise RuntimeError("video sumber belum tersedia; jalankan ingest ulang.")

    words = row.get("transcript_json") or []
    if isinstance(words, str):
        try:
            words = json.loads(words)
        except json.JSONDecodeError:
            words = []

    # Jaga-jaga: `trim=start=` melewati durasi sumber membuat FFmpeg menggantung
    # tanpa frame. Validasi lebih awal dengan ffprobe (dilewati saat dry run,
    # karena artefak sumber hanya placeholder non-video).
    source_duration = None if settings.clip_dry_run else probe_duration(str(raw_path))
    if source_duration:
        if clip_start >= source_duration:
            raise RuntimeError(
                f"start {clip_start:.1f}s melewati durasi sumber "
                f"({source_duration:.1f}s); perbaiki timing klip."
            )
        if clip_end > source_duration:
            clip_end = source_duration
            duration = max(1.0, clip_end - clip_start)

    paths = ClipPaths.from_settings().ensure()
    output = paths.clips / f"clip_{clip_id}.mp4"
    source_id = int(row["source_id"])

    def emit_progress(stage: str, progress: float, label: str) -> None:
        set_clip_render_progress(clip_id, source_id, stage, progress, label)

    if settings.clip_dry_run:
        # Dry run: jangan panggil FFmpeg sama sekali. Sumber bisa berupa
        # placeholder non-video, dan ffmpeg yang terpasang justru akan gagal
        # pada berkas seperti itu. Tulis artefak penanda + sidecar caption
        # agar alur dashboard (render → approve → distribute) tetap teruji.
        output.write_bytes(b"dry-run rendered clip placeholder\n")
        ass_path = _write_ass(
            words, clip_start, clip_end, paths.clips / f"clip_{clip_id}.ass", title_hook
        )
        set_clip_fields(
            clip_id,
            output_file_path=str(output),
            file_hash=hashlib.sha256(output.read_bytes()).hexdigest(),
            filler_asset_used=None,
            render_mode=mode,
            start_time=clip_start,
            end_time=clip_end,
        )
        set_source_status(source_id, "completed", error=None)
        emit_progress("completed", 100.0, "Selesai dirender")
        logger.warning(
            "dry-run: render klip #%s dilewati (mode %s, %.1fs) → %s%s",
            clip_id,
            mode,
            duration,
            output.name,
            " + sidecar .ass" if ass_path else "",
        )
        return output

    if not has_ffmpeg():
        raise RuntimeError("FFmpeg tidak ditemukan di PATH.")

    emit_progress("segment", 8.0, "Memotong segmen presisi keyframe…")

    # Potong segmen dari keyframe tepat sebelum `clip_start` (`-c copy`) lalu trim
    # tepat ke `base_offset = clip_start - kf` di filter graph agar video, audio,
    # dan timestamp transcript tetap sinkron 1:1 tanpa keyframe drift.
    raw_file = Path(str(raw_path))
    seg_path = paths.clips / f"clip_{clip_id}_seg.mp4"
    if seg_path.exists():
        try:
            seg_path.unlink()
        except OSError:
            pass

    kf = nearest_keyframe_before(raw_file, clip_start)
    if kf is not None:
        lead = max(0.0, clip_start - kf)
        # Tambah +2 ms agar `-ss` saat `-c copy` pasti jatuh di keyframe `kf`
        # (menghindari pembulatan ke bawah yang meloncat ke keyframe lebih awal).
        seek_at = min(clip_start, kf + 0.002) if lead > 0.005 else kf
        seg_duration = duration + lead + 1.5
        segment = extract_segment(raw_file, seek_at, seg_duration, seg_path)
        using_segment = segment != raw_file
        base_offset = lead if using_segment else clip_start
    else:
        segment = raw_file
        using_segment = False
        base_offset = clip_start
    base_input = segment

    emit_progress("captions", 12.0, "Menyiapkan kartu hook & caption…")

    ass_path = _write_ass(
        words, clip_start, clip_end, paths.clips / f"clip_{clip_id}.ass", title_hook
    )

    # Pilih jalur caption: `subtitles` (libass) bila tersedia, jika tidak
    # bakarkan state caption jadi SATU track alpha (tanpa menyisipkan hook ke
    # concat caption agar timing kata tidak bergeser +3,2 detik).
    caption_track: Path | None = None
    hook_overlay: tuple[Path, float, float] | None = None
    if ass_path is not None and not supports_subtitles():
        caps_dir = paths.clips / f"clip_{clip_id}_caps"
        hook_overlay = build_hook_overlay(title_hook or None, caps_dir / "hook.png", duration)
        last_cap_emit = [0.0]

        def on_caption_png(done: int, total: int) -> None:
            now = time.monotonic()
            if done == total or now - last_cap_emit[0] >= 0.25:
                last_cap_emit[0] = now
                pct = 12.0 + (done / max(1, total)) * 12.0
                emit_progress("captions", pct, f"Merender caption ({done}/{total})…")

        overlays = build_caption_overlays(
            words,
            clip_start,
            clip_end,
            caps_dir,
            include_hook=False,
            on_progress=on_caption_png,
        )
        if overlays:
            emit_progress("captions", 25.0, "Menggabungkan track caption…")
            # `scratch=caps_dir` agar `captions.txt`/`empty.png` ikut terhapus
            # oleh `cleanup_render_scratch` (tidak menumpuk di folder klip).
            caption_track = build_caption_track(
                overlays,
                paths.clips / f"clip_{clip_id}_caps.mov",
                duration,
                scratch=caps_dir,
            )
        if caption_track:
            logger.info(
                "caption dibakar via 1 track alpha (%d state%s, tanpa libass)",
                len(overlays),
                " + hook" if hook_overlay else "",
            )
        else:
            logger.warning(
                "caption .ass hanya tersimpan sebagai sidecar (%s) — pasang FFmpeg "
                "dengan libass untuk burn-in.",
                ass_path.name,
            )
        ass_path = None

    filler = None
    if mode == "split_screen":
        if filler_asset:
            candidate = paths.fillers / filler_asset
            filler = candidate if candidate.exists() else None
        filler = filler or pick_filler(paths)

    if has_ffmpeg():
        args: list[str] = ["-i", str(base_input)]
        next_input = 1
        if mode == "split_screen" and filler is not None:
            # Loop filler agar durasinya selalu cukup.
            args += ["-stream_loop", "-1", "-i", str(filler)]
            next_input += 1

        caption_input_index: int | None = None
        if caption_track is not None:
            args += ["-i", str(caption_track)]
            caption_input_index = next_input
            next_input += 1

        hook_input_index: int | None = None
        if hook_overlay is not None:
            hook_png, _hook_start, _hook_end = hook_overlay
            args += ["-loop", "1", "-framerate", "30", "-i", str(hook_png)]
            hook_input_index = next_input
            next_input += 1

        if mode == "blur_background":
            graph = _blur_background_filter(base_offset, duration)
        elif mode == "face_reframe":
            center = detect_face_center(
                Path(str(base_input)), base_offset + duration / 2
            )
            graph = _face_reframe_filter(base_offset, duration, center)
        else:
            graph = _split_screen_filter(filler, base_offset, duration)

        # Caption: jalur libass (burn-in langsung di `[stacked]`).
        if ass_path is not None:
            graph += f";[stacked]{_subtitles_filter(ass_path)}[captioned]"
            last = "captioned"
        else:
            last = "stacked"

        if caption_input_index is not None:
            graph += f";[{last}][{caption_input_index}:v]overlay=0:0[captioned]"
            last = "captioned"

        if hook_input_index is not None and hook_overlay is not None:
            _hook_png, hook_start, hook_end = hook_overlay
            graph += (
                f";[{last}][{hook_input_index}:v]overlay=0:0:"
                f"enable='between(t,{hook_start:.3f},{hook_end:.3f})':eof_action=pass[withhook]"
            )
            last = "withhook"

        graph += f";[{last}]format=yuv420p[video]"

        audio_present = has_audio_stream(Path(str(base_input)))
        if audio_present:
            graph += (
                f";[0:a]atrim=start={base_offset:.3f}:duration={duration:.3f},"
                "asetpts=PTS-STARTPTS[audio]"
            )

        args += [
            "-filter_complex",
            graph,
            "-map",
            "[video]",
            *(["-map", "[audio]"] if audio_present else []),
            *video_encoder_args(),
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            "-t",
            f"{duration:.3f}",
            # Opsi OUTPUT: cegah "Too many packets buffered" pada input tak sinkron.
            "-max_muxing_queue_size",
            "1024",
            str(output),
        ]

        emit_progress("encoding", 28.0, "Merender video & caption…")
        last_pct = [28]
        last_sent = [time.monotonic()]

        def on_ffmpeg_progress(ratio: float) -> None:
            pct = int(28 + ratio * 68)
            now = time.monotonic()
            if pct >= 96 or pct >= last_pct[0] + 1 or (now - last_sent[0] >= 0.25 and pct > last_pct[0]):
                last_pct[0] = pct
                last_sent[0] = now
                emit_progress("encoding", float(pct), "Merender video & caption…")

        _ffmpeg(
            args,
            timeout=RENDER_TIMEOUT_SECONDS,
            duration=duration,
            progress_cb=on_ffmpeg_progress,
        )

    emit_progress("finalizing", 98.0, "Menyimpan & memverifikasi klip…")
    cleanup_render_scratch(clip_id, paths, keep_ass=True)

    digest = hashlib.sha256(output.read_bytes()).hexdigest() if output.exists() else None
    set_clip_fields(
        clip_id,
        output_file_path=str(output),
        file_hash=digest,
        filler_asset_used=filler.name if filler else None,
        render_mode=mode,
        start_time=clip_start,
        end_time=clip_end,
    )
    set_source_status(source_id, "completed", error=None)
    emit_progress("completed", 100.0, "Selesai dirender")
    logger.info("✓ render klip #%s (%s, %.1fs) → %s", clip_id, mode, duration, output.name)
    return output


# ── Mutasi hash per akun ──────────────────────────────────────


def mutate_for_account(clip_id: int, account: str, source: Path | None = None) -> Path:
    """Buat varian file unik untuk satu akun (anti-shadowban fingerprint)."""
    paths = ClipPaths.from_settings().ensure()
    input_path = source or (paths.clips / f"clip_{clip_id}.mp4")
    if not input_path.exists():
        if settings.clip_dry_run:
            placeholder = paths.mutations / f"clip_{clip_id}_{_slug(account)}.mp4"
            placeholder.write_bytes(b"")
            return placeholder
        raise RuntimeError(f"file klip tidak ditemukan: {input_path}")

    safety = re.sub(r"[^a-z0-9_-]+", "", account.lower())[:32] or "account"
    output = paths.mutations / f"clip_{clip_id}_{safety}_{random.randint(1000, 9999)}.mp4"

    speed = round(random.uniform(1.005, 1.015), 4)
    brightness = round(random.uniform(0.005, 0.02), 4)
    contrast = round(random.uniform(1.01, 1.03), 4)
    saturation = round(random.uniform(0.99, 1.02), 4)
    crop_pct = random.uniform(0.01, 0.02)
    crf = random.randint(21, 23)

    crop_w = f"iw*{1 - crop_pct:.4f}"
    crop_h = f"ih*{1 - crop_pct:.4f}"
    graph = (
        f"setpts=PTS/{speed},"
        f"crop={crop_w}:{crop_h},scale=trunc(iw/2)*2:trunc(ih/2)*2,"
        f"eq=brightness={brightness}:contrast={contrast}:saturation={saturation}"
    )

    if has_ffmpeg() and not settings.clip_dry_run:
        _ffmpeg(
            [
                "-i",
                str(input_path),
                "-vf",
                graph,
                "-filter:a",
                f"atempo={speed:.4f}",
                "-map_metadata",
                "-1",
                *video_encoder_args(),
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-movflags",
                "+faststart",
                str(output),
            ]
        )
    else:
        # Dry run (atau ffmpeg tidak tersedia): salin artefak sebagai varian.
        output.write_bytes(input_path.read_bytes())

    logger.info("≈ mutasi akun @%s → %s (speed %.3f, crf %s)", account, output.name, speed, crf)
    return output


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9_-]+", "", value.lower())[:32] or "account"


def file_hash(path: Path) -> str | None:
    if not path.exists():
        return None
    return hashlib.sha256(path.read_bytes()).hexdigest()
