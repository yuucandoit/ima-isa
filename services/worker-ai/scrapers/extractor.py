"""Clean article body extraction via Trafilatura (with a light fallback)."""

from __future__ import annotations

import json
import logging
import re

import requests

from config import settings
from nlp.normalizer import clean_text

logger = logging.getLogger(__name__)

TAG_RE = re.compile(r"<[^>]+>")


def fetch_html(url: str) -> str | None:
    try:
        response = requests.get(
            url,
            headers={
                "User-Agent": settings.user_agent,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
            },
            timeout=settings.rss_timeout_seconds,
        )
        if response.ok and "text/html" in response.headers.get("Content-Type", ""):
            return response.text
    except requests.RequestException as error:
        logger.debug("fetch failed %s: %s", url, error)
    return None


def extract_article(url: str) -> dict[str, str | None]:
    """Return `{title, text, author, date}` — empty text when extraction fails."""
    result: dict[str, str | None] = {"title": None, "text": None, "author": None, "date": None}
    html = fetch_html(url)
    if not html:
        return result

    try:
        import trafilatura  # type: ignore

        raw = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=False,
            favor_recall=True,
            output_format="json",
        )
        if raw:
            payload = json.loads(raw)
            result["title"] = payload.get("title")
            result["text"] = payload.get("text")
            result["author"] = payload.get("author")
            result["date"] = payload.get("date")
    except Exception as error:  # pragma: no cover - optional dependency
        logger.debug("trafilatura extraction failed %s: %s", url, error)

    if not result["text"]:
        fallback = TAG_RE.sub(" ", html)
        fallback = re.sub(r"<script.*?</script>", " ", fallback, flags=re.S | re.I)
        fallback = re.sub(r"<style.*?</style>", " ", fallback, flags=re.S | re.I)
        result["text"] = clean_text(fallback)[:8000] or None

    if result["text"]:
        result["text"] = clean_text(result["text"])
    return result
