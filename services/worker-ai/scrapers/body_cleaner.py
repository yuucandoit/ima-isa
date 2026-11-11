"""Normalisasi badan artikel: buang chrome situs, metadata, dan duplikat.

Dipakai dua sisi:
- `scrapers/extractor.py` saat ingestion (validasi hasil ekstraksi), dan
- `clean_bodies.py` saat merapikan data `media_items.clean_content` yang sudah ada.

Semua fungsi di sini murni (tanpa I/O) supaya mudah diuji.
"""

from __future__ import annotations

import re
from typing import Literal

from nlp.normalizer import clean_body

BodyState = Literal["junk", "thin", "empty", "noisy", "ok"]

MIN_BODY_CHARS = 200
CHROME_MAX_CHARS = 70

# Penanda bahwa "teks" sebenarnya kode / CSS, bukan prosa.
CODE_HINT_RE = re.compile(
    r"window\.[A-Za-z_$]|function\s*\(|=>|\b(?:var|const|let)\s+[A-Za-z_$]+\s*="
    r"|!important|@media|/\*!|\bdisplay\s*:\s*(?:flex|none)|\\u002F"
)
SYMBOL_RE = re.compile(r"[{}()\[\]<>;=|&$@\\^~`]")

# Baris boilerplate yang lazim muncul di halaman berita Indonesia.
GENERIC_CHROME = {
    "advertisement",
    "iklan",
    "scrolltocontinuewithcontent",
    "beranda",
    "home",
    "news",
    "indeks",
    "index",
    "video",
    "foto",
    "infografis",
    "editor",
    "redaksi",
    "penulis",
    "reporter",
    "fotografer",
    "tags",
    "tag",
    "kategori",
    "topik",
    "informasiredaksi",
    "laporkantulisan",
    "editorsection",
    "bacajuga",
    "simakjuga",
    "lihatjuga",
    "bacaselengkapnya",
    "simakvideo",
    "simakvideonya",
    "videoterkaittopik",
    "beritaterkait",
    "artikelterkait",
    "sumbergambar",
    "keterangangambar",
    "keteranganfoto",
}

SITE_CHROME = {
    "detikcom",
    "detiknews",
    "detik",
    "20detik",
    "kompascom",
    "kompas",
    "kumparan",
    "kumparancom",
    "kumparannews",
    "cnnindonesia",
    "cnnindonesiacom",
    "cnbcindonesia",
    "cnbcindonesiacom",
    "tribunnews",
    "tribunnewscom",
    "liputan6",
    "liputan6com",
    "tempo",
    "tempoco",
    "tirto",
    "tirtoid",
    "bisniscom",
    "bisnis",
    "bbc",
    "bbcnews",
    "bbcnewsindonesia",
    "bbcindonesia",
}

# Baris yang diawali penanda ini dibuang utuh (link terkait, promo, dsb).
DROP_LINE_RE = re.compile(
    r"^(?:advertisement|iklan|scroll to continue with content|baca juga|simak juga|"
    r"lihat juga|baca selengkapnya|simak video|saksikan\b|tonton\b|video terkait|"
    r"berita terkait|artikel terkait|follow (?:kami|kumparan)|unduh aplikasi|"
    r"download aplikasi|subscribe\b|berlangganan\b|klik\b)\b",
    re.I,
)

# Noise yang menempel di tengah paragraf (hasil render halaman berita).
INLINE_NOISE_RE = re.compile(
    r"\b(?:ADVERTISEMENT|SCROLL TO CONTINUE WITH CONTENT)\b"
    r"|\bIkuti\s+[A-Za-z]+\s+di\s+Google\b"
    r"|\bJadikan\s+[A-Za-z]+\s+sebagai\s+preferensi\s+terpercaya\w*\s+di\s+Google\b"
    r"|\b(?:Baca|Simak|Lihat) juga\s*:"
    r"|\bLiputan mendalam\b[^.]*\.\s*Klik di sini\s*"
    r"|\bAkhir dari Whatsapp\b",
    re.I,
)

