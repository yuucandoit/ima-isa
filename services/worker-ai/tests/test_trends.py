"""Unit tests for trend adapters (parsing murni, tanpa network).

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

from datetime import datetime, timezone  # noqa: E402

from scrapers.trends.base import TrendItem, parse_volume  # noqa: E402
from scrapers.trends.google import _published_at  # noqa: E402
from scrapers.trends.x import _normalise  # noqa: E402


class ParseVolumeTest(unittest.TestCase):
    def test_google_traffic_labels(self) -> None:
        self.assertEqual(parse_volume("200+"), 200)
        self.assertEqual(parse_volume("5000+"), 5000)
        self.assertEqual(parse_volume("1.000+"), 1000)

    def test_indonesian_and_english_suffixes(self) -> None:
        self.assertEqual(parse_volume("157.4M tayangan"), 157_400_000)
        self.assertEqual(parse_volume("12,3 jt"), 12_300_000)
        self.assertEqual(parse_volume("923 rb"), 923_000)
        self.assertEqual(parse_volume("1.5B views"), 1_500_000_000)

    def test_unknown_or_empty_labels(self) -> None:
        self.assertIsNone(parse_volume(None))
        self.assertIsNone(parse_volume(""))
        self.assertIsNone(parse_volume("traffic tinggi"))

    def test_plain_numbers(self) -> None:
        self.assertEqual(parse_volume("12.345"), 12_345)


class XNormaliseTest(unittest.TestCase):
    def test_builds_search_url_once_encoded(self) -> None:
        item = _normalise({"name": "#Test", "query": "%23Test"}, 1)
        assert item is not None
        self.assertEqual(item.url, "https://x.com/search?q=%23Test")

    def test_keeps_rank_and_volume(self) -> None:
        item = _normalise({"name": "Gibran", "query": "Gibran", "tweet_volume": 12500}, 3)
        assert item is not None
        self.assertEqual(item.rank, 3)
        self.assertEqual(item.volume, 12_500)

    def test_skips_entries_without_name(self) -> None:
        self.assertIsNone(_normalise({"name": "   "}, 1))

    def test_accepts_v2_shape(self) -> None:
        item = _normalise({"trend_name": "Prabowo", "tweet_count": 9000}, 2)
        assert item is not None
        self.assertEqual(item.name, "Prabowo")
        self.assertEqual(item.platform, "TWITTER_X")


class GooglePublishedAtTest(unittest.TestCase):
    def test_reads_pubdate_into_utc(self) -> None:
        class Entry:
            published_parsed = (2026, 11, 11, 1, 20, 0, 2, 315, 0)

        self.assertEqual(
            _published_at(Entry()),
            datetime(2026, 11, 11, 1, 20, tzinfo=timezone.utc),
        )

    def test_missing_pubdate(self) -> None:
        class Entry:
            pass

        self.assertIsNone(_published_at(Entry()))


class TrendItemTest(unittest.TestCase):
    def test_defaults(self) -> None:
        item = TrendItem(platform="TIKTOK", name="#fyp", rank=1, url="https://x")
        self.assertEqual(item.trend_type, "trend")
        self.assertIsNone(item.volume)
        self.assertIsNone(item.published_at)
        self.assertEqual(item.raw, {})




# ── Google Trends: scrape halaman /trending ──────────────────────────────
import json  # noqa: E402

from scrapers.trends.google_trending import (  # noqa: E402
    parse_row,
    parse_trending_html,
)

SAMPLE_ROWS = [
    [
        "gibran ajukan pengunduran diri", None, "ID", [1794299400], None, None, 50000, None,
        1000, ["gibran ajukan pengunduran diri", "gibran rakabuming raka"], [14, 10],
        [[4923317666, "id", "ID"], [4929528192, "en", "ID"]], "gibran ajukan pengunduran diri",
    ],
    [
        "ptun", None, "ID", [1794304200], None, None, 10000, None, 1000,
        ["ptun", "ijazah gibran"], [10], [[4927794329, "en", "ID"]], "ptun",
    ],
    [
        "trip", None, "ID", [1794363000], None, None, 200, None, 1000,
        ["trip"], [], [], "trip",
    ],
    # geo lain: harus dilewati
    [
        "us only", None, "US", [1794363000], None, None, 999, None, 1000,
        [], [], [], "us only",
    ],
]


def sample_html(rows=SAMPLE_ROWS) -> str:
    payload = "[null," + json.dumps(rows, ensure_ascii=False) + "]"
    return (
        "<html><body><script nonce=\"abc\">"
        f"AF_initDataCallback({{key: 'ds:0', hash: '2', data:{payload}, sideChannel: {{}}}});"
        "</script></body></html>"
    )


class GoogleTrendingParseTest(unittest.TestCase):
    def test_parses_rows_sorted_by_volume(self) -> None:
        items = parse_trending_html(sample_html(), "ID", 24)
        self.assertEqual([item.name for item in items], [
            "gibran ajukan pengunduran diri",
            "ptun",
            "trip",
        ])
        self.assertEqual([item.rank for item in items], [1, 2, 3])
        self.assertEqual(items[0].volume, 50_000)
        self.assertEqual(items[0].window_hours, 24)

    def test_carries_metadata(self) -> None:
        item = parse_trending_html(sample_html(), "ID", 24)[0]
        self.assertEqual(item.news_count, 2)
        self.assertEqual(item.related_queries[:2], [
            "gibran ajukan pengunduran diri",
            "gibran rakabuming raka",
        ])
        self.assertEqual(item.raw["source"], "trending_page")
        self.assertEqual(item.published_at.year, 2026)

    def test_skips_other_geo(self) -> None:
        names = [item.name for item in parse_trending_html(sample_html(), "ID", 24)]
        self.assertNotIn("us only", names)

    def test_schema_drift_returns_empty(self) -> None:
        self.assertEqual(parse_trending_html("<html><body>berubah total</body></html>", "ID", 24), [])

    def test_malformed_payload_returns_empty(self) -> None:
        html = (
            "<script>AF_initDataCallback({key: 'ds:0', hash: '2', "
            "data:[null,[[\"x\"]]], sideChannel: {}});</script>"
        )
        self.assertEqual(parse_trending_html(html, "ID", 24), [])

    def test_parse_row_rejects_incomplete(self) -> None:
        self.assertIsNone(parse_row(["hanya judul"], "ID", 24))
        self.assertIsNone(parse_row([None, None, "ID"], "ID", 24))

if __name__ == "__main__":
    unittest.main()


# ── capture_google: jalur idle vs fallback RSS ───────────────────────────
from types import SimpleNamespace  # noqa: E402

import trends_poller as tp  # noqa: E402


class CaptureGoogleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.saved: list[tuple[list, dict]] = []
        self._orig = (
            tp.settings,
            tp.should_skip_idle,
            tp.fetch_google_trending,
            tp.fetch_google_trends_rss,
            tp.save_trends,
        )
        tp.settings = SimpleNamespace(
            google_trends_source="page",
            google_trends_windows=(24,),
            google_trends_geo="ID",
            google_trends_region="Indonesia",
            trends_google_limit=200,
            trends_interval_google=300,
            trends_idle_interval_seconds=3600,
        )
        tp.save_trends = lambda items, region, **kw: self.saved.append((list(items), kw)) or len(items)

    def tearDown(self) -> None:
        (
            tp.settings,
            tp.should_skip_idle,
            tp.fetch_google_trending,
            tp.fetch_google_trends_rss,
            tp.save_trends,
        ) = self._orig

    def test_idle_skip_tidak_menyentuh_data_maupun_rss(self) -> None:
        tp.should_skip_idle = lambda *args, **kwargs: True
        tp.fetch_google_trending = lambda *args, **kwargs: self.fail("tidak boleh fetch saat idle")
        tp.fetch_google_trends_rss = lambda *args, **kwargs: self.fail("idle bukan alasan fallback ke RSS")

        self.assertEqual(tp.capture_google(200, force=False), 0)
        self.assertEqual(self.saved, [])

    def test_scrape_gagal_baru_pakai_rss(self) -> None:
        tp.should_skip_idle = lambda *args, **kwargs: False
        tp.fetch_google_trending = lambda *args, **kwargs: []
        tp.fetch_google_trends_rss = lambda *args, **kwargs: [
            TrendItem(platform="GOOGLE_TRENDS", name="trip", rank=1, url="https://x", window_hours=24)
        ]

        self.assertEqual(tp.capture_google(200, force=True), 1)
        self.assertEqual(len(self.saved), 1)
        # RSS memang lebih kecil, jadi penggantian harus diizinkan.
        self.assertEqual(self.saved[0][1]["min_replace_ratio"], 0.0)

    def test_scrape_sukses_tidak_panggil_rss(self) -> None:
        tp.should_skip_idle = lambda *args, **kwargs: False
        tp.fetch_google_trending = lambda *args, **kwargs: [
            TrendItem(platform="GOOGLE_TRENDS", name="ptun", rank=1, url="https://x", window_hours=24)
        ]
        tp.fetch_google_trends_rss = lambda *args, **kwargs: self.fail("RSS tidak perlu dipanggil")

        self.assertEqual(tp.capture_google(200, force=True), 1)
        self.assertEqual(len(self.saved), 1)
