"""Poller trending: X/Twitter, TikTok, dan Google Trends.

Contoh:

    python trends_poller.py --once                 # ambil ketiganya sekali
    python trends_poller.py --once --platform x    # hanya X
    python trends_poller.py --once --probe         # cek kredensial & konektivitas
    python trends_poller.py --interval 900         # loop tiap 15 menit

Kredensial (semua opsional, lihat `.env.example`):

| Platform | Variabel | Tanpa kredensial? |
| --- | --- | --- |
| Google Trends | `GOOGLE_TRENDS_GEO` | ya — RSS publik |
| TikTok | `TIKTOK_SESSION_COOKIE` | ya — Discover feed publik (lebih kasar) |
| X / Twitter | `X_BEARER_TOKEN` atau `X_AUTH_TOKEN` + `X_CT0` | ya — guest token publik (terbatas) |

Snapshot ditulis ke `social_trends` dan disajikan `/api/trending/social`.
"""

from __future__ import annotations

import argparse
import logging
import os
import time

import redis

from config import settings
from scrapers.trends import (
    fetch_tiktok_trends,
    fetch_x_trends,
    save_trends,
)
from scrapers.trends.google import fetch_google_trends_rss
from scrapers.trends.google_trending import fetch_google_trending
from scrapers.trends.base import (
    TrendItem,
    last_capture_age_seconds,
    was_captured_recently,
)

logger = logging.getLogger("trends")

PLATFORMS = ("x", "tiktok", "google")

#: Nama platform di DB (enum `source_platform`).
DB_PLATFORM = {"x": "TWITTER_X", "tiktok": "TIKTOK", "google": "GOOGLE_TRENDS"}


def capture_interval(platform: str) -> int:
    """Jeda snapshot per platform: Google paling cepat karena feednya cepat berganti."""
    if platform == "google":
        return settings.trends_interval_google
    if platform == "tiktok":
        return settings.trends_interval_tiktok
    return settings.trends_interval_x


def collect(platform: str, limit: int) -> tuple[str, list[TrendItem], str]:
    """Return `(platform, items, region)` untuk platform non-Google."""
    if platform == "x":
        return (
            "x",
            fetch_x_trends(settings.x_trends_woeid, settings.x_trends_region, limit),
            settings.x_trends_region,
        )
    return (
        "tiktok",
        fetch_tiktok_trends(settings.tiktok_trends_region, limit),
        "Indonesia" if settings.tiktok_trends_region.upper() == "ID" else settings.tiktok_trends_region,
    )


_redis: redis.Redis | None = None


def _redis_client() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def has_interest(platform: str) -> bool:
    """True bila dashboard membuka trending platform ini belum lama."""
    try:
        return bool(_redis_client().exists(f"trends:interest:{platform.lower()}"))
    except redis.RedisError as error:
        logger.debug("redis interest gagal dibaca: %s", error)
        return True  # Redis mati: jangan memblokir capture


def should_skip_idle(platform: str, window: int | None) -> bool:
    """Hemat bandwidth saat tidak ada penonton, tapi tetap segarkan berkala."""
    if not settings.trends_adaptive:
        return False
    if has_interest(platform):
        return False
    age = last_capture_age_seconds(DB_PLATFORM[platform], window)
    return age is not None and age < settings.trends_idle_interval_seconds


def capture_google(limit: int, force: bool) -> int:
    """Google: scrape halaman `trending` per jendela waktu, RSS sebagai cadangan.

    Tiap jendela disimpan terpisah (`window_hours`) sehingga UI bisa memilih
    4 jam / 24 jam / 7 hari. Bila seluruh scrape gagal (schema drift / blokir),
    RSS resmi dipakai agar dashboard tidak kosong.
    """
    interval = capture_interval("google")
    window_specs = (
        () if (settings.google_trends_source or "page").lower() == "rss" else settings.google_trends_windows
    )

    saved = 0
    attempts = 0
    for hours in window_specs:
        if not force and should_skip_idle("google", hours):
            logger.info(
                "google(%sh): tidak ada penonton, lewati (interval idle %ss)",
                hours,
                settings.trends_idle_interval_seconds,
            )
            continue
        if not force and was_captured_recently("GOOGLE_TRENDS", interval, hours):
            logger.debug("google(%sh): snapshot < %ss, dilewati", hours, interval)
            continue

        attempts += 1
        items = fetch_google_trending(settings.google_trends_geo, hours, settings.trends_google_limit)
        if items:
            saved += save_trends(
                items,
                settings.google_trends_region,
                min_interval_seconds=interval,
                force=force,
            )

    if saved:
        return saved
    # Tidak ada percobaan sama sekali (idle / kadens belum tiba): jangan sentuh data.
    if attempts == 0:
        return 0

    # Semua percobaan gagal (schema drift / blokir / error jaringan) → RSS resmi.
    logger.warning("Google Trends: halaman trending gagal, memakai RSS sebagai cadangan")
    items = fetch_google_trends_rss(settings.google_trends_geo, min(limit, 20))
    # RSS hanya 10 baris: izinkan menggantikan snapshot besar, karena menampilkan
    # 140 baris basi tanpa penanda lebih buruk daripada 10 baris bertanda "RSS".
    return save_trends(
        items,
        settings.google_trends_region,
        min_interval_seconds=interval,
        force=force,
        min_replace_ratio=0.0,
    )


