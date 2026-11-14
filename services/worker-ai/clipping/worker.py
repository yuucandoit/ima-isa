"""Queue consumer entrypoint for the clipping pipeline.

Menjalankan empat konsumen Redis Streams dalam thread terpisah supaya ingest,
render, distribusi, dan tracker tidak saling memblokir:

    clip:ingest      → ingestor + curator
    clip:render      → renderer
    clip:distribute  → distributor
    clip:boost       → viral_trigger
    clip:track       → tracker (termasuk cron tiap CLIP_TRACKER_INTERVAL_SECONDS)

Jalankan dengan::

    bun run worker:clip
    # atau langsung
    cd services/worker-ai && .venv/bin/python -m clipping.worker
"""

from __future__ import annotations

import json
import logging
import os
import signal
import socket
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

import redis

from config import settings

from . import curator, distributor, ingestor, renderer, tracker, viral_trigger
from .pipeline import (
    CLIP_GROUP,
    CLIP_STREAMS,
    clear_heartbeat,
    publish_update,
    read_heartbeats,
    redis_client,
    run,
    run_one,
    set_clip_render_progress,
    worker_capabilities,
    write_heartbeat,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s · %(message)s",
)
logger = logging.getLogger("clipping.worker")

Handler = Callable[[dict[str, Any]], None]

#: Pesan di PEL yang idle selama ini dianggap yatim (consumer mati) dan
#: diambil alih. Cukup pendek agar crash cepat pulih, cukup panjang agar tidak
#: menyerobot job yang benar-benar masih berjalan.
ORPHAN_IDLE_MS = 120_000

#: Status yang menandakan job masih berjalan; dipakai saat rekonsiliasi DB.
ACTIVE_SOURCE_STATUSES = ("downloading", "transcribing", "analyzing", "rendering")


# ── Job handlers ──────────────────────────────────────────────


def handle_ingest(job: dict[str, Any]) -> None:
    ingestor.ingest(job)
    curator.curate(
        int(job["sourceId"]),
        max_clips=int(job.get("maxClips") or settings.clip_max_per_source),
        render_mode=str(job.get("renderMode") or "split_screen"),
    )


def handle_render(job: dict[str, Any]) -> None:
    clip_id = int(job["clipId"])
    source_id = int(job["sourceId"]) if job.get("sourceId") is not None else None
    set_clip_render_progress(clip_id, source_id, "queued", 5.0, "Memulai job render di worker…")
    renderer.render_clip(
        clip_id,
        render_mode=job.get("renderMode"),
        start=float(job["startTime"]) if job.get("startTime") is not None else None,
        end=float(job["endTime"]) if job.get("endTime") is not None else None,
        filler_asset=job.get("fillerAsset"),
    )


def handle_distribute(job: dict[str, Any]) -> None:
    distributor.distribute(
        int(job["clipId"]),
        [int(item) for item in job.get("distributionIds") or []],
        enable_viral_trigger=bool(job.get("enableViralTrigger", True)),
        watch_time_pct=int(job.get("watchTimePct") or 180),
        drip_window_minutes=int(job.get("dripWindowMinutes") or 120),
    )


def _run_boost(job: dict[str, Any]) -> None:
    viral_trigger.boost(
        int(job["distributionId"]),
        sessions=int(job.get("sessions") or 1),
        watch_time_pct=float(job.get("watchTimePct") or 180),
        keyword=job.get("searchKeyword"),
    )


def handle_boost(job: dict[str, Any]) -> None:
    delay = int(job.get("delaySeconds") or 0)
    if delay > 0:
        # Sesi terjadwal: jalankan di timer thread supaya konsumen `clip:boost`
        # tetap menerima job lain (drip-feed bisa berjarak jam).
        logger.info("⏳ boost #%s dijadwalkan +%ss", job.get("distributionId"), delay)
        timer = threading.Timer(min(delay, 24 * 3600), _run_boost, args=(job,))
        timer.daemon = True
        timer.start()
        return
    _run_boost(job)


def handle_track(job: dict[str, Any]) -> None:
    distribution_id = job.get("distributionId")
    if distribution_id:
        tracker.track_distribution(int(distribution_id))
    else:
        tracker.track_all()


