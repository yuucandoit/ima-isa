"""Fase C — viral trigger engine dengan perilaku manusia.

Prinsip (lihat `clip.plan.md` §4 Fase C):

1. **Tanpa closed-loop mass following** — akun internal tidak saling follow.
2. **Search-to-watch** — scroll FYP 2–3 video → tab Search → cari username /
   keyword → buka video dari hasil pencarian. Ini meniru sumber trafik organik
   dan menghindari pola "direct link" yang mudah terdeteksi.
3. **Retention weighting** — tonton 150–220% durasi (1x penuh + loop), simpan
   (60%), copy link (40%), dan like di akhir (80%).
4. **Drip-feed jitter** — jeda acak normal 3–12 menit, rotasi IP seluler antar
   sesi.

Semua aksi memakai `AdbBridge`; tanpa perangkat tersedia, sesi dicatat sebagai
"simulasi" agar statistik dan alur tetap konsisten.
"""

from __future__ import annotations

import logging
import random
import time
from datetime import datetime, timezone
from typing import Any

from config import settings

from .distributor import AdbBridge, PACKAGES
from .pipeline import run, run_one, set_distribution_fields

logger = logging.getLogger("clipping.viral")

# Probabilitas aksi interaksi (persen).
P_SAVE = 0.60
P_COPY_LINK = 0.40
P_LIKE = 0.80
P_COMMENT = 0.12


def _gaussian_delay(mean: float = 7.0, stdev: float = 2.5) -> float:
    """Jeda antar interaksi (menit) — distribusi normal, dibatasi 3–12 menit."""
    minutes = random.gauss(mean, stdev)
    return max(3.0, min(12.0, minutes)) * 60


def _watch_duration(video_seconds: float, watch_time_pct: float) -> float:
    """Durasi tonton target: 150–220% dari durasi video."""
    pct = max(150.0, min(220.0, watch_time_pct)) / 100.0
    return video_seconds * pct


def _search_to_watch(
    bridge: AdbBridge,
    platform: str,
    account: str,
    keyword: str | None,
) -> None:
    """Simulasi sumber trafik pencarian (bukan direct link)."""
    package = PACKAGES.get(platform, PACKAGES["tiktok"])
    bridge.open_app(package)
    bridge.sleep_human(4, 8)

    # 1) Scroll FYP 2–3 video lebih dulu.
    for _ in range(random.randint(2, 3)):
        bridge.swipe(540, 1500, 540, 500, random.randint(220, 420))
        bridge.sleep_human(3, 9)

    # 2) Buka tab Search.
    bridge.tap(900, 1830)
    bridge.sleep_human(2, 4)

    # 3) Ketik keyword atau username.
    query = (keyword or account).lstrip("@")
    bridge.tap(300, 160)
    bridge.sleep_human(1, 2)
    bridge.type_text(query)
    bridge.sleep_human(2, 4)

    # 4) Buka hasil pertama.
    bridge.tap(300, 400)
    bridge.sleep_human(3, 7)


def _retention_cycle(bridge: AdbBridge, watch_seconds: float) -> None:
    """Tonton penuh + loop parsial untuk mencapai 150–220% watch time."""
    bridge.sleep_human(watch_seconds * 0.45, watch_seconds * 0.55)
    # Loop: geser kembali ke awal video (replay).
    bridge.swipe(540, 500, 540, 1500, 300)
    bridge.sleep_human(watch_seconds * 0.35, watch_seconds * 0.45)


def _interact(bridge: AdbBridge) -> dict[str, bool]:
    """Like / save / copy-link / comment dengan probabilitas manusiawi."""
    actions = {"like": False, "save": False, "copy_link": False, "comment": False}
    if random.random() < P_LIKE:
        bridge.tap(960, 900)  # tombol like
        actions["like"] = True
        bridge.sleep_human(0.8, 2.0)
    if random.random() < P_SAVE:
        bridge.tap(960, 1050)  # bookmark
        actions["save"] = True
        bridge.sleep_human(0.8, 2.5)
    if random.random() < P_COPY_LINK:
        bridge.tap(960, 1250)  # share sheet
        bridge.sleep_human(1.0, 2.0)
        bridge.tap(540, 1500)  # "Copy link"
        actions["copy_link"] = True
        bridge.sleep_human(0.8, 2.0)
    if random.random() < P_COMMENT:
        bridge.tap(960, 800)  # kolom komentar
        bridge.sleep_human(1.5, 3.0)
        bridge.type_text(random.choice(["keren", "relate", "setuju banget", "nice info"]))
        bridge.sleep_human(0.5, 1.5)
        bridge.tap(1000, 300)  # kirim
        actions["comment"] = True
    return actions


