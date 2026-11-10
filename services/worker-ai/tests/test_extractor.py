"""Unit tests for the article body fallback extractor.

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

from nlp.normalizer import clean_body  # noqa: E402
from scrapers.extractor import _fallback_text, looks_like_code  # noqa: E402

PROSE = (
    "Warga perumahan di Kemang Pratama mengeluhkan kehadiran coffee shop di "
    "wilayahnya. Kafe tersebut berdiri di Jalan Niaga 2 dan bagian belakangnya "
    "berbatasan langsung dengan rumah warga. " * 4
)

PAGE_WITH_INLINE_CODE = f"""<html><body>
<div id="root"><h1>Judul Berita</h1>
<script>window.process={{"env":{{"API":"https:\\u002F\\u002Fcdn.example"}}}};</script>
<style>.jONudq{{-webkit-flex-direction:column;flex-direction:column}}</style>
<p>{PROSE}</p>
<p>{PROSE}</p>
</div></body></html>"""


class CodeDetectionTest(unittest.TestCase):
    def test_flags_inline_js_and_css_blob(self) -> None:
        blob = (
            "window.process={env:{PUBLIC_API:'x'}}; "
            ".jONudq{-webkit-flex-direction:column;flex-direction:column}/*!sc*/"
        )
        self.assertTrue(looks_like_code(blob))

    def test_accepts_normal_prose(self) -> None:
        self.assertFalse(looks_like_code(PROSE))


class FallbackExtractionTest(unittest.TestCase):
    def test_script_and_style_never_reach_body(self) -> None:
        text = _fallback_text(PAGE_WITH_INLINE_CODE) or ""
        self.assertIn("Kemang Pratama", text)
        self.assertNotIn("window.process", text)
        self.assertNotIn("flex-direction", text)

    def test_paragraphs_are_preserved(self) -> None:
        text = _fallback_text(PAGE_WITH_INLINE_CODE) or ""
        self.assertGreaterEqual(len(text.split("\n\n")), 2)

    def test_page_with_only_code_is_rejected(self) -> None:
        html = "<html><body><div><p>" + ("window.x={a:1};" * 40) + "</p></div></body></html>"
        self.assertIsNone(_fallback_text(html))


class CleanBodyTest(unittest.TestCase):
    def test_keeps_paragraph_breaks(self) -> None:
        self.assertEqual(clean_body("Satu.\n\nDua."), "Satu.\n\nDua.")

    def test_collapses_spaces_inside_paragraph(self) -> None:
        self.assertEqual(clean_body("Satu   dua\t tiga"), "Satu dua tiga")


if __name__ == "__main__":
    unittest.main()
