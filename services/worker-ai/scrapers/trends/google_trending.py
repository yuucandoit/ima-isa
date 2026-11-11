"""Google Trends "Trending Now" — scrape state ter-embed halaman `/trending`.

Halaman `trends.google.com/trending?geo=ID&hours=24` merender datanya di server
sebagai blok `AF_initDataCallback({key:'ds:0', data:[...]})`. Blok itu memuat
seluruh daftar tren (140 item untuk 24 jam) — jauh lebih lengkap daripada RSS
yang hanya 10 item tanpa parameter jendela.

Struktur satu baris (13 field, dipetakan lewat nama agar tahan pergeseran):

| idx | isi |
| --- | --- |
| 0   | istilah pencarian |
| 2   | kode geo (`ID`) |
| 3   | `[unix_ts]` waktu tren mulai |
| 6   | volume penelusuran (approx traffic) |
| 9   | related queries |
| 10  | breakout / kenaikan (%) |
| 11  | berita terkait `[[id, lang, geo], …]` |

Karena ini scraping HTML, modul ini **wajib** punya penjaga:
`parse_trending_html()` mengembalikan `[]` bila strukturnya tidak dikenali,
sehingga pemanggil bisa jatuh ke RSS (lihat `google.py`).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from urllib.parse import quote

import requests

from config import settings

from .base import TrendItem

logger = logging.getLogger(__name__)

TRENDING_URL = "https://trends.google.com/trending"
BLOCK_RE = re.compile(r"AF_initDataCallback\((\{.*?\})\);</script>", re.S)
DATA_RE = re.compile(r"data:(\[.*?\])\s*,\s*sideChannel", re.S)

#: Jendela yang didukung halaman Google.
ALLOWED_HOURS = (4, 24, 48, 168)
DEFAULT_HOURS = 24

#: Porsi minimal baris yang harus berhasil dipetakan agar hasil scrape dipercaya.
MIN_VALID_RATIO = 0.5
#: Lantai jumlah baris valid (halaman normal punya puluhan/ratusan baris).
MIN_VALID_ROWS = 3


def _search_url(geo: str, term: str) -> str:
    return f"https://trends.google.com/trends/explore?geo={geo}&q={quote(term)}"


def _timestamp(row: list) -> datetime | None:
    raw = row[3]
    value = raw[0] if isinstance(raw, list) and raw else raw
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    return None


def _int_at(row: list, index: int) -> int | None:
    value = row[index] if index < len(row) else None
    return int(value) if isinstance(value, (int, float)) else None


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, str) and item.strip()]


def parse_row(row: object, geo: str, hours: int) -> TrendItem | None:
    """Petakan satu baris `ds:0` ke `TrendItem`; `None` bila tidak valid."""
    if not isinstance(row, list) or len(row) < 7:
        return None
    term = row[0]
    if not isinstance(term, str) or not term.strip():
        return None
    if len(row) > 2 and isinstance(row[2], str) and row[2] and row[2] != geo:
        # Baris dengan geo berbeda (mis. sisa render region lain) dilewati.
        return None

    volume = _int_at(row, 6)
    related = _string_list(row[9] if len(row) > 9 else None)
    breakouts = [item for item in (row[10] if len(row) > 10 else []) if isinstance(item, (int, float))]
    news = row[11] if len(row) > 11 and isinstance(row[11], list) else []
    started = _timestamp(row)

    return TrendItem(
        platform="GOOGLE_TRENDS",
        name=term.strip(),
        rank=0,  # diisi setelah urut volume
        url=_search_url(geo, term.strip()),
        trend_type="search",
        volume=volume,
        volume_label=f"{volume:,}".replace(",", ".") if volume else None,
        published_at=started,
        window_hours=hours,
        related_queries=related,
        news_count=len(news) or None,
        raw={
            "source": "trending_page",
            "geo": geo,
            "hours": hours,
            "startedAt": started.isoformat() if started else None,
            "relatedQueries": related,
            "breakoutPct": breakouts,
            "newsIds": news[:10],
            "displayTerm": row[12] if len(row) > 12 and isinstance(row[12], str) else term,
        },
    )


def _looks_like_rows(node: object) -> bool:
    """Ciri baris tren: list of list, tiap baris ≥7 field dengan term di [0]."""
    if not isinstance(node, list) or not node:
        return False
    sample = node[:3]
    return all(
        isinstance(row, list) and len(row) >= 7 and isinstance(row[0], str)
        for row in sample
    )


def _locate_rows(payload: object) -> list[list] | None:
    """Cari list-of-rows di dalam payload `ds:0` tanpa bergantung indeks tetap."""
    best: list[list] | None = None
    stack: list[object] = [payload]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            if _looks_like_rows(node):
                if best is None or len(node) > len(best):
                    best = node
                continue
            stack.extend(node)
    return best


def parse_trending_html(html: str, geo: str, hours: int) -> list[TrendItem]:
    """Return daftar tren; kosong bila struktur halaman berubah (schema drift)."""
    payloads: list[object] = []
    for block in BLOCK_RE.findall(html):
        match = DATA_RE.search(block)
        if not match:
            continue
        try:
            payloads.append(json.loads(match.group(1)))
        except json.JSONDecodeError:
            continue

    for payload in payloads:
        rows = _locate_rows(payload)
        if not rows:
            continue
        parsed = [item for row in rows if (item := parse_row(row, geo, hours))]
        required = max(MIN_VALID_ROWS, int(len(rows) * MIN_VALID_RATIO))
        if len(parsed) < required:
            logger.warning(
                "Google Trends: hasil parse mencurigakan (%d/%d baris) — struktur halaman mungkin berubah",
                len(parsed),
                len(rows),
            )
            return []
        parsed.sort(key=lambda item: item.volume or 0, reverse=True)
        for rank, item in enumerate(parsed, start=1):
            item.rank = rank
        return parsed

    logger.warning("Google Trends: payload `AF_initDataCallback` tidak ditemukan")
    return []


def fetch_google_trending(
    geo: str | None = None,
    hours: int = DEFAULT_HOURS,
    limit: int = 200,
) -> list[TrendItem]:
    """Ambil daftar Trending Now untuk satu jendela waktu."""
    code = (geo or settings.google_trends_geo or "ID").upper()
    if hours not in ALLOWED_HOURS:
        logger.warning("hours=%s tidak didukung Google, pakai %s", hours, DEFAULT_HOURS)
        hours = DEFAULT_HOURS

    try:
        response = requests.get(
            TRENDING_URL,
            params={"geo": code, "hours": hours},
            headers={
                "User-Agent": settings.user_agent,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
            },
            timeout=settings.google_trends_timeout_seconds,
        )
        response.raise_for_status()
    except requests.RequestException as error:
        logger.warning("Google Trends trending page gagal (%sh): %s", hours, error)
        return []

    items = parse_trending_html(response.text, code, hours)
    if items:
        logger.info(
            "Google Trends: %d tren dari halaman trending (geo=%s, %sh)",
            len(items),
            code,
            hours,
        )
    return items[:limit]
