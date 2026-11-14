"""Shared helpers for the clipping pipeline: config, DB access, jobs, logging."""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import redis

import db
from config import settings

logger = logging.getLogger("clipping")

CLIP_STREAMS = {
    "ingest": "clip:ingest",
    "render": "clip:render",
    "distribute": "clip:distribute",
    "boost": "clip:boost",
    "track": "clip:track",
}

CLIP_GROUP = "clip-workers"
UPDATES_CHANNEL = "clips:updated"
RENDER_PROGRESS_KEY_PREFIX = "clip:render:progress:"

#: Prefix key heartbeat yang dibaca dashboard (`GET /api/system/status`). Satu
#: key per PID agar beberapa instance tidak saling menimpa — tanpa pemisahan
#: ini, worker kedua menulis heartbeat-nya lalu salah menyimpulkan bahwa tidak
#: ada worker lain dan menandai job yang sedang dikerjakan sebagai gagal.
HEARTBEAT_KEY_PREFIX = "clipping:worker:heartbeat"
HEARTBEAT_TTL_SECONDS = 120


# ── Paths ─────────────────────────────────────────────────────


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class ClipPaths:
    """Direktori kerja pipeline (dibuat otomatis saat pertama dipakai)."""

    root: Path
    sources: Path
    clips: Path
    mutations: Path
    fillers: Path

    @classmethod
    def from_settings(cls) -> "ClipPaths":
        base = Path(settings.clip_work_dir).expanduser()
        if not base.is_absolute():
            base = project_root() / base
        return cls(
            root=base,
            sources=base / "sources",
            clips=base / "clips",
            mutations=base / "mutations",
            fillers=Path(settings.clip_filler_dir).expanduser()
            if Path(settings.clip_filler_dir).is_absolute()
            else project_root() / settings.clip_filler_dir,
        )

    def ensure(self) -> "ClipPaths":
        for folder in (self.root, self.sources, self.clips, self.mutations, self.fillers):
            folder.mkdir(parents=True, exist_ok=True)
        return self


# ── Binary discovery ──────────────────────────────────────────


def which(binary: str) -> str | None:
    """Cari binary di PATH atau di dalam virtualenv worker."""
    found = shutil.which(binary)
    if found:
        return found
    candidate = project_root() / ".venv" / "bin" / binary
    if candidate.exists():
        return str(candidate)
    return None


def has_ffmpeg() -> bool:
    return which("ffmpeg") is not None