HANDLERS: dict[str, Handler] = {
    CLIP_STREAMS["ingest"]: handle_ingest,
    CLIP_STREAMS["render"]: handle_render,
    CLIP_STREAMS["distribute"]: handle_distribute,
    CLIP_STREAMS["boost"]: handle_boost,
    CLIP_STREAMS["track"]: handle_track,
}


# ── Consumers ─────────────────────────────────────────────────


def mark_job_failed(stream: str, job: dict[str, Any], error: Exception) -> None:
    """Catat kegagalan job ke baris DB terkait.

    Tanpa ini baris tetap di status aktif (`downloading`/`analyzing`/…) setelah
    job masuk `clip:dead`, sehingga dashboard menampilkan progres yang tidak
    pernah selesai dan tombol *Ulangi* tidak muncul (retry hanya untuk
    `failed`/`completed`).
    """
    message = str(error).strip() or "Job gagal tanpa pesan."

    try:
        if stream == CLIP_STREAMS["ingest"] and job.get("sourceId"):
            run(
                """
                UPDATE clip_sources
                SET status = 'failed', error_message = %s, updated_at = now()
                WHERE id = %s
                """,
                (message, int(job["sourceId"])),
            )
            publish_update(
                {"type": "source", "sourceId": int(job["sourceId"]), "status": "failed"}
            )
            return

        if stream == CLIP_STREAMS["render"] and job.get("clipId"):
            clip_id = int(job["clipId"])
            row = run_one("SELECT source_id FROM generated_clips WHERE id = %s", (clip_id,))
            source_id = int(row["source_id"]) if row else None
            if row:
                run(
                    """
                    UPDATE clip_sources
                    SET status = 'failed', error_message = %s, updated_at = now()
                    WHERE id = %s
                    """,
                    (message, source_id),
                )
                publish_update(
                    {"type": "source", "sourceId": source_id, "status": "failed"}
                )
            set_clip_render_progress(clip_id, source_id, "failed", 0.0, message)
            return

        if stream in (CLIP_STREAMS["distribute"], CLIP_STREAMS["boost"]):
            distribution_ids = job.get("distributionIds") or []
            if job.get("distributionId"):
                distribution_ids = [job["distributionId"]]
            for distribution_id in distribution_ids:
                run(
                    "UPDATE clip_distributions SET status = 'failed' WHERE id = %s",
                    (int(distribution_id),),
                )
                publish_update(
                    {"type": "distribution", "distributionId": int(distribution_id)}
                )
    except Exception as update_error:  # pragma: no cover - DB tidak tersedia
        logger.warning("gagal menandai job %s sebagai failed: %s", stream, update_error)


