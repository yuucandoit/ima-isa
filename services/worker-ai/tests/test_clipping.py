"""Unit tests for the clipping pipeline (tanpa DB, ffmpeg, atau network).

Run from `services/worker-ai`:
    python -m unittest discover -s tests -v
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("USE_TRANSFORMERS", "false")
os.environ.setdefault("USE_SPACY", "false")
os.environ.setdefault("CLIP_DRY_RUN", "true")

from clipping import curator, ingestor, renderer, tracker  # noqa: E402
from clipping.pipeline import ass_timestamp, format_timestamp  # noqa: E402


WORDS = [
    {"start": 10.0, "end": 10.4, "word": "Halo"},
    {"start": 10.5, "end": 10.9, "word": "semua,"},
    {"start": 11.0, "end": 11.5, "word": "hari"},
    {"start": 11.6, "end": 12.0, "word": "ini"},
]
HEATMAP = [
    {"startTime": 0.0, "endTime": 20.0, "value": 0.2},
    {"startTime": 20.0, "endTime": 40.0, "value": 0.95},
]
PEAKS = [(float(second), 0.4 + second / 100) for second in range(0, 60, 2)]


class TimestampTests(unittest.TestCase):
    def test_format_timestamp(self) -> None:
        self.assertEqual(format_timestamp(0), "00:00")
        self.assertEqual(format_timestamp(142.5), "02:22")
        self.assertEqual(format_timestamp(3725), "01:02:05")

    def test_ass_timestamp(self) -> None:
        self.assertEqual(ass_timestamp(0), "0:00:00.00")
        self.assertEqual(ass_timestamp(65.25), "0:01:05.25")
        self.assertEqual(ass_timestamp(-3), "0:00:00.00")

    def test_negative_timestamp_clamped(self) -> None:
        self.assertEqual(format_timestamp(-10), "00:00")


class CuratorTests(unittest.TestCase):
    def test_heatmap_score_uses_range_overlap(self) -> None:
        inside = curator.heatmap_score(HEATMAP, 22.0, 38.0)
        outside = curator.heatmap_score(HEATMAP, 100.0, 120.0)
        self.assertAlmostEqual(inside, 0.95, places=4)
        self.assertEqual(outside, 0.0)

    def test_heatmap_score_empty(self) -> None:
        self.assertEqual(curator.heatmap_score([], 0, 10), 0.0)

    def test_energy_score(self) -> None:
        value = curator.energy_score(PEAKS, 0.0, 10.0)
        self.assertGreater(value, 0.0)
        self.assertLessEqual(value, 1.0)

    def test_transcript_helpers(self) -> None:
        text = curator.transcript_text(WORDS, 10.0, 12.5)
        self.assertIn("Halo", text)
        self.assertIn("ini", text)
        # Batas kata terdekat, bukan tebakan bebas.
        snapped = curator.transcript_nearest_boundary(WORDS, 10.7)
        self.assertIn(snapped, (10.4, 10.5, 10.9, 11.0))

    def test_heuristic_candidates_respect_bounds(self) -> None:
        words = [
            {"start": float(index), "end": float(index) + 0.9, "word": f"kata{index}"}
            for index in range(120)
        ]
        candidates = curator.heuristic_candidates(words, HEATMAP, PEAKS, 120.0, 3)
        self.assertTrue(candidates)
        self.assertLessEqual(len(candidates), 3)
        for candidate in candidates:
            self.assertGreaterEqual(candidate.start, 0.0)
            self.assertLessEqual(candidate.end, 120.0)
            self.assertLess(candidate.start, candidate.end)

    def test_heuristic_limits_overlaps_to_60pct(self) -> None:
        words = [
            {"start": float(index), "end": float(index) + 0.9, "word": f"kata{index}"}
            for index in range(200)
        ]
        candidates = curator.heuristic_candidates(words, HEATMAP, PEAKS, 200.0, 6)
        for index, first in enumerate(candidates):
            for second in candidates[index + 1 :]:
                overlap = max(
                    0.0, min(first.end, second.end) - max(first.start, second.start)
                )
                span = min(first.end - first.start, second.end - second.start)
                self.assertLessEqual(overlap / span, 0.6)

    def test_parse_llm_json_variants(self) -> None:
        plain = '{"clips":[{"title":"a","start":1,"end":9,"viralityScore":80}]}'
        fenced = "```json\n" + plain + "\n```"
        noisy = "Berikut hasilnya: " + plain + " semoga membantu"
        self.assertEqual(len(curator._parse_llm_json(plain)), 1)
        self.assertEqual(len(curator._parse_llm_json(fenced)), 1)
        self.assertEqual(len(curator._parse_llm_json(noisy)), 1)
        self.assertEqual(curator._parse_llm_json("bukan json"), [])


class DryRunTests(unittest.TestCase):
    """`CLIP_DRY_RUN=true` harus lolos ingest → kurasi → render tanpa jaringan.

    Sebelumnya ingest melempar `durasi video tidak diketahui` sehingga job
    masuk `clip:dead`, padahal README menjanjikan alur ini bisa diuji tanpa
    yt-dlp/ffmpeg/ADB.
    """

    def test_dry_run_transcript_is_word_level_and_inside_duration(self) -> None:
        from clipping.ingestor import _dry_run_transcript

        words = _dry_run_transcript(120)
        self.assertGreater(len(words), 100)
        for word in words:
            self.assertGreaterEqual(word["start"], 0.0)
            self.assertLessEqual(word["end"], 120.0)
            self.assertLess(word["start"], word["end"])
            self.assertTrue(str(word["word"]).strip())

    def test_dry_run_placeholder_file_is_created(self) -> None:
        import tempfile
        from clipping.ingestor import _dry_run_placeholder

        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "nested" / "source.mp4"
            created = _dry_run_placeholder(target)
            self.assertEqual(created, target)
            self.assertTrue(target.exists())
            # Idempoten: pemanggilan kedua tidak menghapus isi.
            _dry_run_placeholder(target)
            self.assertTrue(target.read_bytes())

    def test_dry_run_transcript_feeds_heuristic_candidates(self) -> None:
        from clipping.ingestor import _dry_run_transcript

        words = _dry_run_transcript(120)
        candidates = curator.heuristic_candidates(words, [], [], 120.0, 3)
        self.assertTrue(candidates)
        for candidate in candidates:
            self.assertLessEqual(candidate.end, 120.0)

    def test_dry_run_transcript_survives_reingest(self) -> None:
        """Regresi: ingest ulang tidak boleh memanggil ffmpeg pada placeholder.

        Sebelumnya cabang `_download` mengembalikan file placeholder yang sudah
        ada, lalu `extract_audio` dijalankan dan ffmpeg gagal (exit 183).
        Transkrip sintetis kemudian ditimpa `None` sehingga kurasi kehilangan
        sinyal dan durasi menjadi 0.
        """
        import inspect

        source = inspect.getsource(ingestor.ingest)
        # ffmpeg hanya boleh dipanggil pada jalur unduhan sungguhan.
        self.assertIn("elif settings.clip_dry_run:", source)
        self.assertIn("_dry_run_transcript", source)


class HeartbeatTests(unittest.TestCase):
    """Heartbeat yang dibaca `GET /api/system/status`."""

    def test_capabilities_report_available_dependencies(self) -> None:
        from clipping.pipeline import worker_capabilities

        caps = worker_capabilities()
        for key in ("dryRun", "whisper", "ytdlp", "librosa", "ffmpeg", "adb"):
            self.assertIn(key, caps)
            self.assertIsInstance(caps[key], bool)

    def test_dependency_probe_does_not_raise(self) -> None:
        from clipping.pipeline import _module_available

        self.assertTrue(_module_available("json"))
        self.assertFalse(_module_available("modul_yang_tidak_ada_xyz"))

    def test_heartbeat_key_is_per_pid(self) -> None:
        """Satu key per PID: dua worker tidak boleh saling menimpa heartbeat.

        Regresi: dengan satu key bersama, worker kedua menulis heartbeat-nya
        lalu salah menyimpulkan tidak ada worker lain — dan menandai job yang
        sedang dikerjakan worker pertama sebagai `failed`.
        """
        from clipping.pipeline import heartbeat_key

        self.assertNotEqual(heartbeat_key(1001), heartbeat_key(1002))
        self.assertIn("1001", heartbeat_key(1001))

    def test_heartbeat_payload_shape(self) -> None:
        from clipping.pipeline import worker_capabilities

        caps = worker_capabilities()
        # Field yang dibaca API; hilangnya salah satu membuat status buta.
        for required in ("dryRun", "ytdlp", "whisper", "ffmpeg"):
            self.assertIn(required, caps)


class OrphanRecoveryTests(unittest.TestCase):
    """Job yang ditinggal worker mati harus bisa dipulihkan."""

    def test_orphan_idle_is_bounded(self) -> None:
        from clipping import worker

        # Cukup pendek agar crash cepat pulih, cukup panjang agar tidak
        # menyerobot job yang masih berjalan.
        self.assertGreaterEqual(worker.ORPHAN_IDLE_MS, 60_000)
        self.assertLessEqual(worker.ORPHAN_IDLE_MS, 600_000)

    def test_active_statuses_cover_pipeline(self) -> None:
        from clipping import worker

        for status in ("downloading", "transcribing", "analyzing", "rendering"):
            self.assertIn(status, worker.ACTIVE_SOURCE_STATUSES)


class FailurePropagationTests(unittest.TestCase):
    """Job gagal wajib menandai baris DB — bukan meninggalkan status aktif.

    Regresi: kegagalan hanya masuk `clip:dead`, sehingga baris tetap di
    `downloading`/`analyzing` selamanya. Dashboard menampilkan progres yang
    tidak pernah selesai dan tombol *Ulangi* tidak muncul karena retry hanya
    untuk `failed`/`completed`.
    """

    def test_mark_job_failed_is_callable(self) -> None:
        from clipping import worker

        self.assertTrue(callable(worker.mark_job_failed))

    def test_process_calls_mark_job_failed(self) -> None:
        import inspect
        from clipping import worker

        source = inspect.getsource(worker.StreamConsumer.process)
        self.assertIn("mark_job_failed", source)

    def test_mark_job_failed_never_raises(self) -> None:
        """Kegagalan pencatatan tidak boleh menjatuhkan consumer."""
        from clipping import worker

        # Tanpa DB/Redis yang bisa dihubungi, fungsi harus menelan error.
        try:
            worker.mark_job_failed("clip:ingest", {"sourceId": -1}, RuntimeError("uji"))
        except Exception as error:  # pragma: no cover
            self.fail(f"mark_job_failed melempar: {error}")


class MissingDependencyMessageTests(unittest.TestCase):
    """Pesan error harus menyebut penyebab & solusinya, bukan hanya "gagal"."""

    def test_missing_ytdlp_message_is_actionable(self) -> None:
        from clipping.ingestor import _missing_ytdlp_message

        message = _missing_ytdlp_message()
        self.assertIn("yt-dlp", message)
        self.assertIn("worker:setup:clip", message)
        self.assertIn("CLIP_DRY_RUN", message)


class RendererTests(unittest.TestCase):
    def test_ass_contains_hook_and_word_highlight(self) -> None:
        document = renderer.build_ass(WORDS, 10.0, 13.0, hook_title="Hook Kontroversial")
        self.assertIn("[Script Info]", document)
        self.assertIn("HOOK KONTROVERSIAL", document)
        self.assertIn("Halo", document)
        # Warna aksen untuk kata aktif.
        self.assertIn(r"\c&H0000E8FF&", document)
        # Waktu lokal (0 detik) untuk kata pertama.
        self.assertIn("0:00:00.00", document)

    def test_ass_escapes_control_characters(self) -> None:
        words = [{"start": 0.0, "end": 1.0, "word": "{malicious}"}]
        document = renderer.build_ass(words, 0.0, 2.0, hook_title="a{b}")
        self.assertNotIn("{malicious}", document)
        self.assertNotIn("a{b}", document)

    def test_caption_groups_split_on_punctuation(self) -> None:
        groups = renderer._caption_groups(WORDS, chunk=3)
        self.assertEqual(len(groups), 2)
        self.assertEqual(groups[0][-1]["word"], "semua,")

    def test_wrap_caption_limits_width(self) -> None:
        lines = renderer._wrap_caption("satu dua tiga empat lima enam tujuh delapan", limit=12)
        self.assertTrue(all(len(line) <= 13 for line in lines))
        self.assertLessEqual(len(lines), 3)

    def test_split_screen_filter_has_vstack_and_9_16(self) -> None:
        graph = renderer._split_screen_filter(Path("filler.mp4"), 10.0, 30.0)
        self.assertIn("vstack=inputs=2", graph)
        self.assertIn("1080:960", graph)
        self.assertIn("trim=start=10.0:duration=30.0", graph)

    def test_blur_filter_scales_to_1080x1920(self) -> None:
        graph = renderer._blur_background_filter(5.0, 20.0)
        self.assertIn("gblur", graph)
        self.assertIn("1080:1920", graph)

    def test_face_reframe_scales_by_height(self) -> None:
        graph = renderer._face_reframe_filter(0.0, 15.0, 0.35)
        self.assertIn("scale=-2:1920", graph)
        self.assertIn("(iw-1080)*0.3500", graph)

    def test_face_center_is_clamped(self) -> None:
        graph = renderer._face_reframe_filter(0.0, 15.0, 4.2)
        self.assertIn("*1.0000", graph)


class PerformanceGuardTests(unittest.TestCase):
    """Menjaga optimasi render yang membuat klip 75 detik turun dari >12 menit
    menjadi ~21 detik.

    Angka acuan terukur (klip 75 dtk, split-screen, 90 state caption):
      * track caption via `overlay` berantai : 241 s untuk 40 state (kuadratik)
      * track caption via `concat` demuxer  : 0,9 s untuk 40 state
    """

    def test_caption_track_uses_concat_not_chained_overlay(self) -> None:
        import inspect
        from clipping import renderer

        source = inspect.getsource(renderer.build_caption_track)
        self.assertIn("concat", source)
        # Regresi: overlay berantai per state = O(n^2).
        self.assertNotIn("overlay=", source)

    def test_caption_track_timeout_is_sane(self) -> None:
        from clipping import renderer

        # Terlalu besar menyembunyikan masalah; terlalu kecil memotong render sah.
        self.assertGreaterEqual(renderer.CAPTION_TRACK_TIMEOUT_SECONDS, 30)
        self.assertLessEqual(renderer.CAPTION_TRACK_TIMEOUT_SECONDS, 300)

    def test_render_timeout_bounded(self) -> None:
        from clipping import renderer

        self.assertGreaterEqual(renderer.RENDER_TIMEOUT_SECONDS, 120)
        self.assertLessEqual(renderer.RENDER_TIMEOUT_SECONDS, 3600)

    def test_hw_encoder_returns_valid_args(self) -> None:
        from clipping import renderer

        args = renderer.video_encoder_args()
        self.assertIn("-c:v", args)
        codec = args[args.index("-c:v") + 1]
        # Salah satu encoder yang didukung; jangan pernah kosong.
        self.assertIn(codec, {"libx264", "h264_videotoolbox", "h264_nvenc"})

    def test_thread_limit_is_positive(self) -> None:
        from clipping import renderer

        args = renderer._threads()
        self.assertEqual(args[0], "-threads")
        self.assertGreaterEqual(int(args[1]), 1)

    def test_segment_extraction_prefers_copy(self) -> None:
        import inspect
        from clipping import renderer

        source = inspect.getsource(renderer.extract_segment)
        # `-c copy` = tanpa re-encode, nyaris nol RAM.
        self.assertIn('"copy"', source)
        self.assertIn("-ss", source)

    def test_scratch_cleanup_removes_temp_artifacts(self) -> None:
        import tempfile
        from clipping import renderer

        with tempfile.TemporaryDirectory() as folder:
            from clipping.pipeline import ClipPaths

            root = Path(folder)
            paths = ClipPaths(
                root=root,
                sources=root / "sources",
                clips=root / "clips",
                mutations=root / "mutations",
                fillers=root / "fillers",
            )
            for folder_name in (paths.clips, paths.sources, paths.mutations, paths.fillers):
                folder_name.mkdir(parents=True, exist_ok=True)

            caps = paths.clips / "clip_7_caps"
            caps.mkdir()
            (caps / "cap_001.png").write_bytes(b"x")
            seg = paths.clips / "clip_7_seg.mp4"
            seg.write_bytes(b"x")
            track = paths.clips / "clip_7_caps.mov"
            track.write_bytes(b"x")
            ass = paths.clips / "clip_7.ass"
            ass.write_text("ass")

            renderer.cleanup_render_scratch(7, paths)

            self.assertFalse(caps.exists())
            self.assertFalse(seg.exists())
            self.assertFalse(track.exists())
            # Sidecar .ass dipertahankan untuk debugging/kualitas.
            self.assertTrue(ass.exists())


class WhisperMemoryTests(unittest.TestCase):
    """Model Whisper harus dilepas sebelum FFmpeg berjalan (cegah OOM)."""

    def test_release_whisper_is_callable_and_safe(self) -> None:
        from clipping.ingestor import release_whisper

        release_whisper(None)  # tidak boleh melempar

    def test_transcribe_has_finally_release(self) -> None:
        import inspect
        from clipping import ingestor

        source = inspect.getsource(ingestor.transcribe)
        self.assertIn("finally:", source)
        self.assertIn("release_whisper", source)

    def test_audio_extraction_skips_video_stream(self) -> None:
        import inspect
        from clipping import ingestor

        source = inspect.getsource(ingestor.extract_audio)
        # `-vn` mencegah PyAV/FFmpeg mendekode stream video saat ambil audio.
        self.assertIn('"-vn"', source)
        self.assertIn("pcm_s16le", source)


class TrackerTests(unittest.TestCase):
    def test_parse_count_variants(self) -> None:
        cases = {
            "12,4K": 12_400,
            "1.2jt": 1_200_000,
            "1.234": 1_234,
            "12400": 12_400,
            "3,1 jt": 3_100_000,
            "875": 875,
            "2.5M": 2_500_000,
        }
        for raw, expected in cases.items():
            self.assertEqual(tracker.parse_count(raw), expected, raw)

    def test_parse_count_invalid(self) -> None:
        self.assertIsNone(tracker.parse_count(None))
        self.assertIsNone(tracker.parse_count("tidak ada"))

    def test_metrics_from_html(self) -> None:
        html = (
            '<script type="application/ld+json">{}</script>'
            "<span>1,2 jt tayangan</span><span>45,3K suka</span>"
            "<span>120 komentar</span>"
        )
        metrics = tracker.metrics_from_html(html)
        self.assertIsNotNone(metrics)
        assert metrics is not None
        self.assertEqual(metrics["viewsCount"], 1_200_000)
        self.assertEqual(metrics["likesCount"], 45_300)
        self.assertEqual(metrics["commentsCount"], 120)

    def test_estimated_revenue_floor_per_thousand(self) -> None:
        self.assertEqual(tracker.estimated_revenue(12_400, 5_000), 60_000)
        self.assertEqual(tracker.estimated_revenue(999, 5_000), 0)
        self.assertEqual(tracker.estimated_revenue(12_400, 0), 0)


class ViralTriggerTests(unittest.TestCase):
    def test_watch_duration_bounds(self) -> None:
        from clipping import viral_trigger

        self.assertEqual(viral_trigger._watch_duration(30, 100), 45.0)
        self.assertEqual(viral_trigger._watch_duration(30, 250), 66.0)
        self.assertEqual(viral_trigger._watch_duration(30, 180), 54.0)

    def test_gaussian_delay_within_window(self) -> None:
        from clipping import viral_trigger

        for _ in range(200):
            delay = viral_trigger._gaussian_delay() / 60
            self.assertGreaterEqual(delay, 3.0)
            self.assertLessEqual(delay, 12.0)


class CrossOsAndChunkingTests(unittest.TestCase):
    def test_ytdlp_format_prefers_avc1_h264(self) -> None:
        fmt = ingestor._ytdlp_format_selector(720)
        self.assertIn("vcodec^=avc1", fmt)
        self.assertIn("height<=?720", fmt)

    def test_parse_json3_word_offsets(self) -> None:
        payload = {
            "events": [
                {
                    "tStartMs": 1000,
                    "dDurationMs": 2000,
                    "segs": [
                        {"utf8": "Halo ", "tOffsetMs": 0},
                        {"utf8": "dunia", "tOffsetMs": 600},
                    ],
                },
                {
                    "tStartMs": 3500,
                    "dDurationMs": 1000,
                    "segs": [{"utf8": "[Music]"}],
                },
            ]
        }
        words = ingestor.parse_json3_subtitles(payload)
        self.assertEqual(len(words), 2)
        self.assertEqual(words[0]["word"], "Halo")
        self.assertAlmostEqual(words[0]["start"], 1.0, places=2)
        self.assertEqual(words[1]["word"], "dunia")
        self.assertAlmostEqual(words[1]["start"], 1.6, places=2)

    def test_parse_json3_distributes_manual_captions(self) -> None:
        payload = {
            "events": [
                {
                    "tStartMs": 2000,
                    "dDurationMs": 3000,
                    "segs": [{"utf8": "Ini kalimat percobaan"}],
                }
            ]
        }
        words = ingestor.parse_json3_subtitles(payload)
        self.assertEqual([w["word"] for w in words], ["Ini", "kalimat", "percobaan"])
        self.assertAlmostEqual(words[0]["start"], 2.0, places=2)
        self.assertAlmostEqual(words[-1]["end"], 5.0, places=2)

    def test_plan_audio_chunks_snaps_to_silence(self) -> None:
        chunks = ingestor.plan_audio_chunks(500.0, chunk_seconds=180, silences=[172.5, 365.0])
        self.assertEqual(chunks, [(0.0, 172.5), (172.5, 365.0), (365.0, 500.0)])

    def test_plan_audio_chunks_short_audio_is_single_chunk(self) -> None:
        self.assertEqual(ingestor.plan_audio_chunks(120.0, chunk_seconds=180), [(0.0, 120.0)])

    def test_decode_wav_window_and_acoustic_peaks(self) -> None:
        import struct
        import tempfile
        import wave

        with tempfile.TemporaryDirectory() as folder:
            wav_path = Path(folder) / "sample.wav"
            rate = 16_000
            frames = struct.pack("<" + "h" * (rate * 4), *([2000] * (rate * 2) + [8000] * (rate * 2)))
            with wave.open(str(wav_path), "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(rate)
                wf.writeframes(frames)

            pcm = ingestor._decode_to_pcm(wav_path, start=2.0, end=4.0)
            self.assertEqual(pcm.size, rate * 2)
            peaks = curator.acoustic_peaks(str(wav_path))
            self.assertEqual(len(peaks), 2)
            self.assertLess(peaks[0][1], peaks[1][1])
            self.assertAlmostEqual(peaks[1][1], 1.0, places=3)

    def test_resolve_faster_whisper_device_returns_valid_tuple(self) -> None:
        device, compute = ingestor._resolve_faster_whisper_device()
        self.assertIn(device, {"cpu", "cuda"})
        self.assertTrue(compute)


class CaptionSyncAndRenderTests(unittest.TestCase):
    def test_hook_overlay_separated_from_caption_overlays(self) -> None:
        import tempfile
        from unittest.mock import patch

        words = [
            {"word": "halo", "start": 10.5, "end": 11.0},
            {"word": "dunia", "start": 11.0, "end": 11.6},
        ]
        with tempfile.TemporaryDirectory() as folder:
            outdir = Path(folder)
            with patch.object(renderer, "render_caption_png", return_value=True):
                hook = renderer.build_hook_overlay("Judul Hook", outdir / "hook.png", 10.0)
                overlays = renderer.build_caption_overlays(
                    words,
                    10.0,
                    20.0,
                    outdir,
                    hook_title="Judul Hook",
                    include_hook=False,
                )
            self.assertIsNotNone(hook)
            assert hook is not None
            self.assertEqual(hook[0].name, "hook.png")
            self.assertEqual(hook[1], 0.0)
            self.assertAlmostEqual(hook[2], 3.2, places=2)
            self.assertEqual(len(overlays), 2)
            self.assertNotEqual(overlays[0][0].name, "hook.png")
            self.assertAlmostEqual(overlays[0][1], 0.5, places=3)
            self.assertAlmostEqual(overlays[1][1], 1.0, places=3)

    def test_caption_overlays_switches_to_phrase_only_instead_of_dropping(self) -> None:
        import tempfile
        from unittest.mock import patch

        count = renderer.MAX_OVERLAY_STATES + 9
        words = [
            {"word": f"w{i}", "start": i * 0.2, "end": i * 0.2 + 0.18}
            for i in range(count)
        ]
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(renderer, "render_caption_png", return_value=True):
                overlays = renderer.build_caption_overlays(
                    words, 0.0, count * 0.2 + 1.0, Path(folder), include_hook=False
                )
        self.assertEqual(len(overlays), (count + 2) // 3)
        self.assertAlmostEqual(overlays[-1][2], (count - 1) * 0.2 + 0.18, places=2)

    def test_caption_track_keeps_cumulative_timeline_in_manifest(self) -> None:
        import tempfile
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            cap1 = root / "cap_001.png"
            cap2 = root / "cap_002.png"
            empty = root / "empty.png"
            for p in (cap1, cap2, empty):
                p.write_bytes(b"png")

            overlays = [(cap1, 0.5, 1.0), (cap2, 2.0, 2.5)]
            target = root / "track.mov"

            def fake_run(cmd, **_kwargs):
                Path(cmd[-1]).write_bytes(b"mov")

            with (
                patch.object(renderer, "which", return_value="ffmpeg"),
                patch.object(renderer.subprocess, "run", side_effect=fake_run),
            ):
                out = renderer.build_caption_track(overlays, target, 4.0, scratch=root)

            self.assertEqual(out, target)
            manifest = (root / "captions.txt").read_text()
            self.assertIn("duration 0.500", manifest)
            self.assertIn("duration 1.000", manifest)
            self.assertIn("duration 1.500", manifest)

    def test_render_clip_uses_keyframe_offset_and_atrim(self) -> None:
        import inspect

        src = inspect.getsource(renderer.render_clip)
        self.assertIn("nearest_keyframe_before", src)
        self.assertIn("atrim=start=", src)
        self.assertIn("include_hook=False", src)
        self.assertIn("set_clip_render_progress", src)

    def test_set_clip_render_progress_stores_and_clears_redis_key(self) -> None:
        from unittest.mock import MagicMock, patch
        from clipping import pipeline

        fake_redis = MagicMock()
        with patch.object(pipeline, "redis_client", return_value=fake_redis):
            pipeline.set_clip_render_progress(42, 7, "encoding", 55.4, "Merender…")
            fake_redis.set.assert_called_once()
            fake_redis.publish.assert_called_once()

            pipeline.set_clip_render_progress(42, 7, "completed", 100.0, "Selesai")
            fake_redis.delete.assert_called_once_with(
                f"{pipeline.RENDER_PROGRESS_KEY_PREFIX}42"
            )


if __name__ == "__main__":
    unittest.main()
