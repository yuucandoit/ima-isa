"""Cron-style semantic clustering worker.

Groups unassigned articles in the recent window into topic clusters using
cosine distance over pgvector embeddings (threshold < 0.25, span <= 4 hours,
minimum 5 articles from at least 2 outlets). Runs every `CLUSTER_INTERVAL_SECONDS`
or whenever the API pushes a job to `cluster:jobs`.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import signal
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import redis

import db
from config import settings
from nlp.embedder import get_embedder
from nlp.summarizer import generate_cluster_summary

#: Cosine distances differ by backend: transformer embeddings cluster around
#: 0.10–0.20 for same-topic copy, lexical (TF-hashing) vectors around 0.35–0.55.
AUTO_THRESHOLDS = {"transformer": 0.25, "lexical": 0.62}


def resolve_threshold() -> float:
    if settings.cluster_distance_threshold > 0:
        return settings.cluster_distance_threshold
    try:
        mode = get_embedder().mode
    except Exception:
        mode = "lexical"
    return AUTO_THRESHOLDS.get(mode, 0.62)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s · %(message)s",
)
logger = logging.getLogger("cluster-worker")

STOPWORDS = {
    "yang", "dan", "di", "ke", "dari", "untuk", "dengan", "pada", "akan", "ini", "itu",
    "tidak", "bisa", "jadi", "ada", "juga", "kata", "dalam", "atau", "the", "an",
    "para", "bagi", "oleh", "karena", "saat", "masih", "telah", "sudah", "lebih",
}


@dataclass
class WorkingCluster:
    centroid: list[float]
    weight: int
    first_seen: datetime
    last_seen: datetime
    items: list[dict[str, Any]] = field(default_factory=list)
    cluster_id: str | None = None


def cosine_distance(a: list[float], b: list[float]) -> float:
    length = min(len(a), len(b))
    if length == 0:
        return 1.0
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for index in range(length):
        value_a = a[index]
        value_b = b[index]
        dot += value_a * value_b
        norm_a += value_a * value_a
        norm_b += value_b * value_b
    if norm_a == 0 or norm_b == 0:
        return 1.0
    return 1.0 - dot / (math.sqrt(norm_a) * math.sqrt(norm_b))


def weighted_average(centroid: list[float], weight: int, vector: list[float]) -> list[float]:
    next_weight = weight + 1
    return [
        (centroid[index] * weight + vector[index]) / next_weight
        for index in range(min(len(centroid), len(vector)))
    ]


def average(vectors: list[list[float]]) -> list[float]:
    if not vectors:
        return []
    size = len(vectors[0])
    result = [0.0] * size
    for vector in vectors:
        for index in range(size):
            result[index] += vector[index]
    return [value / len(vectors) for value in result]


def dominant_sentiment(items: list[dict[str, Any]]) -> str:
    counter = Counter(str(item.get("sentiment") or "NEUTRAL") for item in items)
    return counter.most_common(1)[0][0] if counter else "NEUTRAL"


GENERIC_ORGANIZATIONS = {
    "pemerintah", "dpr", "dprd", "mpr", "bumn", "partai politik", "istana",
    "pemerintah provinsi dki jakarta", "pemprov dki", "pemkot", "pemkab",
}


def title_for(items: list[dict[str, Any]]) -> str:
    entity_counts: Counter[str] = Counter()
    for item in items:
        entities = item.get("entities") or {}
        if isinstance(entities, str):
            try:
                entities = json.loads(entities)
            except json.JSONDecodeError:
                entities = {}
        for person in entities.get("persons", []) or []:
            entity_counts[str(person)] += 2
        for organization in entities.get("organizations", []) or []:
            weight = 0.25 if str(organization).lower() in GENERIC_ORGANIZATIONS else 3
            entity_counts[str(organization)] += weight
        for location in entities.get("locations", []) or []:
            entity_counts[str(location)] += 1

    ranked = entity_counts.most_common(2)
    if ranked:
        return " & ".join(name for name, _ in ranked)

    word_counts: Counter[str] = Counter()
    for item in items:
        title = str(item.get("title") or "")
        for word in title.lower().replace("-", " ").split():
            cleaned = "".join(character for character in word if character.isalnum())
            if len(cleaned) > 4 and cleaned not in STOPWORDS:
                word_counts[cleaned] += 1
    top = [word.capitalize() for word, _ in word_counts.most_common(3)]
    return " · ".join(top) if top else (str(items[0].get("title") or "Klaster isu")[:80])


def vector_literal(values: list[float]) -> str:
    return db.vector_literal(values)


def run_once() -> dict[str, Any]:
    threshold = resolve_threshold()
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=settings.cluster_window_hours)
    existing_since = now - timedelta(hours=settings.cluster_window_hours * 2)

    with db.cursor() as cur:
        cur.execute(
            """
            SELECT mi.id, mi.title, mi.clean_content, mi.published_at, mi.source_id,
                   mi.sentiment, mi.entities, mi.embedding::text AS embedding_text
            FROM media_items mi
            WHERE mi.published_at >= %s
              AND mi.embedding IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM cluster_items ci WHERE ci.media_item_id = mi.id
              )
            ORDER BY mi.published_at ASC
            """,
            (since,),
        )
        item_rows = cur.fetchall()

        cur.execute(
            """
            SELECT id, centroid::text AS centroid_text, total_articles,
                   first_seen_at, last_updated
            FROM topic_clusters
            WHERE last_updated >= %s AND centroid IS NOT NULL
            """,
            (existing_since,),
        )
        cluster_rows = cur.fetchall()

    working: list[WorkingCluster] = []
    for row in cluster_rows:
        centroid = db.parse_vector(row["centroid_text"])
        if not centroid:
            continue
        working.append(
            WorkingCluster(
                centroid=centroid,
                weight=int(row["total_articles"] or 1),
                first_seen=row["first_seen_at"],
                last_seen=row["last_updated"],
                cluster_id=str(row["id"]),
            )
        )

    scanned = 0
    for row in item_rows:
        vector = db.parse_vector(row["embedding_text"])
        if not vector:
            continue
        scanned += 1
        item = {
            "id": str(row["id"]),
            "title": row["title"],
            "content": row["clean_content"],
            "published_at": row["published_at"],
            "source_id": str(row["source_id"]) if row["source_id"] else None,
            "sentiment": row["sentiment"],
            "entities": row["entities"] or {},
        }

        best: tuple[WorkingCluster, float] | None = None
        for cluster in working:
            span_hours = (item["published_at"] - cluster.first_seen).total_seconds() / 3600
            if span_hours > settings.cluster_max_span_hours:
                continue
            distance = cosine_distance(vector, cluster.centroid)
            if distance <= threshold and (
                best is None or distance < best[1]
            ):
                best = (cluster, distance)

        if best:
            cluster = best[0]
            cluster.centroid = weighted_average(cluster.centroid, cluster.weight, vector)
            cluster.weight += 1
            cluster.items.append(item)
            if item["published_at"] > cluster.last_seen:
                cluster.last_seen = item["published_at"]
        else:
            working.append(
                WorkingCluster(
                    centroid=list(vector),
                    weight=1,
                    first_seen=item["published_at"],
                    last_seen=item["published_at"],
                    items=[item],
                )
            )

    created = 0
    updated = 0
    assigned_existing = 0
    skipped = 0

    with db.cursor() as cur:
        for cluster in working:
            if not cluster.items:
                continue
            distinct_sources = len({item["source_id"] for item in cluster.items if item["source_id"]})

            if cluster.cluster_id is None:
                if (
                    len(cluster.items) < settings.cluster_min_items
                    or distinct_sources < settings.cluster_min_sources
                ):
                    skipped += len(cluster.items)
                    continue

                centroid = cluster.centroid
                cur.execute(
                    """
                    INSERT INTO topic_clusters
                        (title, dominant_sentiment, total_articles, centroid,
                         first_seen_at, last_updated)
                    VALUES (%s, %s::sentiment_label, %s, %s::vector, %s, %s)
                    RETURNING id
                    """,
                    (
                        title_for(cluster.items),
                        dominant_sentiment(cluster.items),
                        len(cluster.items),
                        vector_literal(centroid),
                        cluster.first_seen,
                        cluster.last_seen,
                    ),
                )
                new_id = cur.fetchone()["id"]
                cur.executemany(
                    "INSERT INTO cluster_items (cluster_id, media_item_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    [(new_id, item["id"]) for item in cluster.items],
                )
                created += 1
            else:
                cur.executemany(
                    "INSERT INTO cluster_items (cluster_id, media_item_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    [(cluster.cluster_id, item["id"]) for item in cluster.items],
                )
                assigned_existing += len(cluster.items)

                cur.execute(
                    """
                    SELECT count(*)::int AS total,
                           avg(mi.embedding)::text AS centroid,
                           min(mi.published_at) AS first_seen,
                           max(mi.published_at) AS last_seen
                    FROM cluster_items ci
                    JOIN media_items mi ON mi.id = ci.media_item_id
                    WHERE ci.cluster_id = %s
                    """,
                    (cluster.cluster_id,),
                )
                aggregate = cur.fetchone()
                total = int(aggregate["total"] or 0)
                if total < settings.cluster_min_items:
                    skipped += len(cluster.items)
                    continue

                cur.execute(
                    """
                    SELECT mi.title, mi.entities, mi.sentiment
                    FROM cluster_items ci
                    JOIN media_items mi ON mi.id = ci.media_item_id
                    WHERE ci.cluster_id = %s
                    ORDER BY mi.published_at DESC
                    LIMIT 40
                    """,
                    (cluster.cluster_id,),
                )
                members = cur.fetchall()
                centroid_text = aggregate["centroid"] or vector_literal(cluster.centroid)
                cur.execute(
                    """
                    UPDATE topic_clusters SET
                        title = %s,
                        dominant_sentiment = %s::sentiment_label,
                        total_articles = %s,
                        centroid = %s::vector,
                        first_seen_at = %s,
                        last_updated = %s
                    WHERE id = %s
                    """,
                    (
                        title_for(members),
                        dominant_sentiment(members),
                        total,
                        centroid_text,
                        aggregate["first_seen"],
                        aggregate["last_seen"],
                        cluster.cluster_id,
                    ),
                )
                updated += 1

        if settings.generate_cluster_summaries and (created or updated):
            cur.execute(
                """
                SELECT c.id, c.title, c.dominant_sentiment
                FROM topic_clusters c
                WHERE c.last_updated >= %s AND c.summary IS NULL
                  AND c.total_articles >= %s
                ORDER BY c.last_updated DESC LIMIT 5
                """,
                (since, settings.cluster_min_items),
            )
            for cluster_row in cur.fetchall():
                cur.execute(
                    """
                    SELECT mi.title, mi.clean_content, s.name AS source_name
                    FROM cluster_items ci
                    JOIN media_items mi ON mi.id = ci.media_item_id
                    LEFT JOIN sources s ON s.id = mi.source_id
                    WHERE ci.cluster_id = %s
                    ORDER BY mi.published_at DESC LIMIT 12
                    """,
                    (cluster_row["id"],),
                )
                articles = cur.fetchall()
                generated = generate_cluster_summary(cluster_row, articles)
                if generated:
                    summary, _model = generated
                    cur.execute(
                        "UPDATE topic_clusters SET summary = %s WHERE id = %s",
                        (summary, cluster_row["id"]),
                    )

    result = {
        "scanned": scanned,
        "assignedToExisting": assigned_existing,
        "clustersCreated": created,
        "clustersUpdated": updated,
        "skipped": skipped,
        "updatedAt": now.isoformat(),
    }
    logger.info(
        "clustering done — scanned=%d created=%d updated=%d existing=%d skipped=%d",
        scanned,
        created,
        updated,
        assigned_existing,
        skipped,
    )
    return result


def publish_result(client: redis.Redis, result: dict[str, Any]) -> None:
    try:
        client.publish("clusters:updated", json.dumps(result, ensure_ascii=False))
    except redis.RedisError as error:
        logger.warning("publish failed: %s", error)


def main() -> None:
    parser = argparse.ArgumentParser(description="Semantic topic clustering worker")
    parser.add_argument("--once", action="store_true", help="Run one clustering pass and exit")
    parser.add_argument(
        "--interval", type=int, default=settings.cluster_interval_seconds
    )
    args = parser.parse_args()

    client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    consumer = f"cluster-{os.getpid()}"
    try:
        client.xgroup_create(
            settings.cluster_jobs_stream, "cluster-workers", id="$", mkstream=True
        )
    except redis.ResponseError as error:
        if "BUSYGROUP" not in str(error):
            logger.warning("cluster job group: %s", error)
    except redis.RedisError as error:
        logger.warning("Redis unavailable at startup: %s", error)

    if args.once:
        publish_result(client, run_once())
        return

    running = True

    def stop(*_args: Any) -> None:
        nonlocal running
        logger.info("Shutdown signal received…")
        running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    logger.info(
        "Cluster worker started — every %ss, threshold=%.2f, min=%d, span=%sh",
        args.interval,
        settings.cluster_distance_threshold,
        settings.cluster_min_items,
        settings.cluster_max_span_hours,
    )
    last_run = 0.0
    while running:
        job = None
        try:
            response = client.xreadgroup(
                "cluster-workers",
                consumer,
                {settings.cluster_jobs_stream: ">"},
                count=1,
                block=5_000,
            )
            if response:
                for _, messages in response:
                    for message_id, _fields in messages:
                        client.xack(
                            settings.cluster_jobs_stream, "cluster-workers", message_id
                        )
                        job = message_id
        except redis.RedisError as error:
            logger.debug("job read failed: %s", error)

        if job or (time.time() - last_run) >= args.interval:
            try:
                publish_result(client, run_once())
            except Exception as error:
                logger.exception("clustering failed: %s", error)
            last_run = time.time()


if __name__ == "__main__":
    main()
