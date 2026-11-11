"""Google Trends (Daily Search Trends) via RSS publik — tanpa kredensial.

Endpoint: `https://trends.google.com/trending/rss?geo=<kode negara>`.
Setiap entri membawa `ht:approx_traffic`, gambar, dan artikel berita terkait.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from urllib.parse import quote

import feedparser

from config import settings

from .base import TrendItem

logger = logging.getLogger(__name__)

RSS_URL = "https://trends.google.com/trending/rss?geo={geo}"


def _published_at(entry: object) -> datetime | None:
    """`pubDate` RSS → datetime UTC (umur tren sebenarnya)."""
    parsed = getattr(entry, "published_parsed", None)
    if not parsed:
        return None
    return datetime(*parsed[:6], tzinfo=timezone.utc)


def _first(value: object) -> str | None:
    """feedparser mengembalikan list kosong bila tag tidak ada."""
    if isinstance(value, list):
        return str(value[0]) if value else None
    return str(value) if value else None


def fetch_google_trends_rss(geo: str | None = None, limit: int = 20) -> list[TrendItem]:
    """Cadangan: RSS resmi (10 tren, tanpa jendela waktu, cepat & stabil)."""
    region_geo = (geo or settings.google_trends_geo or "ID").upper()
    feed = feedparser.parse(
        RSS_URL.format(geo=quote(region_geo)),
        agent=settings.user_agent,
    )
    if not feed.entries:
        logger.warning("Google Trends: tidak ada entri untuk geo=%s", region_geo)
        return []

    items: list[TrendItem] = []
    for rank, entry in enumerate(feed.entries[:limit], start=1):
        name = (getattr(entry, "title", "") or "").strip()
        if not name:
            continue
        traffic = _first(getattr(entry, "ht_approx_traffic", None))
        news_title = _first(getattr(entry, "ht_news_item_title", None))
        news_url = _first(getattr(entry, "ht_news_item_url", None))
        news_source = _first(getattr(entry, "ht_news_item_source", None))
        picture = _first(getattr(entry, "ht_picture", None))

        from .base import parse_volume

        items.append(
            TrendItem(
                platform="GOOGLE_TRENDS",
                name=name,
                rank=rank,
                url=f"https://trends.google.com/trends/explore?geo={region_geo}&q={quote(name)}",
                trend_type="search",
                volume=parse_volume(traffic),
                volume_label=traffic,
                source_name=news_source,
                image_url=picture,
                published_at=_published_at(entry),
                window_hours=24,
                news_count=len(getattr(entry, "ht_news_item", []) or []) or None,
                raw={
                    "source": "rss",
                    "geo": region_geo,
                    "approxTraffic": traffic,
                    "published": getattr(entry, "published", None),
                    "newsTitle": news_title,
                    "newsUrl": news_url,
                    "summary": getattr(entry, "summary", None),
                },
            )
        )
    return items


def fetch_google_trends(geo: str | None = None, limit: int = 20) -> list[TrendItem]:
    """Kompatibilitas: RSS. Sumber utama ada di `google_trending.py`."""
    return fetch_google_trends_rss(geo, limit)
