"""Unit tests for body normalisation & quality classification.

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

from scrapers.body_cleaner import (  # noqa: E402
    body_is_better,
    classify_body,
    looks_like_code,
    normalize_article_body,
    source_tokens,
)

PROSE = (
    "Warga perumahan di Kemang Pratama mengeluhkan kehadiran coffee shop di "
    "wilayahnya. Kafe tersebut berdiri di Jalan Niaga 2 dan bagian belakangnya "
    "berbatasan langsung dengan rumah warga."
)

SOURCE = "kumparanNEWS"
DOMAIN = "kumparan.com"


class SourceTokenTest(unittest.TestCase):
    def test_tokens_cover_name_and_domain(self) -> None:
        tokens = source_tokens(SOURCE, DOMAIN)
        self.assertIn("kumparannews", tokens)
        self.assertIn("kumparan", tokens)


class ChromeTest(unittest.TestCase):
    def test_strips_leading_and_trailing_site_chrome(self) -> None:
        raw = "\n\n".join(["Beranda", "News", "10 November 2026 17:31 WIB · waktu baca 4 menit", PROSE, "ADVERTISEMENT", "kumparanNEWS"])
        cleaned = normalize_article_body(raw, title="Judul Lain", source=SOURCE, domain=DOMAIN)
        self.assertEqual(cleaned, PROSE)

    def test_drops_related_link_lines(self) -> None:
        raw = f"{PROSE}\n\nBaca juga: Judul berita lain yang panjang sekali\n\n{PROSE.replace('Warga', 'Warga kampung')}"
        cleaned = normalize_article_body(raw, title="Judul", source=SOURCE, domain=DOMAIN)
        self.assertNotIn("Baca juga", cleaned)

    def test_removes_inline_ad_and_promo(self) -> None:
        raw = f"{PROSE} ADVERTISEMENT {PROSE.replace('Warga', 'Warga lain')}"
        cleaned = normalize_article_body(raw, title="Judul", domain="kumparan.com")
        self.assertNotIn("ADVERTISEMENT", cleaned)
        self.assertIn("Kemang Pratama", cleaned)

    def test_removes_inline_related_label(self) -> None:
        raw = f"{PROSE} Baca juga: Liputan mendalam di WhatsApp. Klik di sini {PROSE.replace('Warga', 'Warga lain')}"
        cleaned = normalize_article_body(raw, title="Judul", domain="bbc.com")
        self.assertNotIn("Baca juga", cleaned)
        self.assertNotIn("Klik di sini", cleaned)

    def test_drops_promo_tail(self) -> None:
        raw = f"{PROSE}\n\nSaksikan Live DetikSore :"
        cleaned = normalize_article_body(raw, title="Judul", domain="detik.com")
        self.assertEqual(cleaned, PROSE)

    def test_removes_repeated_title_and_duplicate_paragraphs(self) -> None:
        raw = f"Judul Utama\n\n{PROSE}\n\n{PROSE}\n\n{PROSE.replace('.', ' lagi.')}"
        cleaned = normalize_article_body(raw, title="Judul Utama", source=SOURCE, domain=DOMAIN)
        self.assertNotIn("Judul Utama", cleaned)
        self.assertEqual(cleaned.count("Kemang Pratama"), 2)

    def test_strips_bbc_metadata_segments(self) -> None:
        raw = (
            "Polemik ijazah Gibran – Penulis, Silvano Hajid – Peranan, Jurnalis BBC News "
            "Indonesia – Telah diterbitkan – Waktu membaca: 9 menit " + PROSE
        )
        cleaned = normalize_article_body(raw, title="Polemik ijazah Gibran", source="BBC News Indonesia", domain="bbc.com")
        self.assertNotIn("Waktu membaca", cleaned)
        self.assertNotIn("Penulis,", cleaned)
        self.assertIn("Kemang Pratama", cleaned)

    def test_keeps_legitimate_short_intro(self) -> None:
        raw = f"Jakarta, CNBC Indonesia - {PROSE}"
        cleaned = normalize_article_body(raw, title="IHSG Menguat", source="CNBC Indonesia", domain="cnbcindonesia.com")
        self.assertIn("Jakarta, CNBC Indonesia", cleaned)


class ClassifyTest(unittest.TestCase):
    def test_headline_with_parentheses_is_not_code(self) -> None:
        headline = "Siasat Raksasa Semen Indocement (INTP) dan SIG (SMGR) Hadapi Tantangan Industri"
        self.assertFalse(looks_like_code(headline))

    def test_detects_junk_code(self) -> None:
        blob = "window.process={env:{A:1}}; .jO{display:flex}/*!sc*/"
        self.assertTrue(looks_like_code(blob))
        self.assertEqual(classify_body(blob), "junk")

    def test_detects_thin_title_only(self) -> None:
        self.assertEqual(classify_body("Giring Keluar dari PSI! detikNews", "Giring Keluar dari PSI!"), "thin")

    def test_detects_noisy_chrome_heavy(self) -> None:
        raw = "\n\n".join(["Beranda", "News", "ADVERTISEMENT", "Video", "Foto", "Tags"])
        self.assertEqual(classify_body(raw), "noisy")

    def test_accepts_clean_body(self) -> None:
        self.assertEqual(classify_body(f"{PROSE}\n\n{PROSE}"), "ok")

    def test_empty(self) -> None:
        self.assertEqual(classify_body("   "), "empty")


class BetterBodyTest(unittest.TestCase):
    def test_rejects_code_and_shorter_candidates(self) -> None:
        long_body = PROSE * 3
        self.assertFalse(body_is_better("window.x={a:1};" * 40, ""))
        self.assertFalse(body_is_better("pendek", long_body))
        self.assertTrue(body_is_better(long_body, "judul saja"))

    def test_rejects_candidate_shorter_than_minimum(self) -> None:
        self.assertFalse(body_is_better("Cuma satu kalimat pendek.", ""))


if __name__ == "__main__":
    unittest.main()
