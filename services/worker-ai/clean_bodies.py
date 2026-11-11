"""Rapikan seluruh detail berita (`media_items.clean_content`) di database.

Tiga tahap per baris:

1. **Klasifikasi** — `ok`, `noisy` (banyak chrome situs), `thin` (hanya judul /
   ringkasan RSS), `junk` (sisa inline JS/CSS dari extractor lama), `empty`.
2. **Perbaikan** — baris bermasalah diambil ulang dari URL aslinya (URL Google
   News didekode dulu); hasilnya dipakai bila memang lebih baik. Semua baris
   lalu dinormalisasi: judul yang diulang, metadata redaksi, link "Baca juga",
   `ADVERTISEMENT`, nama situs di ekor, dan paragraf duplikat dibuang.
3. **Turunan (opsional)** — `--refresh-nlp` menghitung ulang sentimen, entitas,
   dan embedding dari badan artikel yang baru, supaya analitik tidak lagi
   berpatokan pada teks yang tipis/tercemar.

Contoh:

    python clean_bodies.py                       # laporan saja (dry-run)
    python clean_bodies.py --apply               # tulis perubahan
    python clean_bodies.py --state junk,thin --apply --workers 6
    python clean_bodies.py --apply --refresh-nlp --rewrite-url
    python clean_bodies.py --source tribunnews.com --limit 50 --report out.json

Catatan: `raw_content` tidak diubah (dibiarkan sebagai bukti asli hasil ingest).
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator
from urllib.parse import urlparse

import db
from config import settings
from nlp.embedder import get_embedder
from nlp.ner import get_extractor
from nlp.sentiment import get_analyzer
from scrapers.body_cleaner import (
    MIN_BODY_CHARS,
    body_is_better,
    classify_body,
    looks_like_code,
    normalize_article_body,
)
from scrapers.extractor import extract_article
from scrapers.google_news import is_google_news_url, resolve_article_url

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
logger = logging.getLogger("clean_bodies")

REFETCH_STATES = {"noisy", "thin", "junk", "empty"}

SELECT_COLUMNS = """
    m.id, m.url, m.title, m.clean_content, m.published_at,
    m.sentiment, m.sentiment_score,
    m.source_id, s.name AS source_name, s.domain