def probe_duration(path: str | Path) -> float | None:
    """Durasi media (detik) via `ffprobe`; `None` bila ffprobe tidak tersedia."""
    binary = which("ffprobe")
    if not binary:
        return None
    try:
        output = subprocess.run(
            [
                binary,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=True,
        ).stdout.strip()
        return float(output) if output else None
    except (subprocess.SubprocessError, ValueError, OSError):
        return None


# ── Database helpers ──────────────────────────────────────────


def run(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with db.cursor() as cur:
        cur.execute(sql, params)
        try:
            return cur.fetchall() or []
        except Exception:  # pragma: no cover - statement without result set
            return []


def run_one(sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    rows = run(sql, params)
    return rows[0] if rows else None


def set_source_status(
    source_id: int,
    status: str,
    *,
    error: str | None = None,
    **fields: Any,
) -> None:
    """Update status sumber + kolom tambahan, lalu siarkan ke dashboard."""
    assignments = ["status = %s::clip_source_status", "updated_at = now()"]
    values: list[Any] = [status]
    if error is not None or status in {"pending", "downloading"}:
        assignments.append("error_message = %s")
        values.append(error)
    for column, value in fields.items():
        assignments.append(f"{column} = %s")
        values.append(value)
    values.append(source_id)

    run(
        f"UPDATE clip_sources SET {', '.join(assignments)} WHERE id = %s",
        tuple(values),
    )
    publish_update({"type": "source", "sourceId": source_id, "status": status})


def set_clip_fields(clip_id: int, **fields: Any) -> None:
    if not fields:
        return
    assignments = ", ".join(f"{column} = %s" for column in fields)
    run(
        f"UPDATE generated_clips SET {assignments} WHERE id = %s",
        (*fields.values(), clip_id),
    )
    publish_update({"type": "clip", "clipId": clip_id})


def set_distribution_fields(distribution_id: int, **fields: Any) -> None:
    if not fields:
        return
    assignments = ", ".join(f"{column} = %s" for column in fields)
    run(
        f"UPDATE clip_distributions SET {assignments} WHERE id = %s",
        (*fields.values(), distribution_id),
    )
    publish_update({"type": "distribution", "distributionId": distribution_id})


# ── Redis ─────────────────────────────────────────────────────

_client: redis.Redis | None = None


def redis_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def publish_update(payload: dict[str, Any]) -> None:
    """Siarkan perubahan status ke SSE dashboard (best-effort)."""
    try:
        redis_client().publish(UPDATES_CHANNEL, json.dumps(payload, ensure_ascii=False))
    except redis.RedisError:
        pass


def set_clip_render_progress(
    clip_id: int,
    source_id: int | None,
    stage: str,
    progress: float,
    label: str,
) -> None:
    """Catat & siarkan progres render aktif ke Redis snapshot + Pub/Sub SSE."""
    pct = round(min(100.0, max(0.0, float(progress))), 1)
    updated_at = int(time.time() * 1000)
    payload: dict[str, Any] = {
        "type": "clip",
        "clipId": clip_id,
        "sourceId": source_id,
        "stage": stage,
        "progress": pct,
        "label": label,
        "updatedAt": updated_at,
    }
    key = f"{RENDER_PROGRESS_KEY_PREFIX}{clip_id}"
    try:
        client = redis_client()
        if stage in ("completed", "failed"):
            client.delete(key)
        else:
            client.set(
                key,
                json.dumps(
                    {
                        "stage": stage,
                        "progress": pct,
                        "label": label,
                        "updatedAt": updated_at,
                    },
                    ensure_ascii=False,
                ),
                ex=240,
            )
        client.publish(UPDATES_CHANNEL, json.dumps(payload, ensure_ascii=False))
    except redis.RedisError:
        pass


def worker_capabilities() -> dict[str, Any]:
    """Dependensi yang benar-benar tersedia di proses worker ini."""
    whisper_ready = (
        _module_available("faster_whisper")
        or _module_available("mlx_whisper")
        or bool(settings.clip_whisper_api_url and settings.clip_whisper_api_key)
    )
    return {
        "dryRun": settings.clip_dry_run,
        "whisper": whisper_ready,
        "ytdlp": which("yt-dlp") is not None or _module_available("yt_dlp"),
        "librosa": _module_available("librosa"),
        "ffmpeg": has_ffmpeg(),
        "adb": which("adb") is not None,
    }


def _module_available(name: str) -> bool:
    from importlib.util import find_spec

    try:
        return find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def heartbeat_key(pid: int | None = None) -> str:
    import os

    return f"{HEARTBEAT_KEY_PREFIX}:{pid if pid is not None else os.getpid()}"


def write_heartbeat() -> None:
    """Tulis heartbeat ber-TTL agar dashboard tahu worker hidup + apa isinya."""
    import os
    import socket
    from datetime import datetime, timezone

    payload = {
        "at": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        "host": socket.gethostname(),
        **worker_capabilities(),
    }
    try:
        redis_client().set(
            heartbeat_key(),
            json.dumps(payload, ensure_ascii=False),
            ex=HEARTBEAT_TTL_SECONDS,
        )
    except redis.RedisError:
        pass


def read_heartbeats() -> list[dict[str, Any]]:
    """Semua heartbeat worker yang masih hidup (key ber-TTL)."""
    client = redis_client()
    try:
        keys = list(client.scan_iter(f"{HEARTBEAT_KEY_PREFIX}:*", count=100))
        if not keys:
            return []
        values = client.mget(keys)
    except redis.RedisError:
        return []

    result: list[dict[str, Any]] = []
    for raw in values:
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and payload.get("at"):
            result.append(payload)
    return result


def clear_heartbeat() -> None:
    try:
        redis_client().delete(heartbeat_key())
    except redis.RedisError:
        pass


def publish_job(stream: str, payload: dict[str, Any]) -> None:
    redis_client().xadd(stream, {"payload": json.dumps(payload, ensure_ascii=False)}, maxlen=5000)


# ── Text helpers ──────────────────────────────────────────────


def format_timestamp(seconds: float) -> str:
    """`142.5` → `02:22`."""
    seconds = max(0.0, float(seconds))
    minutes, secs = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def ass_timestamp(seconds: float) -> str:
    """Format waktu ASS: `H:MM:SS.cc`."""
    seconds = max(0.0, float(seconds))
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:d}:{minutes:02d}:{secs:05.2f}"
