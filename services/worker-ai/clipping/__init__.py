"""Automated AI clipping, distribution & viral trigger pipeline.

Modul ini adalah sisi "heavy lifting" dari blueprint `clip.plan.md`. Setiap
konsumen berdiri sendiri dan membaca job dari Redis Streams yang dipublikasikan
oleh API (Bun + Elysia):

    clip:ingest      → ingestor   (yt-dlp + heatmap + faster-whisper)
    clip:render      → renderer   (FFmpeg vstack / face reframe + ASS caption)
    clip:distribute  → distributor (adb / device farm upload + hash mutation)
    clip:boost       → viral_trigger (retention + search-to-watch simulation)
    clip:track       → tracker    (scrape metrik → estimasi CPM)

Semua dependensi berat (yt-dlp, faster-whisper, librosa, uiautomator2) adalah
*optional*: bila belum terpasang, modul jatuh ke mode "dry run" yang tetap
memperbarui status di database sehingga dashboard bisa dipakai untuk menguji
alur end-to-end tanpa GPU maupun device farm.
"""

from .worker import ClipWorker, main

__all__ = ["ClipWorker", "main"]
