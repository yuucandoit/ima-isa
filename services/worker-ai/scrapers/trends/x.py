"""X/Twitter trends dengan tiga jalur kredensial.

Urutan percobaan:

1. **API resmi** — `GET /2/trends/by/woeid/{woeid}` dengan `X_BEARER_TOKEN`
   (butuh paket berbayar X API).
2. **Login sebagai akun** — cookie `auth_token` + `ct0` dari browser yang sudah
   login (`X_AUTH_TOKEN`, `X_CT0`), memakai endpoint `1.1/trends/place.json`
   seperti klien web. Ini cara paling murah bila punya akun.
3. **Guest token** — tanpa akun sama sekali: minta `guest_token` lalu panggil
   endpoint 1.1 yang sama dengan bearer publik milik klien web X.

Jalur 3 memakai token publik aplikasi web X (bukan token developer). Untuk
pemakaian produksi/berkelanjutan, pakai jalur 1 atau 2.
"""

from __future__ import annotations

import logging
from datetime import datetime

import requests

from config import settings

from .base import TrendItem

logger = logging.getLogger(__name__)

#: Bearer publik klien web X; dipakai hanya untuk jalur guest/login.
PUBLIC_WEB_BEARER = (
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D"
    "1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
)

GUEST_ACTIVATE_URL = "https://api.x.com/1.1/guest/activate.json"
TRENDS_PLACE_URL = "https://api.x.com/1.1/trends/place.json"
TRENDS_V2_URL = "https://api.x.com/2/trends/by/woeid/{woeid}"

BASE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "id",
}


def _parse_as_of(value: object) -> datetime | None:
    """`as_of` dari endpoint 1.1 berformat ISO 8601 UTC."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _normalise(entry: dict, rank: int, as_of: object = None) -> TrendItem | None:
    name = str(entry.get("trend_name") or entry.get("name") or entry.get("query") or "").strip()
    if not name:
        return None
    volume = entry.get("tweet_count") or entry.get("tweet_volume")
    try:
        volume_value = int(volume) if volume is not None else None
    except (TypeError, ValueError):
        volume_value = None
    # `query` dari endpoint 1.1 sudah URL-encoded (%23...), jangan di-encode dua kali.
    query = requests.utils.unquote(str(entry.get("query") or name))
    return TrendItem(
        platform="TWITTER_X",
        name=name,
        rank=rank,
        url=f"https://x.com/search?q={requests.utils.quote(query)}",
        trend_type="trend",
        volume=volume_value,
        volume_label=(f"{volume_value:,}".replace(",", ".") if volume_value else None),
        published_at=_parse_as_of(as_of),
        raw=entry,
    )


def _fetch_official(woeid: int, limit: int) -> list[TrendItem]:
    token = (settings.x_bearer_token or "").strip()
    if not token:
        return []
    try:
        response = requests.get(
            TRENDS_V2_URL.format(woeid=woeid),
            headers={**BASE_HEADERS, "Authorization": f"Bearer {token}"},
            timeout=settings.rss_timeout_seconds,
        )
        if response.status_code != 200:
            logger.info("X API v2 trends → HTTP %s (lanjut ke jalur guest)", response.status_code)
            return []
        entries = (response.json() or {}).get("data") or []
    except (requests.RequestException, ValueError) as error:
        logger.warning("X API v2 trends gagal: %s", error)
        return []

    items = [item for rank, entry in enumerate(entries[:limit], start=1) if (item := _normalise(entry, rank))]
    if items:
        logger.info("X: %d tren dari API v2", len(items))
    return items


def _web_headers() -> dict[str, str]:
    headers = {**BASE_HEADERS, "Authorization": f"Bearer {PUBLIC_WEB_BEARER}"}
    auth_token = (settings.x_auth_token or "").strip()
    csrf = (settings.x_ct0 or "").strip()
    if auth_token and csrf:
        headers["Cookie"] = f"auth_token={auth_token}; ct0={csrf}"
        headers["x-csrf-token"] = csrf
    return headers


def _activate_guest() -> str | None:
    try:
        response = requests.post(GUEST_ACTIVATE_URL, headers=_web_headers(), timeout=settings.rss_timeout_seconds)
        if response.status_code != 200:
            logger.info("X guest activate → HTTP %s", response.status_code)
            return None
        return (response.json() or {}).get("guest_token")
    except (requests.RequestException, ValueError) as error:
        logger.warning("X guest activate gagal: %s", error)
        return None


def _fetch_web(woeid: int, limit: int) -> list[TrendItem]:
    headers = _web_headers()
    if not (settings.x_auth_token and settings.x_ct0):
        guest = _activate_guest()
        if not guest:
            return []
        headers["x-guest-token"] = guest

    try:
        response = requests.get(
            TRENDS_PLACE_URL,
            params={"id": woeid},
            headers=headers,
            timeout=settings.rss_timeout_seconds,
        )
        if response.status_code != 200:
            logger.warning("X trends place → HTTP %s", response.status_code)
            return []
        payload = response.json() or []
    except (requests.RequestException, ValueError) as error:
        logger.warning("X trends place gagal: %s", error)
        return []

    first = (payload[0] or {}) if payload else {}
    entries = first.get("trends") or []
    as_of = first.get("as_of")
    items: list[TrendItem] = []
    for rank, entry in enumerate(entries[:limit], start=1):
        item = _normalise(entry, rank, as_of)
        if item:
            item.woeid = woeid
            items.append(item)
    if items:
        mode = "login" if (settings.x_auth_token and settings.x_ct0) else "guest"
        logger.info("X: %d tren dari endpoint web (%s)", len(items), mode)
    return items


def fetch_x_trends(woeid: int | None = None, region: str | None = None, limit: int = 20) -> list[TrendItem]:
    """Tren X untuk satu WOEID (default 23424846 = Indonesia).

    Jalur dipilih lewat `X_TRENDS_MODE`:
    - `auto`  : API resmi → login → guest (default)
    - `api`   : hanya API resmi (butuh `X_BEARER_TOKEN` berbayar)
    - `login` : hanya cookie akun (`X_AUTH_TOKEN` + `X_CT0`)
    - `guest` : hanya guest token publik (tanpa akun, tanpa volume)
    """
    target = int(woeid or settings.x_trends_woeid)
    mode = (settings.x_trends_mode or "auto").lower()

    items: list[TrendItem] = []
    if mode in ("auto", "api"):
        items = _fetch_official(target, limit)
    if not items and mode in ("auto", "login"):
        if settings.x_auth_token and settings.x_ct0:
            items = _fetch_web(target, limit)
        elif mode == "login":
            logger.warning("X_TRENDS_MODE=login tapi X_AUTH_TOKEN/X_CT0 kosong")
    if not items and mode in ("auto", "guest"):
        if mode == "guest" or not (settings.x_auth_token and settings.x_ct0):
            items = _fetch_web(target, limit)
    if not items:
        logger.warning(
            "X: tidak ada tren (isi X_BEARER_TOKEN resmi, atau X_AUTH_TOKEN + X_CT0 dari browser)"
        )
        return []

    for item in items:
        item.woeid = target
    return items
