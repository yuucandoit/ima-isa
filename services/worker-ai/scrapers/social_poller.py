"""Social media adapters (X/Twitter API v2 + YouTube public RSS).

Tren X/TikTok/Google **tidak** diambil di sini — lihat `trends_poller.py`.

Both adapters are optional and disabled unless credentials / channel IDs are
configured. They push the same `media:raw` payload contract as the RSS poller.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import feedparser
import redis
import requests

import db
from config import settings
from nlp.normalizer import clean_text, extract_hashtags, summarize_text

logger = logging.getLogger(__name__)


def _external_id(platform: str, identifier: str) -> str:
    return hashlib.sha256(f"{platform}|{identifier}".encode("utf-8")).hexdigest()


def _push(client: redis.Redis, payload: dict[str, Any]) -> bool:
    key = f"dedupe:media:{payload['externalId']}"
    try:
        if not client.set(key, "1", nx=True, ex=settings.dedupe_ttl_seconds):
            return False
        client.xadd(settings.raw_stream, {"payload": json.dumps(payload, ensure_ascii=False)})
        return True
    except redis.RedisError as error:
        logger.warning("social push failed: %s", error)
        return False


def poll_x(client: redis.Redis) -> int:
    if not settings.x_bearer_token:
        return 0
    url = "https://api.twitter.com/2/tweets/search/recent"
    params = {
        "query": settings.x_query,
        "max_results": 25,
        "tweet.fields": "created_at,author_id,lang,public_metrics",
        "expansions": "author_id",
        "user.fields": "username,name,verified",
    }
    try:
        response = requests.get(
            url,
            params=params,
            headers={"Authorization": f"Bearer {settings.x_bearer_token}"},
            timeout=20,
        )
        response.raise_for_status()
        body = response.json()
    except Exception as error:
        logger.warning("X poll failed: %s", error)
        return 0

    users = {
        user["id"]: user
        for user in body.get("includes", {}).get("users", [])
    }
    pushed = 0
    for tweet in body.get("data", []):
        author = users.get(tweet.get("author_id"), {})
        raw_text = tweet.get("text", "") or ""
        text = clean_text(raw_text)
        if not text:
            continue
        payload = {
            "externalId": _external_id("x", tweet["id"]),
            "platform": "TWITTER_X",
            "sourceName": author.get("name") or author.get("username") or "X / Twitter",
            "domain": "x.com",
            "url": f"https://x.com/{author.get('username', 'i')}/status/{tweet['id']}",
            "author": author.get("username"),
            "title": summarize_text(text, 120),
            "summary": summarize_text(text, 280),
            "content": text,
            "hashtags": extract_hashtags(raw_text),
            "publishedAt": tweet.get("created_at", datetime.now(timezone.utc).isoformat()),
        }
        if _push(client, payload):
            pushed += 1
    logger.info("X: %d new posts", pushed)
    return pushed


def poll_youtube(client: redis.Redis) -> int:
    if not settings.youtube_channel_ids:
        return 0
    pushed = 0
    for channel_id in settings.youtube_channel_ids:
        feed = feedparser.parse(
            f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}",
            agent=settings.user_agent,
        )
        channel_name = getattr(feed.feed, "title", "YouTube")
        for entry in feed.entries[:10]:
            raw_title = getattr(entry, "title", "") or ""
            raw_summary = getattr(entry, "summary", "") or raw_title
            title = clean_text(raw_title)
            link = getattr(entry, "link", "")
            if not title or not link:
                continue
            published = getattr(entry, "published", None) or datetime.now(timezone.utc).isoformat()
            payload = {
                "externalId": _external_id("youtube", link),
                "platform": "YOUTUBE",
                "sourceName": channel_name,
                "domain": "youtube.com",
                "url": link,
                "author": channel_name,
                "title": title,
                "summary": title,
                "content": clean_text(raw_summary),
                "hashtags": extract_hashtags(f"{raw_title} {raw_summary}"),
                "publishedAt": published,
            }
            if _push(client, payload):
                pushed += 1
    logger.info("YouTube: %d new videos", pushed)
    return pushed


def main() -> None:
    parser = argparse.ArgumentParser(description="X/Twitter + YouTube poller")
    parser.add_argument("--once", action="store_true", help="Run one cycle and exit")
    parser.add_argument(
        "--interval",
        type=int,
        default=int(os.getenv("SOCIAL_POLL_INTERVAL_SECONDS", "300")),
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s · %(message)s",
    )
    client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    logger.info(
        "Social poller started (X=%s, YouTube channels=%d, interval=%ss)",
        bool(settings.x_bearer_token),
        len(settings.youtube_channel_ids),
        args.interval,
    )
    while True:
        try:
            pushed = poll_x(client) + poll_youtube(client)
            # Tren (X/TikTok/Google) ditangani `trends_poller.py` agar kadens
            # per platform bisa berbeda dan tidak ada dua penulis snapshot.
            logger.info("social cycle done: %d new payloads", pushed)
        except Exception as error:
            logger.warning("social cycle failed: %s", error)
        if args.once:
            break
        time.sleep(max(10, args.interval))


if __name__ == "__main__":
    main()
