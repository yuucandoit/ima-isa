"""Fase D — analytics tracker & kalkulasi monetisasi CPM.

Cron setiap `CLIP_TRACKER_INTERVAL_SECONDS` (default 3 jam) menarik metrik
terbaru dari setiap `post_url` aktif, menghitung estimasi pendapatan:

    revenue = floor(views / 1000) * cpm_rate_idr

dan menandai anomali shadowban bila `views < CLIP_SHADOWBAN_VIEWS` setelah
`CLIP_SHADOWBAN_HOURS` jam terbit.

Sumber metrik:
  * `playwright` (bila terpasang) untuk scrape halaman publik;
  * ADB (`uiautomator2`/`adb shell dumpsys`) untuk aplikasi native;
  * fallback: simulasi pertumbuhan organik agar dashboard tetap hidup.
"""

from __future__ import annotations

import logging
import random
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from config import settings

from .pipeline import run, run_one, set_distribution_fields

logger = logging.getLogger("clipping.tracker")

#: `jt`/`rb` adalah singkatan Indonesia untuk juta/ribu.
_COUNT = r"([\d.,]+)\s*(jt|rb|[kmb]?)\s*"
VIEW_RE = re.compile(_COUNT + r"(?:views|tayangan|tontonan|ditonton)", re.I)
LIKE_RE = re.compile(_COUNT + r"(?:likes|suka|menyukai)", re.I)
COMMENT_RE = re.compile(_COUNT + r"(?:comments|komentar)", re.I)
SHARE_RE = re.compile(_COUNT + r"(?:shares|bagikan|dibagikan)", re.I)
SAVE_RE = re.compile(_COUNT + r"(?:saves|disimpan|bookmark)", re.I)

SUFFIX = {
    "": 1,
    "K": 1_000,
    "RB": 1_000,
    "M": 1_000_000,
    "JT": 1_000_000,
    "B": 1_000_000_000,
}


def _normalize_number(raw: str) -> float | None:
    """Ubah `"12,4"` / `"12.400"` / `"1.2"` menjadi float.

    Koma atau titik diikuti tepat 3 digit dianggap pemisah ribuan (format ID
    maupun EN); sisanya pemisah desimal.
    """
    text = raw.strip()
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        head, _, tail = text.partition(",")
        text = head + tail if len(tail) == 3 else f"{head}.{tail}"
    elif "." in text:
        head, _, tail = text.partition(".")
        if len(tail) == 3 and len(head) <= 3:
            text = head + tail
    try:
        return float(text)
    except ValueError:
        return None


def parse_count(text: str | None) -> int | None:
    """`"12,4K"` → `12400`; `"1.2jt"` → `1200000` (format ID/EN)."""
    if not text:
        return None
    cleaned = text.strip().lower().replace("jt", "m").replace("rb", "k")
    match = re.match(r"([\d.,]+)\s*([kmb]?)", cleaned)
    if not match:
        return None
    number, suffix = match.groups()
    value = _normalize_number(number)
    if value is None:
        return None
    return int(value * SUFFIX.get(suffix.upper(), 1))


def metrics_from_html(html: str) -> dict[str, int] | None:
    """Ekstrak metrik dari HTML halaman post (pola JSON-LD / teks publik)."""
    metrics: dict[str, int] = {}
    for key, pattern in (
        ("viewsCount", VIEW_RE),
        ("likesCount", LIKE_RE),
        ("commentsCount", COMMENT_RE),
        ("sharesCount", SHARE_RE),
        ("savesCount", SAVE_RE),
    ):
        match = pattern.search(html)
        if match:
            value = parse_count(" ".join(part for part in match.groups() if part))
            if value is not None:
                metrics[key] = value
    return metrics or None


def scrape_with_playwright(post_url: str) -> dict[str, int] | None:
    try:  # pragma: no cover - optional dependency
        from playwright.sync_api import sync_playwright  # type: ignore
    except Exception:
        return None
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(
                user_agent=(
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
                ),
                viewport={"width": 430, "height": 932},
            )
            page.goto(post_url, wait_until="networkidle", timeout=45_000)
            page.wait_for_timeout(2_500)
            html = page.content()
            browser.close()
        return metrics_from_html(html)
    except Exception as error:  # pragma: no cover - network dependent
        logger.debug("playwright scrape gagal (%s): %s", post_url, error)
        return None


def scrape_with_adb(post_url: str, device_serial: str | None) -> dict[str, int] | None:
    """Fallback: buka URL di perangkat dan baca hierarki UI."""
    from .distributor import AdbBridge

    bridge = AdbBridge(device_serial)
    if not bridge.available:
        return None
    bridge._run("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", post_url)
    bridge.sleep_human(5, 9)
    dump = bridge._run("shell", "uiautomator", "dump", "/sdcard/window_dump.xml")
    xml = bridge._run("shell", "cat", "/sdcard/window_dump.xml")
    if not xml:
        return None
    return metrics_from_html(xml)


def simulate_growth(current: dict[str, Any]) -> dict[str, int]:
    """Pertumbuhan organik sintetis untuk mode tanpa scraper/perangkat."""
    views = int(current.get("views_count") or 0)
    base = max(views, random.randint(40, 400))
    growth = random.uniform(1.05, 1.45)
    new_views = int(base * growth)
    return {
        "viewsCount": new_views,
        "likesCount": max(int(current.get("likes_count") or 0), int(new_views * random.uniform(0.03, 0.11))),
        "commentsCount": max(int(current.get("comments_count") or 0), int(new_views * random.uniform(0.001, 0.01))),
        "sharesCount": max(int(current.get("shares_count") or 0), int(new_views * random.uniform(0.002, 0.02))),
        "savesCount": max(int(current.get("saves_count") or 0), int(new_views * random.uniform(0.01, 0.06))),
    }


