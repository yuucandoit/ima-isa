"""Resolve URL `news.google.com/rss/articles/...` menjadi URL artikel aslinya.

Feed mirror Google News menyimpan URL pembungkus, sehingga artikelnya tidak bisa
di-scrape (dan tautan di dashboard berakhir di halaman Google). Modul ini memakai
endpoint `batchexecute` yang dipakai Google News sendiri untuk dekode tautan.
"""

from __future__ import annotations

import json
import logging
import re
from functools import lru_cache

import requests

logger = logging.getLogger(__name__)

GOOGLE_NEWS_HOST = "news.google.com"
SIGNATURE_RE = re.compile(r'data-n-a-sg="([^"]+)"')
TIMESTAMP_RE = re.compile(r'data-n-a-ts="([^"]+)"')
RESULT_RE = re.compile(r'\[\\?"garturlres\\?",\\?"(https?://[^"\\]+)')
BATCH_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute"

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
)

_decoder_state: dict[str, object] = {}


def is_google_news_url(url: str) -> bool:
    return GOOGLE_NEWS_HOST in (url or "")


def _session() -> requests.Session:
    session = _decoder_state.get("session")
    if not isinstance(session, requests.Session):
        session = requests.Session()
        session.headers.update({"User-Agent": _UA, "Accept-Language": "id-ID,id;q=0.9"})
        _decoder_state["session"] = session
    return session


def _article_id(url: str) -> str | None:
    match = re.search(r"/articles/([^/?#]+)", url)
    return match.group(1) if match else None


@lru_cache(maxsize=512)
def decode_google_news_url(url: str, timeout: float = 20.0) -> str | None:
    """Kembalikan URL asli, atau `None` bila Google mengubah protokolnya lagi."""
    article_id = _article_id(url)
    if not article_id:
        return None

    session = _session()
    page_url = f"https://news.google.com/rss/articles/{article_id}"
    try:
        page = session.get(page_url, timeout=timeout)
        signature = SIGNATURE_RE.search(page.text)
        timestamp = TIMESTAMP_RE.search(page.text)
        if not signature or not timestamp:
            logger.debug("google news: signature tidak ditemukan untuk %s", article_id[:24])
            return None

        inner = [
            "garturlreq",
            [
                ["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1, None, None, None,
                 None, None, 0, 1],
                "X",
                "X",
                1,
                [1, 1, 1],
                1,
                1,
                None,
                0,
                0,
                None,
                0,
            ],
            article_id,
            int(timestamp.group(1)),
            signature.group(1),
        ]
        payload = [[["Fbv4je", json.dumps(inner, separators=(",", ":"))]]]
        response = session.post(
            BATCH_URL,
            headers={
                "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                "origin": "https://news.google.com",
                "referer": page_url,
            },
            data="f.req=" + requests.utils.quote(json.dumps(payload, separators=(",", ":"))),
            timeout=timeout,
        )
        match = RESULT_RE.search(response.text)
        if not match:
            logger.debug("google news: hasil dekode kosong untuk %s", article_id[:24])
            return None
        return match.group(1).replace("\\u003d", "=").replace("\\u0026", "&")
    except (requests.RequestException, ValueError) as error:
        logger.debug("google news decode gagal %s: %s", url, error)
        return None


def resolve_article_url(url: str, timeout: float = 20.0) -> str:
    """URL yang bisa di-scrape: hasil dekode Google News, atau URL aslinya."""
    if is_google_news_url(url):
        decoded = decode_google_news_url(url, timeout)
        if decoded:
            return decoded
    return url