class StreamConsumer(threading.Thread):
    """Satu thread per stream; `xreadgroup` + ack + dead-letter."""

    def __init__(self, stream: str, handler: Handler, stop_event: threading.Event) -> None:
        super().__init__(name=f"clip-{stream}", daemon=True)
        self.stream = stream
        self.handler = handler
        self.stop_event = stop_event
        self.client = redis_client()
        self.consumer = f"{CLIP_GROUP}-{stream.split(':')[-1]}-{socket.gethostname()}-{id(self) % 10_000}"

    def ensure_group(self) -> None:
        try:
            self.client.xgroup_create(self.stream, CLIP_GROUP, id="0", mkstream=True)
            logger.info("consumer group '%s' dibuat pada '%s'", CLIP_GROUP, self.stream)
        except redis.ResponseError as error:
            if "BUSYGROUP" not in str(error):
                logger.warning("xgroup_create %s: %s", self.stream, error)

    def reclaim_orphaned(self) -> None:
        """Ambil alih job yang tertinggal di PEL consumer yang sudah mati.

        Tanpa ini, worker yang terbunuh di tengah job (mis. saat kurasi LLM)
        meninggalkan pesan tak ter-ACK milik consumer yang tidak akan pernah
        hidup lagi. Job tersebut tidak pernah dikirim ulang, dan baris DB-nya
        tertahan di status `analyzing` selamanya.

        `XAUTOCLAIM` memindahkan pesan yang idle > `min_idle_ms` ke consumer
        ini sehingga benar-benar diproses ulang.
        """
        try:
            response = self.client.xautoclaim(
                self.stream,
                CLIP_GROUP,
                self.consumer,
                min_idle_time=ORPHAN_IDLE_MS,
                start_id="0-0",
                count=50,
            )
        except redis.ResponseError as error:
            logger.debug("[%s] xautoclaim dilewati: %s", self.stream, error)
            return

        # redis-py mengembalikan (next_id, messages[, deleted]) — bentuknya
        # berbeda antar versi, jadi ambil elemen kedua secara defensif.
        messages = response[1] if isinstance(response, (list, tuple)) and len(response) > 1 else []
        if not messages:
            return
        logger.warning(
            "↻ [%s] mengambil alih %d job yatim dari consumer mati",
            self.stream,
            len(messages),
        )
        for message_id, fields in messages:
            self.process(message_id, fields)

    def dead_letter(self, message_id: str, raw: str, error: Exception) -> None:
        logger.error("[%s] job %s gagal: %s", self.stream, message_id, error)
        try:
            self.client.xadd(
                "clip:dead",
                {"stream": self.stream, "payload": raw, "error": str(error)},
                maxlen=2_000,
                approximate=True,
            )
        except redis.RedisError:
            pass

    def process(self, message_id: str, fields: dict[str, Any]) -> None:
        """Jalankan satu job lalu ACK (atau dead-letter bila gagal)."""
        raw = fields.get("payload", "{}")
        job: dict[str, Any] = {}
        try:
            job = json.loads(raw)
            self.handler(job)
        except Exception as error:
            self.dead_letter(message_id, raw, error)
            # Job yang payload-nya rusak pun tetap menandai entitasnya gagal
            # agar UI tidak menggantung di status aktif.
            mark_job_failed(self.stream, job, error)
        finally:
            try:
                self.client.xack(self.stream, CLIP_GROUP, message_id)
            except redis.RedisError:
                pass

    def run(self) -> None:  # pragma: no cover - loop infrastruktur
        self.ensure_group()
        # Pulihkan job yatim sebelum menerima job baru.
        self.reclaim_orphaned()
        logger.info("↻ mendengarkan stream '%s' sebagai %s", self.stream, self.consumer)
        while not self.stop_event.is_set():
            try:
                response = self.client.xreadgroup(
                    CLIP_GROUP, self.consumer, {self.stream: ">"}, count=1, block=2_000
                )
            except redis.RedisError as error:
                logger.warning("[%s] read gagal: %s", self.stream, error)
                time.sleep(2)
                continue
            if not response:
                continue
            for _stream, messages in response:
                for message_id, fields in messages:
                    self.process(message_id, fields)


def reconcile_stalled_sources() -> int:
    """Tandai sumber "aktif" yang ditinggal mati sebagai `failed`.

    Pesan Redis untuk sumber seperti ini biasanya sudah hilang dari PEL (atau
    consumer-nya tidak pernah hidup lagi), sehingga tanpa rekonsiliasi baris DB
    akan berstatus `analyzing` selamanya dan UI tampak menggantung.

    Status dijadikan `failed` — bukan otomatis diulang — supaya operator bisa
    memutuskan lewat tombol *Ulangi ingest* alih-alih terjadi loop ingest tanpa
    batas pada video yang memang bermasalah.

    Hanya dijalankan bila tidak ada instance worker lain yang aktif, agar
    instance kedua tidak menandai job yang sedang dikerjakan instance pertama.
    """
    if _other_worker_alive():
        logger.info("worker lain masih aktif — rekonsiliasi status dilewati")
        return 0

    placeholders = ", ".join("%s::clip_source_status" for _ in ACTIVE_SOURCE_STATUSES)
    rows = run(
        f"""
        UPDATE clip_sources
        SET status = 'failed',
            error_message = COALESCE(
                error_message,
                'Worker berhenti saat memproses sumber ini. Ulangi ingest untuk melanjutkan.'
            ),
            updated_at = now()
        WHERE status IN ({placeholders})
        RETURNING id
        """,
        ACTIVE_SOURCE_STATUSES,
    )
    if rows:
        logger.warning(
            "⚠ %d sumber tertinggal dalam status aktif → ditandai gagal", len(rows)
        )
        for row in rows:
            publish_update({"type": "source", "sourceId": row["id"], "status": "failed"})
    return len(rows)


