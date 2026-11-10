"""Redis Streams → AI enrichment daemon.

Consumes `media:raw`, normalises slang, runs 3-class sentiment + NER + embedding,
persists to PostgreSQL/pgvector, and publishes `media:new` to Redis for the SSE
gateway.
"""

from __future__ import annotations

import json
import logging
import signal
import socket
import sys
from datetime import datetime, timezone
from typing import Any

import redis
from psycopg.types.json import Jsonb

import db
from config import settings
from nlp.embedder import get_embedder
from nlp.ner import get_extractor
from nlp.normalizer import clean_body, clean_text, extract_hashtags, summarize_text
from nlp.sentiment import get_analyzer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s · %(message)s",
)
logger = logging.getLogger("worker")


def parse_datetime(value: Any) -> str:
    if not value:
        return datetime.now(timezone.utc).isoformat()
    if isinstance(value, datetime):
        return value.isoformat()
    text = str(value).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text).isoformat()
    except ValueError:
        return datetime.now(timezone.utc).isoformat()


class AIWorker:
    def __init__(self) -> None:
        self.redis = redis.Redis.from_url(settings.redis_url, decode_responses=True)
        self.consumer = f"{settings.consumer_name}-{socket.gethostname()}"
        self.running = True
        self.source_cache: dict[str, str] = {}
        self.sentiment = get_analyzer()
        self.ner = get_extractor()
        self.embedder = get_embedder()
        self.processed = 0

    def announce_embedding_mode(self) -> None:
        """Publish which embedding backend is active so the API can pick a
        matching cosine-distance threshold for clustering."""
        try:
            mode = getattr(self.embedder, "mode", "lexical")
            self.redis.set("nlp:embedding_mode", mode)
            logger.info("Embedding backend: %s", mode)
        except redis.RedisError as error:
            logger.debug("cannot publish embedding mode: %s", error)

    def ensure_group(self) -> None:
        try:
            self.redis.xgroup_create(
                settings.raw_stream, settings.consumer_group, id="0", mkstream=True
            )
            logger.info(
                "Created consumer group '%s' on '%s'",
                settings.consumer_group,
                settings.raw_stream,
            )
        except redis.ResponseError as error:
            if "BUSYGROUP" not in str(error):
                raise

    def source_id(self, cur, payload: dict[str, Any]) -> str | None:
        domain = str(payload.get("domain") or "").strip().lower()
        if not domain:
            return None
        if domain in self.source_cache:
            return self.source_cache[domain]

        cur.execute(
            """
            INSERT INTO sources (name, domain, platform, rss_url, is_active)
            VALUES (%s, %s, %s::source_platform, %s, 'true')
            ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
            """,
            (
                payload.get("sourceName") or domain,
                domain,
                payload.get("platform", "NEWS_MEDIA"),
                payload.get("feedUrl"),
            ),
        )
        row = cur.fetchone()
        if row:
            self.source_cache[domain] = str(row["id"])
            return self.source_cache[domain]
        return None

    def process(self, raw_payload: str) -> dict[str, Any] | None:
        payload = json.loads(raw_payload)
        title = clean_text(str(payload.get("title") or ""))
        content = clean_body(str(payload.get("content") or payload.get("summary") or ""))
        if not title:
            raise ValueError("payload tanpa judul")

        analysis_text = f"{title}. {content}"[: settings.max_analysis_chars]
        sentiment = self.sentiment.analyze(analysis_text)
        entities = self.ner.extract(analysis_text)
        hashtags = list(payload.get("hashtags") or [])
        if not hashtags:
            hashtags = extract_hashtags(
                str(payload.get("title") or "")
                + " "
                + str(payload.get("content") or payload.get("summary") or "")
            )
        if hashtags:
            entities["hashtags"] = hashtags
        embedding = self.embedder.encode(analysis_text)
        external_id = str(payload.get("externalId") or "").strip()
        if not external_id:
            raise ValueError("payload tanpa externalId")

        with db.cursor() as cur:
            source_id = self.source_id(cur, payload)
            cur.execute(
                """
                INSERT INTO media_items (
                    source_id, platform, external_id, url, author, title,
                    raw_content, clean_content, sentiment, sentiment_score,
                    entities, embedding, published_at
                ) VALUES (
                    %s, %s::source_platform, %s, %s, %s, %s,
                    %s, %s, %s::sentiment_label, %s,
                    %s, %s::vector, %s
                )
                ON CONFLICT (external_id) DO NOTHING
                RETURNING id
                """,
                (
                    source_id,
                    payload.get("platform", "NEWS_MEDIA"),
                    external_id,
                    payload.get("url") or "",
                    payload.get("author"),
                    title,
                    content or title,
                    content or title,
                    sentiment.label,
                    sentiment.score,
                    Jsonb(entities),
                    db.vector_literal(embedding),
                    parse_datetime(payload.get("publishedAt")),
                ),
            )
            inserted = cur.fetchone()

        if not inserted:
            logger.debug("duplicate skipped: %s", title[:80])
            return None

        event = {
            "id": str(inserted["id"]),
            "title": title,
            "url": payload.get("url") or "",
            "sourceName": payload.get("sourceName") or payload.get("domain") or "Media",
            "sourceDomain": payload.get("domain") or "",
            "platform": payload.get("platform", "NEWS_MEDIA"),
            "sentiment": sentiment.label,
            "sentimentScore": sentiment.score,
            "publishedAt": parse_datetime(payload.get("publishedAt")),
            "summary": summarize_text(content or title, 240),
            "entities": entities,
        }

        try:
            self.redis.publish("media:new", json.dumps(event, ensure_ascii=False))
            self.redis.xadd(
                settings.processed_stream,
                {"payload": json.dumps(event, ensure_ascii=False)},
                maxlen=20_000,
                approximate=True,
            )
        except redis.RedisError as error:
            logger.warning("publish failed: %s", error)

        self.processed += 1
        return event

    def dead_letter(self, message_id: str, raw: str, error: Exception) -> None:
        logger.error("message %s failed: %s", message_id, error)
        try:
            self.redis.xadd(
                settings.dead_stream,
                {
                    "payload": raw,
                    "error": str(error),
                    "messageId": message_id,
                },
                maxlen=2_000,
                approximate=True,
            )
        except redis.RedisError:
            pass

    def run(self) -> None:
        self.ensure_group()
        self.announce_embedding_mode()
        logger.info(
            "AI worker '%s' listening on '%s' (group %s, transformers=%s, spacy=%s)",
            self.consumer,
            settings.raw_stream,
            settings.consumer_group,
            settings.use_transformers,
            settings.use_spacy,
        )

        while self.running:
            try:
                response = self.redis.xreadgroup(
                    settings.consumer_group,
                    self.consumer,
                    {settings.raw_stream: ">"},
                    count=settings.batch_size,
                    block=settings.block_ms,
                )
            except redis.RedisError as error:
                logger.warning("redis read failed: %s", error)
                continue

            if not response:
                continue

            for _, messages in response:
                for message_id, fields in messages:
                    raw = fields.get("payload", "")
                    try:
                        event = self.process(raw)
                        if event:
                            logger.info(
                                "✓ %s [%s %.2f] %s",
                                event["sourceDomain"] or "media",
                                event["sentiment"],
                                event["sentimentScore"],
                                event["title"][:90],
                            )
                        self.redis.xack(settings.raw_stream, settings.consumer_group, message_id)
                    except Exception as error:
                        self.dead_letter(message_id, raw, error)
                        self.redis.xack(settings.raw_stream, settings.consumer_group, message_id)

        logger.info("Worker stopped. %d articles processed.", self.processed)

    def stop(self, *_args: Any) -> None:
        logger.info("Shutdown signal received…")
        self.running = False


def main() -> None:
    worker = AIWorker()
    signal.signal(signal.SIGINT, worker.stop)
    signal.signal(signal.SIGTERM, worker.stop)
    try:
        worker.run()
    except KeyboardInterrupt:
        worker.stop()
    except Exception as error:
        logger.exception("Fatal worker error: %s", error)
        sys.exit(1)


if __name__ == "__main__":
    main()