# Metadata redaksi yang menempel di awal badan artikel (pola BBC/Detik).
META_SEGMENT_RE = re.compile(
    r"^(?:penulis|peranan|peran|reporter|jurnalis|fotografer|produser|editor|"
    r"telah diterbitkan|diterbitkan|waktu membaca|waktu baca|sumber gambar|"
    r"keterangan gambar|keterangan foto|durasi|tag|kategori|topik|"
    r"kontributor|narator|videografer)\b",
    re.I,
)

META_HEAD_RE = re.compile(
    r"^\s*(?:"
    r"(?:penulis|peranan|peran|reporter|jurnalis|fotografer|produser|editor|kontributor|"
    r"narator|videografer)\s*,?[^.\-–—]{0,80}?\s*[-–—]\s*"
    r"|(?:telah diterbitkan|diterbitkan)\s*[-–—]\s*"
    r"|waktu membaca\s*:\s*\d+\s*menit\s*"
    r"|waktu baca\s*:\s*\d+\s*menit\s*"
    r"|durasi\s*:\s*\d+\s*(?:menit|detik)\s*"
    r"|sumber gambar\s*,\s*[^.\-–—]{0,80}\s*(?:[-–—]\s*)?"
    r"|keterangan(?: gambar| foto)?\s*,\s*[^.\-–—]{0,120}\s*(?:[-–—]\s*)?"
    r")",
    re.I,
)

DATE_LINE_RE = re.compile(
    r"^\d{1,2}\s+[A-Za-z]+\s+\d{4}\b|waktu baca|waktu membaca|\bWIB\b|\bWITA\b",
    re.I,
)


# Awal deretan metadata: pemisah ` - ` yang diikuti label redaksi.
META_ANCHOR_RE = re.compile(
    r"\s+[-–—]\s+(?=(?:penulis|peranan|peran|reporter|jurnalis|fotografer|produser|editor|"
    r"kontributor|telah diterbitkan|diterbitkan|waktu membaca|waktu baca|sumber gambar|"
    r"keterangan)\b)",
    re.I,
)


def _norm_key(text: str) -> str:
    """Kunci perbandingan: hanya huruf/angka, huruf kecil."""
    return re.sub(r"[^0-9a-z]+", "", (text or "").lower())


def looks_like_code(text: str) -> bool:
    """True bila teks lebih mirip JS/CSS ketimbang prosa berita."""
    if not text:
        return False
    sample = text[:4000]
    hints = len(CODE_HINT_RE.findall(sample))
    density = len(SYMBOL_RE.findall(sample)) / max(len(sample), 1)
    # Kurung/titik dua pada judul berita tidak boleh dianggap kode: kepadatan
    # simbol hanya dipakai bila ada minimal satu penanda sintaks.
    return hints >= 2 or (hints >= 1 and density > 0.03) or density > 0.08


def source_tokens(source: str | None, domain: str | None) -> set[str]:
    """Token nama situs untuk mendeteksi baris chrome di awal/akhir badan."""
    tokens: set[str] = set()
    for raw in (source, domain):
        if not raw:
            continue
        value = str(raw).lower()
        tokens.add(_norm_key(value))
        root = value.split(".")[0]
        tokens.add(_norm_key(root))
        tokens.add(_norm_key(value.split(" ")[0]))
    return {token for token in tokens if len(token) >= 3}


def is_chrome_line(line: str, tokens: set[str], title_key: str = "") -> bool:
    """Baris pendek yang hanya berisi nama situs / label boilerplate."""
    stripped = (line or "").strip()
    if not stripped:
        return True
    if len(stripped) > CHROME_MAX_CHARS:
        return False
    key = _norm_key(stripped)
    if not key:
        return True
    if key.isdigit() and len(stripped) <= 6:
        return True
    if title_key and key == title_key:
        return True
    if key in GENERIC_CHROME or key in SITE_CHROME or key in tokens:
        return True
    if DATE_LINE_RE.search(stripped) and len(stripped) <= CHROME_MAX_CHARS and " " in stripped:
        # "10 November 2026 17:31 WIB · waktu baca 4 menit"
        return True
    return False


