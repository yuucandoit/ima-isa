"""Model tren seragam + penyimpanan ke `social_trends`."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable

import db
from config import settings

logger = logging.getLogger(__name__)

#: Umur maksimum snapshot tren yang disimpan (hari).
RETENTION_DAYS = 14

VOLUME_LABEL_RE = re.compile(r"([\d.,]+)\s*([A-Za-z]*)")


@dataclass
class TrendItem:
    """Satu baris tren dari platform mana pun."""

    platform: str
    name: str
    rank: int
    url: str
    trend_type: str = "trend"
    volume: int | None = None
    volume_label: str | None = None
    source_name: str | None = None
    image_url: str | None = None
    woeid: int | None = None
    #: Jendela waktu tren (Google: 4/24/48/168 jam). `None` = tidak berjendela.
    window_hours: int | None = None
    #: Query terkait yang dilaporkan platform (Google Trends).
    related_queries: list[str] = field(default_factory=list)
    news_count: int | None = None
    #: Waktu tren menurut platform (RSS `pubDate` / X `as_of`), bukan waktu polling.
    published_at: datetime | None = None
    raw: dict[str, Any] = field(default_factory=dict)


def parse_volume(label: str | None) -> int | None:
    """Ubah label volume menjadi angka.

    Mendukung "1.234", "157.4M tayangan", "12,3 jt", "923 rb", "1000+".
    """
    if not label:
        return None
    text = str(label).replace("\u00a0", " ").strip()
    match = VOLUME_LABEL_RE.search(text)
    if not match:
        return None

    number_text, suffix = match.group(1), match.group(2).lower()

    # "1.234" / "1,234" tanpa satuan = ribuan gaya Indonesia (titik pemisah).
    if not suffix and re.fullmatch(r"\d{1,3}([.,]\d{3})+", number_text):
        return int(re.sub(r"[.,]", "", number_text))

    if re.fullmatch(r"\d{1,3}([.,]\d{3})+", number_text):
        number_text = re.sub(r"[.,]", "", number_text)
    normalised = number_text.replace(",", ".")
    try:
        value = float(normalised)
    except ValueError:
        return None

    multipliers = {
        "k": 1_000,
        "rb": 1_000,
        "ribu": 1_000,
        "m": 1_000_000,
        "jt": 1_000_000,
        "juta": 1_000_000,
        "b": 1_000_000_000,
        "miliar": 1_000_000_000,
        "tayangan": 1,
        "views": 1,
        "view": 1,
    }
    factor = multipliers.get(suffix, 1)
    if suffix and suffix not in multipliers:
        # Satuan tak dikenal ("traffic" dsb) — label tetap disimpan, angka dilewati.
        return None
    return int(value * factor)


def was_captured_recently(
    platform: str, min_interval_seconds: int, window_hours: int | None = None
) -> bool:
    """Cegah snapshot ganda bila poller dijalankan berulang dalam waktu dekat."""
    if min_interval_seconds <= 0:
        return False
    try:
        with db.cursor() as cur:
            cur.execute(
                """
                SELECT max(captured_at) AS last
                FROM social_trends
                WHERE platform = %s::source_platform
                  AND window_hours IS NOT DISTINCT FROM %s
                """,
                (platform, window_hours),
            )
            row = cur.fetchone()
    except Exception as error:  # pragma: no cover - DB opsional saat uji
        logger.debug("cek snapshot terakhir gagal: %s", error)
        return False

    last = row["last"] if row else None
    if not last:
        return False

    from datetime import datetime, timezone

    age = (datetime.now(timezone.utc) - last).total_seconds()
    return age < min_interval_seconds


def last_capture_age_seconds(platform: str, window_hours: int | None = None) -> float | None:
    """Umur snapshot terakhir (detik); `None` bila belum pernah ada."""
    try:
        with db.cursor() as cur:
            cur.execute(
                """
                SELECT max(captured_at) AS last FROM social_trends
                WHERE platform = %s::source_platform
                  AND window_hours IS NOT DISTINCT FROM %s
                """,
                (platform, window_hours),
            )
            row = cur.fetchone()
    except Exception as error:  # pragma: no cover - DB opsional saat uji
        logger.debug("umur snapshot gagal dibaca: %s", error)
        return None

    last = (row or {}).get("last")
    if not last:
        return None
    from datetime import datetime, timezone

    return (datetime.now(timezone.utc) - last).total_seconds()


def save_trends(
    items: Iterable[TrendItem],
    region: str,
    *,
    min_interval_seconds: int | None = None,
    force: bool = False,
    replace: bool = True,
    min_replace_ratio: float = 0.5,
) -> int:
    """Tulis snapshot tren. Return jumlah baris yang tersimpan.

    `replace=True` menghapus snapshot lama untuk (platform, jendela) yang sama
    sebelum menulis — daftar tren bersifat menggantikan, dan ini menjaga tabel
    tidak membengkak (Google 140 baris/jendela). Penggantian dibatalkan bila
    jumlah baris baru turun di bawah `min_replace_ratio` dari sebelumnya, supaya
    hasil scrape yang cacat tidak menghapus data bagus.
    """
    rows = [item for item in items if item.name.strip()]
    if not rows:
        return 0

    platform = rows[0].platform
    window = rows[0].window_hours
    interval = settings.trends_capture_interval_seconds if min_interval_seconds is None else min_interval_seconds
    if not force and was_captured_recently(platform, interval, window):
        logger.info(
            "%s: snapshot < %ss yang lalu, dilewati (pakai --force untuk memaksa)",
            platform,
            interval,
        )
        return 0

    values: list[tuple[Any, ...]] = []
    for item in rows:
        values.append(
            (
                item.platform,
                region,
                item.woeid,
                item.name.strip(),
                item.rank,
                item.volume,
                item.volume_label,
                item.trend_type,
                item.source_name,
                item.image_url,
                item.url,
                item.published_at,
                item.window_hours,
                json.dumps(item.related_queries, ensure_ascii=False),
                item.news_count,
                json.dumps(item.raw, ensure_ascii=False),
            )
        )

    try:
        with db.cursor() as cur:
            cur.execute(
                "DELETE FROM social_trends WHERE captured_at < now() - (%s || ' days')::interval",
                (RETENTION_DAYS,),
            )
            if replace:
                # Bandingkan dengan snapshot TERAKHIR, bukan seluruh riwayat:
                # kalau tidak, riwayat lama yang menumpuk akan selalu menolak
                # penggantian (20 baris baru vs 145 baris akumulasi).
                cur.execute(
                    """
                    SELECT count(*)::int AS total
                    FROM social_trends
                    WHERE platform = %s::source_platform
                      AND window_hours IS NOT DISTINCT FROM %s
                      AND captured_at = (
                        SELECT max(captured_at) FROM social_trends
                        WHERE platform = %s::source_platform
                          AND window_hours IS NOT DISTINCT FROM %s
                      )
                    """,
                    (platform, window, platform, window),
                )
                existing = int((cur.fetchone() or {}).get("total") or 0)
                if existing and len(values) < existing * min_replace_ratio:
                    logger.warning(
                        "%s: hasil baru %d baris < %d%% dari %d baris lama — snapshot lama dipertahankan",
                        platform,
                        len(values),
                        int(min_replace_ratio * 100),
                        existing,
                    )
                    return 0
                cur.execute(
                    """
                    DELETE FROM social_trends
                    WHERE platform = %s::source_platform
                      AND window_hours IS NOT DISTINCT FROM %s
                    """,
                    (platform, window),
                )
            cur.executemany(
                """
                INSERT INTO social_trends
                    (platform, region, woeid, name, rank, tweet_volume, volume_label,
                     trend_type, source_name, image_url, url, source_published_at,
                     window_hours, related_queries, news_count, raw)
                VALUES (%s::source_platform, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s::jsonb, %s, %s::jsonb)
                """,
                values,
            )
    except Exception as error:
        logger.warning("%s: simpan tren gagal: %s", platform, error)
        return 0

    logger.info(
        "%s: %d tren disimpan (%s%s)",
        platform,
        len(values),
        region,
        f", {window}h" if window else "",
    )
    return len(values)
