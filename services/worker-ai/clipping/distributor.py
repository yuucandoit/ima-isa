"""Fase B/C — distribusi ke device farm via ADB + rotasi IP seluler.

Target utama: TikTok, Instagram Reels, dan YouTube Shorts. Bila `adb` /
`uiautomator2` belum tersedia (atau `CLIP_DRY_RUN=true`), worker tetap
menghasilkan varian file per akun dan menandai distribusi sebagai `published`
dengan URL placeholder agar alur dashboard bisa diuji.
"""

from __future__ import annotations

import logging
import random
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import settings

from .pipeline import (
    ClipPaths,
    publish_job,
    run,
    run_one,
    set_distribution_fields,
    which,
)
from .renderer import mutate_for_account

logger = logging.getLogger("clipping.distributor")

PACKAGES = {
    "tiktok": "com.zhiliaoapp.musically",
    "reels": "com.instagram.android",
    "shorts": "com.google.android.youtube",
}


# ── ADB bridge ────────────────────────────────────────────────


class AdbBridge:
    """Wrapper tipis `adb` + mode fallback `uiautomator2`."""

    def __init__(self, serial: str | None) -> None:
        self.serial = serial
        self.binary = which("adb")
        self.available = bool(self.binary) and bool(serial) and not settings.clip_dry_run

    def _run(self, *args: str, timeout: int = 60) -> str:
        if not self.available or not self.binary:
            return ""
        command = [self.binary, "-s", str(self.serial), *args]
        try:
            return subprocess.run(
                command, capture_output=True, text=True, timeout=timeout, check=True
            ).stdout
        except (subprocess.SubprocessError, OSError) as error:
            logger.warning("adb %s gagal: %s", " ".join(args[:2]), error)
            return ""

    def push(self, local: Path, remote: str) -> bool:
        if not self.available:
            return False
        self._run("push", str(local), remote, timeout=600)
        return True

    def open_app(self, package: str) -> None:
        self._run("shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1")

    def tap(self, x: int, y: int) -> None:
        self._run("shell", "input", "tap", str(x), str(y))

    def type_text(self, text: str) -> None:
        safe = text.replace(" ", "%s")
        self._run("shell", "input", "text", safe)

    def swipe(self, x1: int, y1: int, x2: int, y2: int, duration_ms: int = 320) -> None:
        self._run(
            "shell",
            "input",
            "swipe",
            str(x1),
            str(y1),
            str(x2),
            str(y2),
            str(duration_ms),
        )

    def rotate_mobile_ip(self) -> None:
        """Toggle airplane mode untuk mendapatkan IP seluler baru."""
        if not self.available:
            return
        logger.info("↻ rotasi IP seluler via airplane mode")
        self._run("shell", "cmd", "connectivity", "airplane-mode", "enable")
        time.sleep(random.uniform(4, 8))
        self._run("shell", "cmd", "connectivity", "airplane-mode", "disable")
        time.sleep(random.uniform(6, 12))

    def sleep_human(self, minimum: float = 1.0, maximum: float = 4.0) -> None:
        time.sleep(random.uniform(minimum, maximum))


def _caption_text(title: str, clip: dict[str, Any]) -> str:
    hook = (title or "Klip menarik").strip()
    tags = "#fyp #viral #indonesia #shorts"
    return f"{hook[:150]} {tags}"[:240]


# ── Upload flows ──────────────────────────────────────────────


def _upload_tiktok(bridge: AdbBridge, video: Path, caption: str) -> str | None:
    bridge.push(video, f"/sdcard/Movies/{video.name}")
    bridge._run("shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
                "-d", f"file:///sdcard/Movies/{video.name}")
    bridge.open_app(PACKAGES["tiktok"])
    bridge.sleep_human(6, 10)
    bridge.tap(540, 1830)  # tombol "+"
    bridge.sleep_human(3, 6)
    bridge.tap(120, 480)  # pilih galeri
    bridge.sleep_human(3, 5)
    bridge.tap(180, 420)  # video terbaru
    bridge.sleep_human(2, 4)
    bridge.tap(960, 120)  # langkah berikutnya
    bridge.sleep_human(2, 4)
    bridge.tap(540, 640)  # fokus caption
    bridge.sleep_human(1, 2)
    bridge.type_text(caption)
    bridge.sleep_human(1, 3)
    bridge.tap(960, 120)  # posting
    bridge.sleep_human(8, 14)
    return None


def _upload_reels(bridge: AdbBridge, video: Path, caption: str) -> str | None:
    bridge.push(video, f"/sdcard/Movies/{video.name}")
    bridge.open_app(PACKAGES["reels"])
    bridge.sleep_human(7, 12)
    bridge.tap(540, 1830)
    bridge.sleep_human(3, 5)
    bridge.tap(300, 400)
    bridge.sleep_human(2, 4)
    bridge.tap(960, 120)
    bridge.sleep_human(2, 3)
    bridge.type_text(caption)
    bridge.sleep_human(1, 2)
    bridge.tap(960, 120)
    bridge.sleep_human(10, 16)
    return None


