"""Social media adapters (X/Twitter API v2 + YouTube public RSS).

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


def poll_x_trends() -> int:
    """Ambil daftar trending X untuk WOEID tertentu dan simpan ke social_trends."""
    if not settings.x_bearer_token:
        return 0

    url = f"https://api.x.com/2/trends/by/woeid/{settings.x_trends_woeid}"
    try:
        response = requests.get(
            url,
            headers={
                "Authorization": f"Bearer {settings.x_bearer_token}",
                "User-Agent": settings.user_agent,
            },
            timeout=20,
        )
        response.raise_for_status()
        body = response.json()
    except Exception as error:
        logger.warning("X trends poll failed: %s", error)
        return 0

    trends = body.get("data") or body.get("trends") or []
    if not trends:
        logger.info("X trends: tidak ada data untuk WOEID %s", settings.x_trends_woeid)
        return 0

    rows: list[tuple[Any, ...]] = []
    seen: set[str] = set()
    for rank, trend in enumerate(trends, start=1):
        if not isinstance(trend, dict):
            continue
        name = str(
            trend.get("trend_name")
            or trend.get("name")
            or trend.get("query")
            or ""
        ).strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        volume = trend.get("tweet_count") or trend.get("tweet_volume")
        try:
            volume_value = int(volume) if volume is not None else None
        except (TypeError, ValueError):
            volume_value = None
        query = trend.get("query") or name
        rows.append(
            (
                settings.x_trends_region,
                settings.x_trends_woeid,
                name,
                rank,
                volume_value,
                f"https://x.com/search?q={quote(str(query))}",
                json.dumps(trend, ensure_ascii=False),
            )
        )

    if not rows:
        return 0

    try:
        with db.cursor() as cur:
            cur.execute(
                "DELETE FROM social_trends WHERE captured_at < now() - interval '7 days'"
            )
            cur.executemany(
                """
                INSERT INTO social_trends
                    (platform, region, woeid, name, rank, tweet_volume, url, raw)
                VALUES ('TWITTER_X', %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                rows,
            )
    except Exception as error:
        logger.warning("X trends insert failed: %s", error)
        return 0

    logger.info("X trends: %d tren disimpan untuk %s", len(rows), settings.x_trends_region)
    return len(rows)


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
            trends = poll_x_trends()
            logger.info(
                "social cycle done: %d new payloads, %d trends",
                pushed,
                trends,
            )
        except Exception as error:
            logger.warning("social cycle failed: %s", error)
        if args.once:
            break
        time.sleep(max(10, args.interval))


if __name__ == "__main__":
    main()
