"""Unit tests for normalisation, sentiment fallback and entity extraction.

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

from nlp.embedder import embed_text  # noqa: E402
from nlp.ner import extract_entities  # noqa: E402
from nlp.normalizer import clean_text, normalize_for_analysis, tokenize  # noqa: E402
from nlp.sentiment import analyze_sentiment  # noqa: E402
from scrapers.rss_poller import build_external_id  # noqa: E402


class NormalizerTest(unittest.TestCase):
    def test_slang_is_expanded(self) -> None:
        result = normalize_for_analysis("Harga BBM naik bgt, warga pada baper dgn pemerintah")
        self.assertIn("banget", result)
        self.assertIn("dengan", result)
        self.assertNotIn(" bgt", result)
        self.assertNotIn(" dgn ", result)

    def test_shortcuts_are_expanded(self) -> None:
        result = normalize_for_analysis("Pemrintah hrs blm sdh gak bisa")
        for token in ("pemerintah", "harus", "belum", "sudah", "tidak"):
            self.assertIn(token, result)

    def test_strip_html_and_urls(self) -> None:
        cleaned = clean_text(
            '<p>Halo <b>dunia</b></p> https://example.com/artikel @akun #Pemilu'
        )
        self.assertNotIn("<p>", cleaned)
        self.assertNotIn("https://", cleaned)
        self.assertNotIn("@akun", cleaned)
        self.assertIn("Pemilu", cleaned)

    def test_tokenize_handles_punctuation(self) -> None:
        self.assertEqual(tokenize("Rupiah melemah, inflasi naik!"), ["rupiah", "melemah", "inflasi", "naik"])


class SentimentTest(unittest.TestCase):
    def test_negative_lexicon(self) -> None:
        result = analyze_sentiment("Harga naik, warga miskin mengeluh karena beban hidup mahal")
        self.assertEqual(result.label, "NEGATIVE")
        self.assertGreaterEqual(result.score, 0.5)

    def test_positive_lexicon(self) -> None:
        result = analyze_sentiment("Pemerintah berhasil menurunkan harga, warga senang dan puas")
        self.assertEqual(result.label, "POSITIVE")

    def test_negation_flips_polarity(self) -> None:
        result = analyze_sentiment("Kebijakan ini tidak bagus dan tidak murah")
        self.assertEqual(result.label, "NEGATIVE")

    def test_empty_text_is_neutral(self) -> None:
        result = analyze_sentiment("   ")
        self.assertEqual(result.label, "NEUTRAL")

    def test_score_within_bounds(self) -> None:
        result = analyze_sentiment("Berita biasa tentang cuaca hari ini")
        self.assertGreaterEqual(result.score, 0.0)
        self.assertLessEqual(result.score, 1.0)


class EntityTest(unittest.TestCase):
    def test_extracts_person_without_title(self) -> None:
        entities = extract_entities("Menteri Keuangan Sri Mulyani hadir di Jakarta.")
        self.assertIn("Sri Mulyani", entities["persons"])
        self.assertIn("Jakarta", entities["locations"])

    def test_extracts_organizations(self) -> None:
        entities = extract_entities("Bank Indonesia dan Kementerian ESDM mengumumkan kebijakan.")
        self.assertIn("Bank Indonesia", entities["organizations"])

    def test_ignores_bare_titles(self) -> None:
        entities = extract_entities("Presiden menegaskan kebijakan itu tetap berjalan.")
        self.assertNotIn("Presiden", entities["persons"])


class EmbeddingTest(unittest.TestCase):
    def test_dimension_and_norm(self) -> None:
        vector = embed_text("Rupiah melemah terhadap dolar Amerika Serikat")
        self.assertEqual(len(vector), 768)
        norm = sum(value * value for value in vector) ** 0.5
        self.assertAlmostEqual(norm, 1.0, places=4)

    def test_similar_texts_are_closer(self) -> None:
        a = embed_text("Banjir merendam Jakarta setelah hujan ekstrem")
        b = embed_text("Banjir Jakarta akibat hujan ekstrem")
        c = embed_text("Saham teknologi naik di bursa Amerika")
        dot = lambda x, y: sum(i * j for i, j in zip(x, y))  # noqa: E731
        self.assertGreater(dot(a, b), dot(a, c))

    def test_empty_text_returns_zero_vector(self) -> None:
        self.assertEqual(set(embed_text("")), {0.0})


class DedupeTest(unittest.TestCase):
    def test_external_id_is_stable(self) -> None:
        first = build_external_id("kompas.com", "Rupiah Melemah, BI Buka Suara!")
        second = build_external_id("kompas.com", "rupiah melemah bi buka suara")
        self.assertEqual(first, second)
        self.assertEqual(len(first), 64)

    def test_domains_produce_different_ids(self) -> None:
        self.assertNotEqual(
            build_external_id("kompas.com", "Judul sama"),
            build_external_id("detik.com", "Judul sama"),
        )


if __name__ == "__main__":
    unittest.main()