def strip_metadata_prefix(paragraph: str, title_key: str = "") -> str:
    """Buang metadata redaksi yang menempel di awal paragraf.

    Contoh: `Judul - Penulis, Silvano Hajid - Peranan, Jurnalis BBC News
    Indonesia - Telah diterbitkan - Waktu membaca: 9 menit Isi berita ...`
    Judul yang menempel ikut dibuang bila metadata berada di dekat awal.
    """
    value = paragraph.strip()
    if not value:
        return value

    anchor = META_ANCHOR_RE.search(value)
    if anchor and anchor.start() <= 250 and ". " not in value[: anchor.start()]:
        value = value[anchor.end():].lstrip()

    for _ in range(20):
        match = META_HEAD_RE.match(value)
        if not match or match.end() == 0:
            break
        value = value[match.end():].lstrip(" -–—")
    return value or paragraph


def _drop_duplicate_paragraphs(paragraphs: list[str], title_key: str) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for paragraph in paragraphs:
        key = _norm_key(paragraph)
        if not key or key in seen:
            continue
        if title_key and key == title_key:
            continue
        seen.add(key)
        result.append(paragraph)
    return result


def normalize_article_body(
    text: str,
    *,
    title: str | None = None,
    source: str | None = None,
    domain: str | None = None,
) -> str:
    """Badan artikel rapi: tanpa chrome situs, tanpa metadata, tanpa duplikat."""
    value = clean_body(text or "")
    if not value:
        return ""

    tokens = source_tokens(source, domain)
    title_key = _norm_key(title or "")
    paragraphs: list[str] = []

    for raw_paragraph in value.split("\n\n"):
        paragraph = strip_metadata_prefix(raw_paragraph.strip(), title_key)
        paragraph = INLINE_NOISE_RE.sub(" ", paragraph)
        paragraph = re.sub(r"\s{2,}", " ", paragraph).strip()
        # Judul yang diulang sebagai baris pertama badan artikel.
        if title_key and _norm_key(paragraph) == title_key:
            continue
        if len(paragraph) <= 120 and DROP_LINE_RE.match(paragraph):
            continue
        if is_chrome_line(paragraph, tokens, title_key):
            continue
        paragraphs.append(paragraph)

    paragraphs = _drop_duplicate_paragraphs(paragraphs, title_key)

    # Chrome yang menempel di ekor (nama situs, tag, dsb) dibuang berulang.
    while paragraphs and is_chrome_line(paragraphs[-1], tokens, title_key):
        paragraphs.pop()

    return "\n\n".join(paragraphs).strip()


def classify_body(text: str, title: str | None = None) -> BodyState:
    """Status kualitas badan artikel yang tersimpan."""
    value = (text or "").strip()
    if not value:
        return "empty"
    if looks_like_code(value):
        return "junk"
    paragraphs = value.split("\n\n")
    tokens: set[str] = set()
    chrome = sum(1 for paragraph in paragraphs if is_chrome_line(paragraph, tokens))
    if chrome and chrome / len(paragraphs) >= 0.3:
        return "noisy"
    if len(value) < MIN_BODY_CHARS:
        return "thin"
    if _norm_key(value) == _norm_key(title or ""):
        return "thin"
    return "ok"


def body_is_better(candidate: str, current: str, *, minimum: int = MIN_BODY_CHARS) -> bool:
    """Apakah hasil ekstraksi baru layak menggantikan badan artikel lama."""
    if not candidate or looks_like_code(candidate):
        return False
    candidate_len = len(candidate.strip())
    if candidate_len < minimum:
        return False
    return candidate_len >= len((current or "").strip())