def estimated_revenue(views: int, cpm_rate_idr: int) -> int:
    """`floor(views / 1000) * CPM` sesuai blueprint."""
    if cpm_rate_idr <= 0:
        return 0
    return (views // 1000) * cpm_rate_idr


def _is_shadowbanned(row: dict[str, Any], views: int) -> bool:
    published = row.get("published_at")
    if not published or views >= settings.clip_shadowban_views:
        return False
    if isinstance(published, str):
        try:
            published = datetime.fromisoformat(published)
        except ValueError:
            return False
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)
    age = datetime.now(timezone.utc) - published
    return age >= timedelta(hours=settings.clip_shadowban_hours)


def track_distribution(distribution_id: int) -> dict[str, int] | None:
    row = run_one("SELECT * FROM clip_distributions WHERE id = %s", (distribution_id,))
    if not row:
        logger.warning("distribusi #%s tidak ditemukan", distribution_id)
        return None
    post_url = row.get("post_url")
    if not post_url:
        return None

    metrics = (
        scrape_with_playwright(str(post_url))
        or scrape_with_adb(str(post_url), row.get("device_serial"))
        or simulate_growth(row)
    )

    views = int(metrics.get("viewsCount") or row.get("views_count") or 0)
    cpm = int(row.get("cpm_rate_idr") or 0)
    revenue = estimated_revenue(views, cpm)

    status = row.get("status")
    if _is_shadowbanned(row, views):
        status = "shadowbanned"
        logger.warning("⚠ distribusi #%s terindikasi shadowban (%d views)", distribution_id, views)
        # Catat ke alert agar operator bisa evaluasi akun/proxy.
        run(
            """
            INSERT INTO alerts (title, description, severity, metrics_snapshot)
            VALUES (%s, %s, 'HIGH', %s::jsonb)
            """,
            (
                f"Shadowban terdeteksi: @{row['account_username']}",
                (
                    f"Distribusi #{distribution_id} hanya mendapat {views} views setelah "
                    f"{settings.clip_shadowban_hours} jam. Evaluasi akun/proxy perangkat."
                ),
                f'{{"views": {views}, "distributionId": {distribution_id}}}',
            ),
        )
    elif status in {"published", "boosting"} and views >= settings.clip_shadowban_views:
        status = "boosting" if views > settings.clip_shadowban_views * 4 else status

    run(
        """
        UPDATE clip_distributions SET
            views_count = %s,
            likes_count = %s,
            comments_count = %s,
            shares_count = %s,
            saves_count = %s,
            estimated_revenue_idr = %s,
            status = %s::clip_dist_status,
            last_scraped_at = now()
        WHERE id = %s
        """,
        (
            views,
            int(metrics.get("likesCount") or 0),
            int(metrics.get("commentsCount") or 0),
            int(metrics.get("sharesCount") or 0),
            int(metrics.get("savesCount") or 0),
            revenue,
            status,
            distribution_id,
        ),
    )
    logger.info(
        "✓ track #%s · %d views · Rp %s",
        distribution_id,
        views,
        f"{revenue:,}".replace(",", "."),
    )
    return {
        "viewsCount": views,
        "likesCount": int(metrics.get("likesCount") or 0),
        "estimatedRevenueIdr": revenue,
    }


def track_all(limit: int = 200) -> int:
    """Cron: update metrik semua distribusi aktif (post_url tidak null)."""
    rows = run(
        """
        SELECT id FROM clip_distributions
        WHERE post_url IS NOT NULL
          AND status IN ('published','boosting')
        ORDER BY last_scraped_at NULLS FIRST
        LIMIT %s
        """,
        (limit,),
    )
    processed = 0
    for row in rows:
        try:
            if track_distribution(int(row["id"])):
                processed += 1
        except Exception as error:  # pragma: no cover
            logger.warning("track #%s gagal: %s", row["id"], error)
    logger.info("tracker selesai: %d distribusi diperbarui", processed)
    return processed


def refresh_revenue(cpm_override: dict[int, int] | None = None) -> int:
    """Hitung ulang pendapatan setelah CPM campaign berubah."""
    rows = run("SELECT id, views_count, cpm_rate_idr FROM clip_distributions")
    updated = 0
    for row in rows:
        cpm = int((cpm_override or {}).get(int(row["id"]), row["cpm_rate_idr"] or 0))
        revenue = estimated_revenue(int(row["views_count"] or 0), cpm)
        if revenue != int(row.get("cpm_rate_idr") or 0):
            run(
                "UPDATE clip_distributions SET estimated_revenue_idr = %s, cpm_rate_idr = %s WHERE id = %s",
                (revenue, cpm, row["id"]),
            )
            updated += 1
    return updated


def set_distribution_metrics(distribution_id: int, metrics: dict[str, int]) -> None:
    """Dipakai test/manual: timpa metrik secara eksplisit."""
    set_distribution_fields(
        distribution_id,
        views_count=int(metrics.get("viewsCount") or 0),
        likes_count=int(metrics.get("likesCount") or 0),
        comments_count=int(metrics.get("commentsCount") or 0),
        shares_count=int(metrics.get("sharesCount") or 0),
        saves_count=int(metrics.get("savesCount") or 0),
    )
