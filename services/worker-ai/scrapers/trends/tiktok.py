"""TikTok trending: Creative Center (butuh cookie) dengan fallback publik.

Jalur utama — **Creative Center** (angkatan data resmi TikTok):
    GET https://ads.tiktok.com/creative_radar_api/v1/popular_trend/hashtag/list
    butuh cookie `sessionid`/`sid_tt` dari akun TikTok Ads biasa.
    Endpoint ini menolak permintaan tanpa sesi (`40101 no permission`).

Jalur cadangan — **Discover feed** (tanpa login, tanpa cookie):
    GET https://www.tiktok.com/node/share/discover?noUser=1&userId=0&secUid=&lang=id
    Mengembalikan hashtag challenge + sound yang sedang dipromosikan TikTok.
"""

from __future__ import annotations

import logging

import requests

from config import settings

from .base import TrendItem, parse_volume

logger = logging.getLogger(__name__)

CREATIVE_CENTER_API = "https://ads.tiktok.com/creative_radar_api/v1/popular_trend/hashtag/list"
DISCOVER_API = "https://www.tiktok.com/node/share/discover"

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
}


def _fetch_creative_center(region: str, limit: int) -> list[TrendItem]:
    """Butuh cookie sesi; dilewati kalau `TIKTOK_SESSION_COOKIE` kosong."""
    cookie = (settings.tiktok_session_cookie or "").strip()
    if not cookie:
        return []

    headers = {
        **BROWSER_HEADERS,
        "Cookie": cookie,
        "Referer": (
            "https://ads.tiktok.com/business/creativecenter/inspiration/popular/"
            f"hashtag/pc/en?countryCode={region}"
        ),
        "Origin": "https://ads.tiktok.com",
    }
    try:
        response = requests.get(
            CREATIVE_CENTER_API,
            params={
                "page": 1,
                "limit": min(50, limit),
                "period": settings.tiktok_trends_period,
                "country_code": region,
                "sort_by": "popular",
            },
            headers=headers,
            timeout=settings.rss_timeout_seconds,
        )
        payload = response.json()
    except (requests.RequestException, ValueError) as error:
        logger.warning("TikTok Creative Center gagal: %s", error)
        return []

    if payload.get("code") not in (0, None):
        logger.warning(
            "TikTok Creative Center menolak (%s: %s) — cookie kedaluwarsa?",
            payload.get("code"),
            payload.get("msg"),
        )
        return []

    entries = (payload.get("data") or {}).get("list") or []
    items: list[TrendItem] = []
    for rank, entry in enumerate(entries[:limit], start=1):
        name = str(entry.get("hashtag_name") or entry.get("hashtagName") or "").strip()
        if not name:
            continue
        posts = entry.get("publish_cnt") or entry.get("publishCnt")
        views = entry.get("video_views") or entry.get("videoViews")
        items.append(
            TrendItem(
                platform="TIKTOK",
                name=name if name.startswith("#") else f"#{name}",
                rank=rank,
                url=f"https://www.tiktok.com/tag/{name.lstrip('#')}",
                trend_type="hashtag",
                volume=int(views) if isinstance(views, (int, float)) else None,
                volume_label=f"{int(posts):,} video".replace(",", ".") if isinstance(posts, (int, float)) else None,
                raw={"source": "creative_center", **entry},
            )
        )
    if items:
        logger.info("TikTok: %d hashtag dari Creative Center", len(items))
    return items


def _fetch_discover_feed(region: str, limit: int) -> list[TrendItem]:
    """Cadangan tanpa kredensial: hashtag & sound dari Discover feed."""
    try:
        response = requests.get(
            DISCOVER_API,
            params={"noUser": 1, "userId": 0, "secUid": "", "lang": "id"},
            headers=BROWSER_HEADERS,
            timeout=settings.rss_timeout_seconds,
        )
        payload = response.json()
    except (requests.RequestException, ValueError) as error:
        logger.warning("TikTok Discover gagal: %s", error)
        return []

    blocks = payload.get("body") or []
    items: list[TrendItem] = []
    seen: set[str] = set()

    for block in blocks:
        for entry in block.get("exploreList") or []:
            card = entry.get("cardItem") or {}
            title = str(card.get("title") or "").strip()
            extra = card.get("extraInfo") or {}
            challenge = str(extra.get("challengeName") or "").strip()

            if challenge:
                name = f"#{challenge}"
                trend_type = "hashtag"
                url = f"https://www.tiktok.com/tag/{challenge}"
            elif title:
                name = title
                trend_type = "sound"
                sound_id = extra.get("musicId") or card.get("id")
                url = f"https://www.tiktok.com/music/-{sound_id}" if sound_id else "https://www.tiktok.com/discover"
            else:
                continue

            key = name.lower()
            if key in seen:
                continue
            seen.add(key)

            label = card.get("subTitle")
            items.append(
                TrendItem(
                    platform="TIKTOK",
                    name=name,
                    rank=len(items) + 1,
                    url=url,
                    trend_type=trend_type,
                    volume=parse_volume(label),
                    volume_label=label,
                    source_name="TikTok Discover",
                    image_url=card.get("cover"),
                    raw={"source": "discover", "card": card},
                )
            )
            if len(items) >= limit:
                return items

    if items:
        logger.info("TikTok: %d tren dari Discover feed (tanpa kredensial)", len(items))
    return items


def fetch_tiktok_trends(region: str | None = None, limit: int = 20) -> list[TrendItem]:
    """Creative Center bila cookie tersedia, jika tidak pakai Discover feed."""
    code = (region or settings.tiktok_trends_region or "ID").upper()
    items = _fetch_creative_center(code, limit)
    if items:
        return items
    return _fetch_discover_feed(code, limit)
