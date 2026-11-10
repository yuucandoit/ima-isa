"""Small psycopg helpers shared by the worker and cluster cron."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row

from config import settings

logger = logging.getLogger(__name__)


def connect() -> psycopg.Connection:
    return psycopg.connect(settings.database_url, row_factory=dict_row, connect_timeout=10)


@contextmanager
def cursor() -> Iterator[psycopg.Cursor]:
    with connect() as conn:
        with conn.cursor() as cur:
            yield cur
        conn.commit()


def vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.6f}" for value in values) + "]"


def parse_vector(value: Any) -> list[float] | None:
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return [float(item) for item in value]
    text = str(value).strip().strip("[]")
    if not text:
        return None
    try:
        return [float(item) for item in text.split(",")]
    except ValueError:
        logger.warning("Unable to parse embedding vector")
        return None


def ensure_extensions() -> None:
    try:
        with cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
    except Exception as error:  # pragma: no cover - optional at runtime
        logger.warning("pgvector extension check failed: %s", error)