def run_once(limit: int, force: bool, platforms: list[str]) -> dict[str, int]:
    results: dict[str, int] = {}
    for platform in platforms:
        interval = capture_interval(platform)
        # Cek kadens SEBELUM request: hemat panggilan API untuk platform yang
        # jadwalnya belum tiba (Google tiap 5 menit, X tiap 10 menit).
        if platform == "google":
            results[platform] = capture_google(limit, force)
            continue
        if not force and should_skip_idle(platform, None):
            logger.info("%s: tidak ada penonton, lewati", platform)
            results[platform] = 0
            continue
        if not force and was_captured_recently(DB_PLATFORM[platform], interval):
            logger.debug("%s: snapshot < %ss, dilewati", platform, interval)
            results[platform] = 0
            continue
        try:
            _, items, region = collect(platform, limit)
        except Exception as error:  # jangan hentikan platform lain
            logger.warning("%s: gagal mengambil tren: %s", platform, error)
            results[platform] = 0
            continue
        results[platform] = (
            save_trends(items, region, min_interval_seconds=interval, force=force)
            if items
            else 0
        )
        if not items:
            logger.warning("%s: tidak ada tren yang bisa diambil", platform)
    return results


def probe() -> int:
    """Tampilkan status kredensial + jumlah tren yang berhasil diambil."""
    print("Kredensial:")
    print(f"  X_BEARER_TOKEN resmi     : {'ada' if settings.x_bearer_token else 'tidak ada'}")
    print(
        "  X cookie (auth_token/ct0): "
        + ("ada" if (settings.x_auth_token and settings.x_ct0) else "tidak ada")
    )
    print(f"  TIKTOK_SESSION_COOKIE    : {'ada' if settings.tiktok_session_cookie else 'tidak ada'}")
    print(f"  GOOGLE_TRENDS_GEO        : {settings.google_trends_geo}")
    print(
        f"  GOOGLE_TRENDS_SOURCE     : {settings.google_trends_source}"
        f" (jendela: {settings.google_trends_windows or '-'})"
    )
    print()

    failures = 0
    for platform in PLATFORMS:
        try:
            _, items, _ = collect(platform, 10)
        except Exception as error:
            print(f"✗ {platform:<7} error: {error}")
            failures += 1
            continue
        status = "✓" if items else "✗"
        if not items:
            failures += 1
        sample = ", ".join(item.name for item in items[:3]) or "—"
        print(f"{status} {platform:<7} {len(items):>3} tren · {sample}")

    print()
    if failures:
        print("Sebagian platform gagal. Isi kredensial di .env lalu jalankan ulang --probe.")
        return 1
    print("Semua platform siap.")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Trending poller: X, TikTok, Google Trends")
    parser.add_argument("--once", action="store_true", help="satu siklus lalu keluar")
    parser.add_argument("--probe", action="store_true", help="cek kredensial & konektivitas")
    parser.add_argument(
        "--platform",
        default="all",
        choices=[*PLATFORMS, "all"],
        help="platform yang diambil (default: all)",
    )
    parser.add_argument("--limit", type=int, default=20, help="maksimum tren per platform")
    parser.add_argument("--force", action="store_true", help="abaikan jeda snapshot minimum")
    parser.add_argument(
        "--interval",
        type=int,
        default=int(os.getenv("TRENDS_POLL_INTERVAL_SECONDS", "60")),
        help="jeda antar siklus bila tidak --once",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")

    if args.probe:
        raise SystemExit(probe())

    platforms = list(PLATFORMS) if args.platform == "all" else [args.platform]
    logger.info(
        "Trends poller mulai (platform=%s, interval=%ss)",
        ",".join(platforms),
        args.interval,
    )

    while True:
        results = run_once(args.limit, args.force, platforms)
        logger.info(
            "siklus selesai: %s",
            " · ".join(f"{platform}={count}" for platform, count in results.items()),
        )
        if args.once:
            break
        time.sleep(max(30, args.interval))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
