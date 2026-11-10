"""Optional executive briefing generator used by the cluster worker."""

from __future__ import annotations

import logging
from typing import Iterable

from llm import chat_complete, is_configured

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "Anda adalah analis intelijen media senior Indonesia. Tulis executive briefing "
    "yang padat, faktual, netral, dan hanya berdasarkan artikel yang diberikan. "
    "Gunakan struktur: Latar Belakang, Eskalasi, Respons Pihak Terkait, Sumber Rujukan. "
    "Sertakan sitasi nama portal dalam tanda kurung. Maksimum 220 kata."
)


def _format_articles(articles: Iterable[dict], limit: int = 12) -> str:
    lines: list[str] = []
    for index, article in enumerate(list(articles)[:limit], start=1):
        source = article.get("source_name") or article.get("source_domain") or "Media"
        title = article.get("title", "")
        content = (article.get("clean_content") or "")[:420]
        lines.append(f"{index}. [{source}] {title}\n   {content}")
    return "\n".join(lines)


def generate_cluster_summary(cluster: dict, articles: list[dict]) -> tuple[str, str] | None:
    """Return `(summary, model)` atau `None` bila LLM tidak bisa dihubungi."""
    if not articles or not is_configured():
        return None

    prompt = (
        f"Klaster isu: {cluster.get('title')}\n"
        f"Jumlah artikel: {len(articles)}\n"
        f"Sentimen dominan: {cluster.get('dominant_sentiment')}\n\n"
        f"Artikel:\n{_format_articles(articles)}\n\n"
        "Tulis executive briefing sesuai struktur yang diminta."
    )

    try:
        summary, model, provider = chat_complete(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ]
        )
        return summary, model
    except Exception as error:
        logger.warning("LLM summary failed (%s): %s", type(error).__name__, error)
        return None