def run_session(distribution_id: int, watch_time_pct: float = 180.0, keyword: str | None = None) -> dict[str, Any]:
    """Satu sesi trigger untuk satu distribusi."""
    row = run_one(
        """
        SELECT d.*, c.start_time, c.end_time
        FROM clip_distributions d
        JOIN generated_clips c ON c.id = d.clip_id
        WHERE d.id = %s
        """,
        (distribution_id,),
    )
    if not row:
        raise RuntimeError(f"distribusi #{distribution_id} tidak ditemukan")

    platform = str(row["target_platform"])
    account = str(row["account_username"])
    video_seconds = max(8.0, float(row["end_time"]) - float(row["start_time"]))
    target_watch = _watch_duration(video_seconds, watch_time_pct)

    bridge = AdbBridge(row.get("device_serial"))
    simulated = not bridge.available
    actions = {"like": False, "save": False, "copy_link": False, "comment": False}

    if simulated:
        logger.info(
            "[simulasi] trigger #%s @%s · tonton %.0fs (%.0f%%)",
            distribution_id,
            account,
            target_watch,
            watch_time_pct,
        )
        time.sleep(min(target_watch, 6))  # jangan tahan worker terlalu lama
        actions = {
            "like": random.random() < P_LIKE,
            "save": random.random() < P_SAVE,
            "copy_link": random.random() < P_COPY_LINK,
            "comment": random.random() < P_COMMENT,
        }
    else:
        bridge.rotate_mobile_ip()
        _search_to_watch(bridge, platform, account, keyword)
        _retention_cycle(bridge, target_watch)
        actions = _interact(bridge)
        time.sleep(_gaussian_delay())

    # Perbarui metrik awal (proxy) supaya dashboard langsung bergerak.
    views_gain = 1
    likes_gain = 1 if actions["like"] else 0

    run(
        """
        UPDATE clip_distributions
        SET trigger_count_applied = trigger_count_applied + 1,
            views_count = views_count + %s,
            likes_count = likes_count + %s,
            saves_count = saves_count + %s,
            comments_count = comments_count + %s,
            status = CASE WHEN status = 'published' THEN 'boosting'::clip_dist_status ELSE status END
        WHERE id = %s
        """,
        (
            views_gain,
            likes_gain,
            1 if actions["save"] else 0,
            1 if actions["comment"] else 0,
            distribution_id,
        ),
    )
    set_distribution_fields(distribution_id, last_scraped_at=datetime.now(timezone.utc).isoformat())

    result = {
        "distributionId": distribution_id,
        "simulated": simulated,
        "watchSeconds": round(target_watch, 1),
        "actions": actions,
    }
    logger.info("✓ trigger #%s selesai: %s", distribution_id, result["actions"])
    return result


def boost(distribution_id: int, sessions: int = 10, watch_time_pct: float = 180.0, keyword: str | None = None) -> None:
    """Drip-feed N sesi dengan jeda acak (distribusi normal)."""
    total = max(1, min(settings.clip_boost_max_sessions, int(sessions)))
    logger.info("▶ boost #%s · %d sesi", distribution_id, total)
    for index in range(total):
        try:
            run_session(distribution_id, watch_time_pct, keyword)
        except Exception as error:  # pragma: no cover - device dependent
            logger.warning("sesi trigger %d gagal: %s", index + 1, error)
        if index < total - 1:
            pause = _gaussian_delay()
            logger.info("… jeda %.1f menit sebelum sesi berikutnya", pause / 60)
            time.sleep(min(pause, 60))  # cap agar worker tetap responsif