def _upload_shorts(bridge: AdbBridge, video: Path, caption: str) -> str | None:
    bridge.push(video, f"/sdcard/Movies/{video.name}")
    bridge.open_app(PACKAGES["shorts"])
    bridge.sleep_human(6, 10)
    bridge.tap(540, 1740)  # tombol buat
    bridge.sleep_human(3, 6)
    bridge.tap(240, 380)
    bridge.sleep_human(2, 4)
    bridge.tap(960, 120)
    bridge.sleep_human(2, 3)
    bridge.type_text(caption)
    bridge.sleep_human(1, 2)
    bridge.tap(960, 120)
    bridge.sleep_human(10, 18)
    return None


UPLOADERS = {
    "tiktok": _upload_tiktok,
    "reels": _upload_reels,
    "shorts": _upload_shorts,
}


def distribute(
    clip_id: int,
    distribution_ids: list[int],
    *,
    enable_viral_trigger: bool = True,
    watch_time_pct: int = 180,
    drip_window_minutes: int = 120,
) -> None:
    """Upload satu klip ke N akun (dengan varian file unik per akun)."""
    clip = run_one(
        "SELECT * FROM generated_clips WHERE id = %s",
        (clip_id,),
    )
    if not clip:
        raise RuntimeError(f"klip #{clip_id} tidak ditemukan")

    base_file = clip.get("output_file_path")
    if not base_file or not Path(str(base_file)).exists():
        raise RuntimeError("file render tidak ditemukan; render klip terlebih dahulu.")

    paths = ClipPaths.from_settings().ensure()
    title = str(clip.get("title_hook") or "")

    for index, distribution_id in enumerate(distribution_ids):
        row = run_one("SELECT * FROM clip_distributions WHERE id = %s", (distribution_id,))
        if not row:
            logger.warning("distribusi #%s hilang, dilewati", distribution_id)
            continue

        account = str(row["account_username"])
        platform = str(row["target_platform"])
        set_distribution_fields(distribution_id, status="uploading")

        try:
            bridge = AdbBridge(row.get("device_serial"))
            bridge.rotate_mobile_ip()

            variant = mutate_for_account(clip_id, account)
            set_distribution_fields(distribution_id, mutated_file_path=str(variant))

            uploader = UPLOADERS.get(platform, _upload_tiktok)
            post_url = uploader(bridge, variant, _caption_text(title, clip))

            post_url = post_url or f"https://{platform}.com/@ujicoba/video/{clip_id}{index}"
            set_distribution_fields(
                distribution_id,
                status="published",
                post_url=post_url,
                published_at=datetime.now(timezone.utc).isoformat(),
            )
            logger.info("✓ publish #%s → %s @%s", distribution_id, platform, account)

            if enable_viral_trigger:
                _schedule_boosts(distribution_id, watch_time_pct, drip_window_minutes)
        except Exception as error:  # pragma: no cover - device dependent
            logger.exception("distribusi #%s gagal: %s", distribution_id, error)
            set_distribution_fields(distribution_id, status="failed")


def _schedule_boosts(distribution_id: int, watch_time_pct: int, drip_window_minutes: int) -> None:
    """Jadwalkan drip-feed bertahap: 1 sesi per 3–12 menit dalam jendela awal."""
    sessions = max(3, min(settings.clip_boost_max_sessions, random.randint(5, 12)))
    delays: list[float] = []
    cursor = 0.0
    while cursor < drip_window_minutes * 60 and len(delays) < sessions:
        cursor += random.uniform(3 * 60, 12 * 60)
        delays.append(round(cursor))
    for delay in delays:
        publish_job(
            "clip:boost",
            {
                "distributionId": distribution_id,
                "sessions": 1,
                "watchTimePct": watch_time_pct,
                "delaySeconds": delay,
            },
        )
    logger.info("⏱ %d sesi boost dijadwalkan untuk distribusi #%s", len(delays), distribution_id)


def retry(distribution_id: int) -> None:
    row = run_one("SELECT clip_id FROM clip_distributions WHERE id = %s", (distribution_id,))
    if not row:
        raise RuntimeError(f"distribusi #{distribution_id} tidak ditemukan")
    distribute(int(row["clip_id"]), [distribution_id])


def summary(distribution_id: int) -> str:
    row = run_one("SELECT * FROM clip_distributions WHERE id = %s", (distribution_id,))
    if not row:
        return f"#{distribution_id} tidak ditemukan"
    return (
        f"#{distribution_id} {row['target_platform']} @{row['account_username']} "
        f"[{row['status']}] {row['views_count']} views"
    )


__all__ = ["AdbBridge", "distribute", "retry", "summary", "PACKAGES"]
