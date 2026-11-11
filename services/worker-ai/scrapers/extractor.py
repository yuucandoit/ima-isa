"""Clean article body extraction via Trafilatura (with a light fallback)."""

from __future__ import annotations

import json
import logging
import re

import requests

from config import settings
from nlp.normalizer import clean_body
from scrapers.body_cleaner import looks_like_code, normalize_article_body

logger = logging.getLogger(__name__)

TAG_RE = re.compile(r"<[^>]+>")

# Blok yang isinya bukan artikel: inline JS (mis. `window.process={...}`), CSS
# styled-components (`/*!sc*/ .jONudq{...}`), dsb. HARUS dibuang sebelum tag
# lain di-strip, kalau tidak seluruh kode ikut masuk ke body artikel.
NOISE_BLOCK_RE = re.compile(
    r"<(script|style|noscript|template|svg|iframe|canvas|form)\b[^>]*>.*?</\1\s*>",
    re.S | re.I,
)
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
ARTICLE_RE = re.compile(r"<(article|main)\b[^>]*>(.*)</\1\s*>", re.S | re.I)
BLOCK_END_RE = re.compile(
    r"</(p|div|section|li|h[1-6]|blockquote|tr|td|figure|figcaption|article)\s*>|<br\s*/?>",
    re.S | re.I,
)

MIN_FALLBACK_CHARS = 240
MAX_FALLBACK_CHARS = 12000


def fetch_html(url: str, *, status: dict[str, int | None] | None = None) -> str | None:
    """Ambil HTML; `status` (opsional) diisi kode HTTP untuk diagnosis."""
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
        if status is not None:
            status["code"] = response.status_code
        if response.ok and "text/html" in response.headers.get("Content-Type", ""):
            return response.text
    except requests.RequestException as error:
        logger.debug("fetch failed %s: %s", url, error)
    return None


def _strip_noise_blocks(markup: str) -> str:
    """Buang komentar HTML lalu seluruh blok script/style (termasuk bersarang)."""
    value = COMMENT_RE.sub(" ", markup)
    while True:
        cleaned = NOISE_BLOCK_RE.sub(" ", value)
        if cleaned == value:
            return value
        value = cleaned


def _densest_block(html: str):
    """Cari kontainer dengan total teks <p> terbanyak (heuristik readability)."""
    try:
        from lxml import html as lxml_html  # type: ignore
    except Exception:  # pragma: no cover - optional dependency
        return None
    try:
        tree = lxml_html.fromstring(html)
    except Exception:
        return None
    best = None
    best_score = 0
    for node in tree.iter("article", "main", "div", "section"):
        paragraphs = node.findall(".//p")
        score = sum(len("".join(p.itertext()).strip()) for p in paragraphs)
        if len(paragraphs) >= 2 and score > best_score:
            best, best_score = node, score
    return best


def _fallback_text(html: str) -> str | None:
    """Ekstraksi cadangan tanpa membaca <script>/<style> sama sekali."""
    node = _densest_block(_strip_noise_blocks(html))
    if node is not None:
        chunks: list[str] = []
        for element in node.iter("h2", "h3", "p", "li", "blockquote", "figcaption"):
            # Lewati paragraf yang punya anak blok sendiri agar tidak dobel.
            if element.find(".//p") is not None:
                continue
            text = " ".join(element.itertext()).strip()
            if text:
                chunks.append(text)
        text = clean_body("\n".join(chunks))[:MAX_FALLBACK_CHARS]
        if len(text) >= MIN_FALLBACK_CHARS and not looks_like_code(text):
            return text

    value = _strip_noise_blocks(html)
    match = ARTICLE_RE.search(value)
    if match and len(match.group(2)) > MIN_FALLBACK_CHARS:
        value = match.group(2)
    value = BLOCK_END_RE.sub("\n", value)
    value = TAG_RE.sub(" ", value)
    text = clean_body(value)[:MAX_FALLBACK_CHARS]
    if len(text) < MIN_FALLBACK_CHARS or looks_like_code(text):
        logger.debug("fallback ditolak: %s karakter tersisa", len(text))
        return None
    return text


def extract_article(url: str, title: str | None = None) -> dict[str, str | None]:
    """Return `{title, text, author, date}` — empty text when extraction fails.

    `title` (opsional) dipakai untuk membuang judul yang diulang di badan artikel
    serta baris chrome situs ("detikNews", "ADVERTISEMENT", dsb).
    """
    result: dict[str, str | int | None] = {
        "title": None,
        "text": None,
        "author": None,
        "date": None,
        "status": None,
    }
    status: dict[str, int | None] = {}
    html = fetch_html(url, status=status)
    result["status"] = status.get("code")
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
            result["author"] = payload.get("author")
            result["date"] = payload.get("date")
            body = clean_body(str(payload.get("text") or ""))
            if body and not looks_like_code(body):
                result["text"] = body
    except Exception as error:  # pragma: no cover - optional dependency
        logger.debug("trafilatura extraction failed %s: %s", url, error)

    if not result["text"]:
        result["text"] = _fallback_text(html)

    if result["text"]:
        cleaned = normalize_article_body(
            result["text"], title=title or result["title"], domain=url
        )
        if len(cleaned) >= MIN_FALLBACK_CHARS:
            result["text"] = cleaned

    return result