def _other_worker_alive(max_age_seconds: int = 45) -> bool:
    """Apakah ada instance worker lain yang heartbeat-nya masih segar?"""
    for payload in read_heartbeats():
        if payload.get("pid") == os.getpid():
            continue
        try:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(str(payload["at"]))
        except (ValueError, TypeError):
            continue
        if age.total_seconds() <= max_age_seconds:
            return True
    return False


class TrackerCron(threading.Thread):
    """Cron tracker tiap `CLIP_TRACKER_INTERVAL_SECONDS` (default 3 jam)."""

    def __init__(self, stop_event: threading.Event) -> None:
        super().__init__(name="clip-tracker-cron", daemon=True)
        self.stop_event = stop_event

    def run(self) -> None:  # pragma: no cover - loop infrastruktur
        interval = max(300, settings.clip_tracker_interval_seconds)
        logger.info("⏱ tracker cron aktif tiap %d menit", interval // 60)
        while not self.stop_event.wait(interval):
            try:
                tracker.track_all()
            except Exception as error:
                logger.warning("cron tracker gagal: %s", error)


class HeartbeatCron(threading.Thread):
    """Tulis heartbeat tiap 15 detik agar dashboard tahu worker masih hidup."""

    INTERVAL_SECONDS = 15

    def __init__(self, stop_event: threading.Event) -> None:
        super().__init__(name="clip-heartbeat", daemon=True)
        self.stop_event = stop_event

    def run(self) -> None:  # pragma: no cover - loop infrastruktur
        while not self.stop_event.wait(self.INTERVAL_SECONDS):
            write_heartbeat()


class ClipWorker:
    def __init__(self) -> None:
        self.stop_event = threading.Event()
        self.threads: list[threading.Thread] = []

    def start(self) -> None:
        # Rekonsiliasi SEBELUM menulis heartbeat sendiri, agar pemeriksaan
        # "ada worker lain?" tidak melihat diri sendiri.
        reconcile_stalled_sources()

        # Heartbeat pertama ditulis sebelum loop supaya status langsung terbaca.
        write_heartbeat()
        heartbeat = HeartbeatCron(self.stop_event)
        self.threads.append(heartbeat)
        heartbeat.start()
        for stream, handler in HANDLERS.items():
            thread = StreamConsumer(stream, handler, self.stop_event)
            self.threads.append(thread)
            thread.start()
        if settings.clip_tracker_interval_seconds > 0:
            cron = TrackerCron(self.stop_event)
            self.threads.append(cron)
            cron.start()

        capabilities = worker_capabilities()
        missing = [
            name
            for name, available in (
                ("yt-dlp", capabilities["ytdlp"]),
                ("faster-whisper", capabilities["whisper"]),
                ("librosa", capabilities["librosa"]),
            )
            if not available
        ]
        if missing and not settings.clip_dry_run:
            logger.warning(
                "⚠ dependensi belum terpasang: %s — ingest/render akan gagal. "
                "Pasang dengan `bun run worker:setup:clip`, atau set "
                "CLIP_DRY_RUN=true untuk menguji alur tanpa dependensi.",
                ", ".join(missing),
            )

        logger.info(
            "Clip worker siap · workdir=%s · dry-run=%s · whisper=%s · tracker=%ss",
            settings.clip_work_dir,
            settings.clip_dry_run,
            settings.clip_whisper_model,
            settings.clip_tracker_interval_seconds,
        )

    def stop(self, *_args: Any) -> None:
        logger.info("Sinyal shutdown diterima…")
        clear_heartbeat()
        self.stop_event.set()

    def join(self) -> None:
        for thread in self.threads:
            thread.join(timeout=5)


def main() -> None:  # pragma: no cover - entrypoint
    worker = ClipWorker()
    signal.signal(signal.SIGINT, worker.stop)
    signal.signal(signal.SIGTERM, worker.stop)
    worker.start()
    try:
        while not worker.stop_event.is_set():
            time.sleep(0.5)
    except KeyboardInterrupt:
        worker.stop()
    finally:
        worker.join()
    logger.info("Clip worker berhenti.")
    sys.exit(0)


if __name__ == "__main__":  # pragma: no cover
    main()