"""


@dataclass
class Decision:
    row: dict[str, Any]
    state: str
    action: str = "keep"
    reason: str = ""
    body: str = ""
    new_url: str | None = None
    refetched: bool = False
    noticed: bool = False
    error: str | None = None


@dataclass
class Stats:
    scanned: int = 0
    changed: int = 0
    unchanged: int = 0
    refetch_ok: int = 0
    refetch_failed: int = 0
    gnews_resolved: int = 0
    gnews_failed: int = 0
    nlp_refreshed: int = 0
    kept_original: int = 0
    by_state: dict[str, int] = field(default_factory=dict)

    def bump_state(self, state: str) -> None:
        self.by_state[state] = self.by_state.get(state, 0) + 1


def _iter_batches(
    *,
    source: str | None,
    since: str | None,
    platform: str | None,
    limit: int,
    batch: int,
) -> Iterable[list[dict[str, Any]]]:
    """Keyset pagination agar aman untuk tabel besar (tidak pakai OFFSET)."""
    filters = ["1 = 1"]
    params: list[Any] = []
    if source:
        filters.append("s.domain = %s")
        params.append(source)
    if platform:
        filters.append("m.platform = %s::source_platform")
        params.append(platform)
    if since:
        filters.append("m.published_at >= %s")
        params.append(since)
    where = " AND ".join(filters)

    remaining = limit
    last_published: datetime | None = None
    last_id: str | None = None

    while remaining > 0:
        page_size = min(batch, remaining)
        keyset = ""
        page_params = list(params)
        if last_published is not None and last_id is not None:
            keyset = "AND (m.published_at, m.id) < (%s, %s)"
            page_params.extend([last_published, last_id])
        sql = f"""
            SELECT {SELECT_COLUMNS}
            FROM media_items m
            LEFT JOIN sources s ON s.id = m.source_id
            WHERE {where} {keyset}
            ORDER BY m.published_at DESC, m.id DESC
            LIMIT %s
        """
        page_params.append(page_size)
        with db.cursor() as cur:
            cur.execute(sql, page_params)
            rows = cur.fetchall()
        if not rows:
            return
        yield rows
        remaining -= len(rows)
        last_published = rows[-1]["published_at"]
        last_id = rows[-1]["id"]


@dataclass
class Refetch:
    """Hasil percobaan ambil-ulang satu artikel."""

    body: str | None = None
    real_url: str | None = None
    was_gnews: bool = False
    error: str | None = None


class DomainLimiter:
    """Batasi laju permintaan per domain agar tidak diblokir (HTTP 202/429)."""

    def __init__(self, min_interval: float, max_parallel: int = 1) -> None:
        self.min_interval = max(0.0, min_interval)
        self.max_parallel = max(1, max_parallel)
        self._guard = threading.Lock()
        self._slots: dict[str, threading.Semaphore] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._last: dict[str, float] = {}

    @contextmanager
    def slot(self, domain: str) -> Iterator[None]:
        with self._guard:
            semaphore = self._slots.setdefault(domain, threading.Semaphore(self.max_parallel))
            lock = self._locks.setdefault(domain, threading.Lock())
        with semaphore, lock:
            wait = self.min_interval - (time.monotonic() - self._last.get(domain, 0.0))
            if wait > 0:
                time.sleep(wait)
            self._last[domain] = time.monotonic()
            yield


RETRY_STATUS = {408, 425, 429, 500, 502, 503, 504}
BLOCKED_STATUS = {202, 401, 403, 451}
BLOCKED_DOMAINS: set[str] = set()
_blocked_guard = threading.Lock()


def _is_blocked(domain: str) -> bool:
    with _blocked_guard:
        return domain in BLOCKED_DOMAINS


def _mark_blocked(domain: str) -> None:
    with _blocked_guard:
        if domain not in BLOCKED_DOMAINS:
            logger.warning("%s memblokir permintaan (HTTP 202/403) — domain dilewati", domain)
        BLOCKED_DOMAINS.add(domain)


def _refetch(
    row: dict[str, Any],
    limiter: DomainLimiter | None = None,
    *,
    retries: int = 2,
    retry_delay: float = 2.0,
) -> Refetch:
    url = str(row["url"] or "").strip()
    if not url:
        return Refetch(error="url-kosong")

    was_gnews = is_google_news_url(url)
    resolved = resolve_article_url(url, timeout=settings.rss_timeout_seconds)
    if was_gnews and resolved == url:
        return Refetch(was_gnews=True, error="google-news")

    real_url = resolved if resolved != url else None
    domain = urlparse(resolved).netloc
    title = str(row["title"] or "")
    error = "ekstraksi-kosong"

    if _is_blocked(domain):
        return Refetch(real_url=real_url, was_gnews=was_gnews, error="diblokir")

    for attempt in range(max(1, retries + 1)):
        if limiter is not None:
            with limiter.slot(domain):
                extracted = extract_article(resolved, title=title)
        else:
            extracted = extract_article(resolved, title=title)

        body = str(extracted.get("text") or "")
        if body and not looks_like_code(body) and len(body) >= MIN_BODY_CHARS:
            return Refetch(body=body, real_url=real_url, was_gnews=was_gnews)

        status = extracted.get("status")
        error = f"http-{status}" if isinstance(status, int) else error
        if isinstance(status, int) and status in BLOCKED_STATUS:
            _mark_blocked(domain)
            break
        retryable = not isinstance(status, int) or status in RETRY_STATUS
        if attempt < retries and retryable:
            time.sleep(retry_delay * (attempt + 1))
            continue
        break

    return Refetch(real_url=real_url, was_gnews=was_gnews, error=error)


def _normalize_existing(row: dict[str, Any]) -> str:
    return normalize_article_body(
        str(row["clean_content"] or ""),
        title=str(row["title"] or ""),
        source=row.get("source_name"),
        domain=row.get("domain"),
    )


def _decide(row: dict[str, Any], refetch: Refetch | None) -> Decision:
    current = str(row["clean_content"] or "")
    state = classify_body(current, str(row["title"] or ""))
    decision = Decision(row=row, state=state)

    refetch = refetch or Refetch()
    if refetch.error == "google-news":
        decision.reason = "google-news-tidak-terdekode"
    elif refetch.body:
        decision.refetched = True
        decision.reason = "ekstraksi-ulang"
    elif refetch.error == "fetch":
        decision.reason = "ekstraksi-gagal"

    candidate = refetch.body or _normalize_existing(row)

    if not candidate:
        decision.body = current
        decision.reason = decision.reason or "kosong-setelah-normalisasi"
        return decision

    if not refetch.body and len(candidate) < 80 and len(current.strip()) >= 80:
        # Normalisasi membuang hampir semuanya: jangan sampai data hilang.
        decision.body = current
        decision.reason = "dipertahankan-utuh"
        decision.noticed = True
        return decision

    if refetch.body and not body_is_better(refetch.body, current):
        decision.body = _normalize_existing(row) or current
        decision.reason = "hasil-ekstraksi-lebih-pendek"
        return decision

    decision.body = candidate
    decision.reason = decision.reason or "normalisasi"
    if refetch.real_url:
        decision.new_url = refetch.real_url
    if decision.body.strip() != current.strip():
        decision.action = "update"
    return decision


def _nlp_payload(title: str, body: str) -> tuple[str, float, dict[str, Any], list[float]]:
    analyzer = get_analyzer()
    extractor = get_extractor()
    embedder = get_embedder()

    text = f"{title}. {body}"[: settings.max_analysis_chars]
    sentiment = analyzer.analyze(text)
    entities = extractor.extract(text)
    embedding = embedder.encode(text)
    return sentiment.label, sentiment.score, entities, embedding


def _write(decisions: list[Decision], *, refresh_nlp: bool, rewrite_url: bool) -> int:
    from psycopg.types.json import Jsonb

    written = 0
    with db.cursor() as cur:
        for decision in decisions:
            if decision.action != "update" and not (rewrite_url and decision.new_url):
                continue
            if refresh_nlp:
                label, score, entities, embedding = _nlp_payload(
                    str(decision.row["title"] or ""), decision.body
                )
                cur.execute(
                    """
                    UPDATE media_items
                    SET clean_content = %s,
                        sentiment = %s::sentiment_label,
                        sentiment_score = %s,
                        entities = %s,
                        embedding = %s::vector,
                        url = COALESCE(%s, url)
                    WHERE id = %s
                    """,
                    (
                        decision.body,
                        label,
                        score,
                        Jsonb(entities),
                        db.vector_literal(embedding),
                        decision.new_url if rewrite_url else None,
                        decision.row["id"],
                    ),
                )
            else:
                cur.execute(
                    """
                    UPDATE media_items
                    SET clean_content = %s, url = COALESCE(%s, url)
                    WHERE id = %s
                    """,
                    (
                        decision.body,
                        decision.new_url if rewrite_url else None,
                        decision.row["id"],
                    ),
                )
            written += 1
    return written


def _line(decision: Decision) -> str:
    row = decision.row
    before = len(str(row["clean_content"] or ""))
    after = len(decision.body)
    body = f"{before}→{after:>5}"
    title = str(row["title"] or "")[:48]
    return (
        f"  {decision.state:<6} {decision.action:<6} {body} "
        f"{(row.get('domain') or '?'):<20} {title:<50} {decision.reason}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Rapikan detail berita (clean_content) seluruh database.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--apply", action="store_true", help="tulis perubahan (default: dry-run)")
    parser.add_argument("--limit", type=int, default=0, help="maksimum baris diproses (0 = semua)")
    parser.add_argument("--batch", type=int, default=50, help="ukuran batch baca DB")
    parser.add_argument("--source", help="filter domain, mis. tribunnews.com")
    parser.add_argument("--platform", help="filter platform, mis. NEWS_MEDIA")
    parser.add_argument("--since", help="hanya artikel sejak tanggal ini (YYYY-MM-DD)")
    parser.add_argument(
        "--state",
        default="",
        help="filter status: ok,noisy,thin,junk,empty (default: semua)",
    )
    parser.add_argument(
        "--refetch-all",
        action="store_true",
        help="ambil ulang semua baris, bukan hanya yang bermasalah",
    )
    parser.add_argument("--workers", type=int, default=4, help="unduhan paralel (antar domain)")
    parser.add_argument("--retry", type=int, default=2, help="percobaan ulang saat HTTP 202/429/5xx")
    parser.add_argument("--retry-delay", type=float, default=2.0, help="jeda dasar backoff (detik)")
    parser.add_argument(
        "--domain-interval",
        type=float,
        default=1.0,
        help="jeda minimum antar unduhan untuk domain yang sama (detik)",
    )
    parser.add_argument(
        "--per-domain",
        type=int,
        default=1,
        help="maksimum unduhan bersamaan per domain",
    )
    parser.add_argument("--refresh-nlp", action="store_true", help="hitung ulang sentimen/entitas/embedding")
    parser.add_argument("--rewrite-url", action="store_true", help="simpan URL asli hasil dekode Google News")
    parser.add_argument("--report", help="tulis laporan JSON ke path ini")
    parser.add_argument("--show", type=int, default=20, help="jumlah contoh perubahan yang dicetak")
    parser.add_argument("--quiet", action="store_true", help="hanya cetak ringkasan")
    args = parser.parse_args()

    states = {state.strip() for state in args.state.split(",") if state.strip()} or None
    limit = args.limit or 10**9
    stats = Stats()
    changes: list[Decision] = []
    unresolved: list[Decision] = []
    previews: list[str] = []

    limiter = DomainLimiter(args.domain_interval, args.per_domain)
    if args.refetch_all:
        logger.warning("--refetch-all: semua artikel akan diunduh ulang (lambat)")

    for page_index, rows in enumerate(
        _iter_batches(
            source=args.source,
            since=args.since,
            platform=args.platform,
            limit=limit,
            batch=args.batch,
        ),
        start=1,
    ):
        stats.scanned += len(rows)

        pending = [
            row
            for row in rows
            if args.refetch_all
            or classify_body(str(row["clean_content"] or ""), str(row["title"] or "")) in REFETCH_STATES
            or (args.rewrite_url and is_google_news_url(str(row["url"] or "")))
        ]
        refreshed: dict[str, Refetch] = {}
        if pending:

            def work(row: dict[str, Any]) -> Refetch:
                return _refetch(
                    row,
                    limiter,
                    retries=args.retry,
                    retry_delay=args.retry_delay,
                )

            with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
                for row, outcome in zip(pending, pool.map(work, pending)):
                    refreshed[str(row["id"])] = outcome

        batch_decisions: list[Decision] = []
        for row in rows:
            state = classify_body(str(row["clean_content"] or ""), str(row["title"] or ""))
            stats.bump_state(state)
            if states and state not in states:
                continue
            outcome = refreshed.get(str(row["id"]))
            decision = _decide(row, outcome)
            decision.error = outcome.error if outcome is not None else None
            if decision.refetched:
                stats.refetch_ok += 1
            elif outcome is not None and outcome.body is None:
                stats.refetch_failed += 1
                if outcome.error == "google-news":
                    stats.gnews_failed += 1
            if decision.new_url:
                stats.gnews_resolved += 1
            if decision.reason == "dipertahankan-utuh":
                stats.kept_original += 1
            if decision.action == "update" or (args.rewrite_url and decision.new_url):
                batch_decisions.append(decision)
                if len(previews) < args.show and not args.quiet:
                    previews.append(_line(decision))
            else:
                stats.unchanged += 1
            if decision.action == "update":
                changes.append(decision)
            elif state in REFETCH_STATES:
                unresolved.append(decision)

        if batch_decisions:
            if args.apply:
                if args.refresh_nlp:
                    stats.nlp_refreshed += len(batch_decisions)
                written = _write(
                    batch_decisions,
                    refresh_nlp=args.refresh_nlp,
                    rewrite_url=args.rewrite_url,
                )
                stats.changed += written
            else:
                stats.changed += len(batch_decisions)

        if not args.quiet:
            logger.info(
                "batch %d · %d dipindai · %d berubah · %d diambil ulang · %d gagal",
                page_index,
                stats.scanned,
                stats.changed,
                stats.refetch_ok,
                stats.refetch_failed,
            )

    for line in previews:
        print(line)

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(
        f"\n[{mode}] dipindai={stats.scanned} berubah={stats.changed} "
        f"tetap={stats.unchanged} ekstraksi-ulang={stats.refetch_ok} "
        f"gnews={stats.gnews_resolved} gagal-gnews={stats.gnews_failed} "
        f"dipertahankan={stats.kept_original}"
        + (f" nlp-diperbarui={stats.nlp_refreshed}" if args.refresh_nlp else "")
    )
    print("status awal:", ", ".join(f"{key}={value}" for key, value in sorted(stats.by_state.items())))
    if not args.apply:
        print("Jalankan ulang dengan --apply untuk menulis perubahan.")

    if args.report:
        payload = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "mode": mode,
            "filters": {
                "source": args.source,
                "platform": args.platform,
                "since": args.since,
                "state": sorted(states) if states else None,
                "limit": args.limit or None,
            },
            "stats": {
                **{key: value for key, value in vars(stats).items() if key != "by_state"},
                "byState": stats.by_state,
            },
            "changes": [
                {
                    "id": str(decision.row["id"]),
                    "url": decision.row["url"],
                    "newUrl": decision.new_url,
                    "domain": decision.row.get("domain"),
                    "title": decision.row["title"],
                    "state": decision.state,
                    "reason": decision.reason,
                    "before": len(str(decision.row["clean_content"] or "")),
                    "after": len(decision.body),
                }
                for decision in changes
            ],
            "unresolved": [
                {
                    "id": str(decision.row["id"]),
                    "url": decision.row["url"],
                    "domain": decision.row.get("domain"),
                    "title": decision.row["title"],
                    "state": decision.state,
                    "error": decision.error,
                    "reason": decision.reason,
                }
                for decision in unresolved
            ],
        }
        Path(args.report).write_text(json.dumps(payload, ensure_ascii=False, indent=2))
        logger.info("laporan ditulis ke %s", args.report)

    if unresolved:
        by_domain: dict[str, int] = {}
        for decision in unresolved:
            key = str(decision.row.get("domain") or "?")
            by_domain[key] = by_domain.get(key, 0) + 1
        detail = ", ".join(f"{domain}={count}" for domain, count in sorted(by_domain.items(), key=lambda item: -item[1]))
        logger.warning("%d baris belum terselesaikan: %s", len(unresolved), detail)
        if not args.report:
            logger.warning("tambahkan --report out.json untuk detail per baris")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
