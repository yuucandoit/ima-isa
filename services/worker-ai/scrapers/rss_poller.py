"""RSS poller for the 10 Indonesian outlets in the ingestion matrix.

Each entry is normalised, deduplicated with a Redis NX key, optionally enriched
with the full article body via Trafilatura, then pushed to `media:raw`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

import feedparser
import redis

from config import MEDIA_SOURCES, MediaSource, settings
from nlp.normalizer import clean_text
from scrapers.extractor import extract_article

logger = logging.getLogger(__name__)

TITLE_NOISE_RE = re.compile(r"[^0-9a-z]+")
TAG_RE = re.compile(r"<[^>]+>")


def build_external_id(domain: str, title: str) -> str:
    normalized = TITLE_NOISE_RE.sub(" ", title.lower()).strip()
    return hashlib.sha256(f"{domain}|{normalized}".encode("utf-8")).hexdigest()


def parse_published(entry: Any) -> str:
    for attribute in ("published_parsed", "updated_parsed"):
        parsed = getattr(entry, attribute, None)
        if parsed:
            return datetime(*parsed[:6], tzinfo=timezone.utc).isoformat()
    return datetime.now(timezone.utc).isoformat()


def entry_summary(entry: Any) -> str:
    summary = getattr(entry, "summary", "") or getattr(entry, "description", "") or ""
    return clean_text(TAG_RE.sub(" ", summary))


def fetch_feed(source: MediaSource) -> tuple[Any, str]:
    """Try the primary feed, then mirrors, until one yields entries."""
    for url in source.candidate_urls:
        try:
            feed = feedparser.parse(
                url,
                agent=settings.user_agent,
                request_headers={"Accept-Language": "id-ID,id;q=0.9"},
            )
        except Exception as error:
            logger.info("feed unreachable %s (%s): %s", source.name, url, error)
            continue
        if feed.entries:
            if url != source.feed_url:
                logger.info("%s: using mirror feed %s", source.name, url)
            return feed, url
    return feedparser.parse(""), source.feed_url


def build_payload(
    source: MediaSource, entry: Any, fulltext: bool, feed_url: str | None = None
) -> dict[str, Any] | None:
    title = clean_text(getattr(entry, "title", "") or "")
    url = getattr(entry, "link", "") or ""
    if not title or not url:
        return None

    summary = entry_summary(entry)
    content = summary
    author = clean_text(getattr(entry, "author", "") or "") or None

    if fulltext and source.fulltext_supported:
        extracted = extract_article(url, title=title)
        if extracted.get("text") and len(str(extracted["text"])) > len(summary):
            content = str(extracted["text"])
        author = author or (str(extracted["author"]) if extracted.get("author") else None)

    published_at = parse_published(entry)
    external_id = build_external_id(source.domain, title)

    return {
        "externalId": external_id,
        "platform": "NEWS_MEDIA",
        "sourceName": source.name,
        "domain": source.domain,
        "feedUrl": feed_url or source.feed_url,
        "category": source.category,
        "url": url,
        "author": author,
        "title": title,
        "summary": summary,
        "content": content or title,
        "publishedAt": published_at,
    }


def poll_source(
    client: redis.Redis, source: MediaSource, fulltext_budget: int
) -> tuple[str, int, int]:
    """Poll one feed. Returns (source name, pushed, skipped)."""
    feed, active_url = fetch_feed(source)
    if not feed.entries:
        logger.warning("feed error %s: tidak ada entri dari %s", source.name, source.feed_url)
        return source.name, 0, 0

    entries = feed.entries[: settings.rss_max_entries_per_feed]
    pushed = 0
    skipped = 0

    for index, entry in enumerate(entries):
        payload = build_payload(
            source,
            entry,
            fulltext_budget > 0 and index < fulltext_budget,
            feed_url=active_url,
        )
        if payload is None:
            skipped += 1
            continue

        dedupe_key = f"dedupe:media:{payload['externalId']}"
        try:
            is_new = bool(
                client.set(dedupe_key, "1", nx=True, ex=settings.dedupe_ttl_seconds)
            )
        except redis.RedisError as error:
            logger.warning("redis dedupe failed: %s", error)
            is_new = True

        if not is_new:
            skipped += 1
            continue

        try:
            client.xadd(
                settings.raw_stream,
                {"payload": json.dumps(payload, ensure_ascii=False)},
                maxlen=50_000,
                approximate=True,
            )
            pushed += 1
        except redis.RedisError as error:
            logger.warning("redis xadd failed: %s", error)
            skipped += 1

    logger.info(
        "%s: %d pushed, %d skipped (of %d entries)",
        source.name,
        pushed,
        skipped,
        len(entries),
    )
    return source.name, pushed, skipped


def run_cycle(client: redis.Redis) -> tuple[int, int]:
    total_pushed = 0
    total_skipped = 0
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {
            pool.submit(
                poll_source, client, source, settings.rss_fulltext_limit_per_feed
            ): source
            for source in MEDIA_SOURCES
        }
        for future in as_completed(futures):
            try:
                _, pushed, skipped = future.result()
                total_pushed += pushed
                total_skipped += skipped
            except Exception as error:
                logger.warning("source polling failed: %s", error)
    return total_pushed, total_skipped


def main() -> None:
    parser = argparse.ArgumentParser(description="RSS poller for Indonesian media")
    parser.add_argument("--once", action="store_true", help="Run a single cycle and exit")
    parser.add_argument("--interval", type=int, default=settings.rss_poll_interval)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s · %(message)s",
    )
    client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    logger.info(
        "RSS poller started — %d sources, interval %ss, fulltext=%s",
        len(MEDIA_SOURCES),
        args.interval,
        settings.rss_fetch_fulltext,
    )

    while True:
        started = time.time()
        pushed, skipped = run_cycle(client)
        elapsed = time.time() - started
        logger.info(
            "cycle done in %.1fs — %d new payloads, %d skipped",
            elapsed,
            pushed,
            skipped,
        )
        if args.once:
            break
        time.sleep(max(5, args.interval - elapsed))


if __name__ == "__main__":
    main()
