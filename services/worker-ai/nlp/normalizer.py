"""Indonesian text normalisation: HTML cleanup, slang expansion, tokenisation."""

from __future__ import annotations

import html
import re
import unicodedata

URL_RE = re.compile(r"https?://\S+|www\.\S+")
MENTION_RE = re.compile(r"@\w+")
HASHTAG_RE = re.compile(r"#(\w+)")
HASHTAG_CAPTURE_RE = re.compile(r"#([0-9A-Za-z_\u00C0-\u024F]+)")
WHITESPACE_RE = re.compile(r"\s+")
NON_TEXT_RE = re.compile(r"[^\w\s.,!?%\-()/'\":;]")
TAG_RE = re.compile(r"<[^>]+>")

# Kamus slang / singkatan media sosial Indonesia.
SLANG_MAP: dict[str, str] = {
    "bgt": "banget",
    "banged": "banget",
    "bgtt": "banget",
    "baper": "bawa perasaan",
    "dgn": "dengan",
    "dg": "dengan",
    "dpt": "dapat",
    "dapet": "dapat",
    "tdk": "tidak",
    "gak": "tidak",
    "ga": "tidak",
    "g": "tidak",
    "nggak": "tidak",
    "ngga": "tidak",
    "enggak": "tidak",
    "tak": "tidak",
    "gk": "tidak",
    "gada": "tidak ada",
    "gaada": "tidak ada",
    "udh": "sudah",
    "udah": "sudah",
    "sdh": "sudah",
    "blm": "belum",
    "blum": "belum",
    "bkn": "bukan",
    "org": "orang",
    "krn": "karena",
    "karna": "karena",
    "krna": "karena",
    "yg": "yang",
    "dgn": "dengan",
    "utk": "untuk",
    "u/": "untuk",
    "buat": "untuk",
    "dr": "dari",
    "drpd": "daripada",
    "kl": "kalau",
    "klo": "kalau",
    "kalo": "kalau",
    "jg": "juga",
    "jga": "juga",
    "sm": "sama",
    "sma": "sama",
    "aja": "saja",
    "aj": "saja",
    "dlm": "dalam",
    "dlm": "dalam",
    "bnyk": "banyak",
    "bnyak": "banyak",
    "byk": "banyak",
    "hrs": "harus",
    "hrga": "harga",
    "hrg": "harga",
    "pemrntah": "pemerintah",
    "pemrintah": "pemerintah",
    "pmrintah": "pemerintah",
    "pemerinta": "pemerintah",
    "rakyat": "rakyat",
    "warga": "warga",
    "bumn": "BUMN",
    "zonk": "zonk",
    "aneh": "aneh",
    "parah": "parah",
    "gila": "gila",
    "mantul": "mantap betul",
    "keren": "keren",
    "cuan": "untung",
    "cuan": "untung",
    "boncos": "rugi",
    "kabur": "kabur",
    "ribet": "rumit",
    "mager": "malas bergerak",
    "gabut": "tidak ada pekerjaan",
    "healing": "liburan",
    "influencer": "influencer",
    "netizen": "warganet",
    "viral": "viral",
    "hoax": "hoaks",
    "hoak": "hoaks",
    "hoaxs": "hoaks",
    "dprd": "DPRD",
    "dpr": "DPR",
    "kpk": "KPK",
    "polri": "Polri",
    "tni": "TNI",
    "kemenkeu": "Kementerian Keuangan",
    "kemendikbud": "Kementerian Pendidikan",
    "kemenkes": "Kementerian Kesehatan",
    "pemprov": "pemerintah provinsi",
    "pemkot": "pemerintah kota",
    "pemkab": "pemerintah kabupaten",
}

NEGATIONS = {"tidak", "bukan", "belum", "jangan", "tanpa", "anti", "menolak", "tak"}


def strip_html(text: str) -> str:
    if not text:
        return ""
    return html.unescape(TAG_RE.sub(" ", text))


def clean_text(text: str) -> str:
    """Remove markup, URLs, mentions and collapse whitespace (keeps casing)."""
    if not text:
        return ""
    value = strip_html(text)
    value = URL_RE.sub(" ", value)
    value = MENTION_RE.sub(" ", value)
    value = HASHTAG_RE.sub(r"\1", value)
    value = value.replace("\u00a0", " ")
    value = "".join(
        character
        for character in unicodedata.normalize("NFKC", value)
        if character == "\n" or not unicodedata.category(character).startswith("C")
    )
    value = WHITESPACE_RE.sub(" ", value)
    return value.strip()


def extract_hashtags(text: str, limit: int = 20) -> list[str]:
    """Ambil hashtag dari teks mentah (sebelum clean_text menghapus '#')."""
    if not text:
        return []
    seen: set[str] = set()
    result: list[str] = []
    for match in HASHTAG_CAPTURE_RE.findall(text):
        value = match.strip()
        key = value.lower()
        if len(value) < 2 or key in seen:
            continue
        seen.add(key)
        result.append(value)
        if len(result) >= limit:
            break
    return result


def tokenize(text: str) -> list[str]:
    return [token for token in re.split(r"[^0-9a-zA-ZÀ-ÿ]+", text.lower()) if token]


def normalize_for_analysis(text: str) -> str:
    """Lowercase, expand slang, drop URLs/mentions — safe for NLP models."""
    value = clean_text(text).lower()
    value = HASHTAG_RE.sub(r"\1", value)
    tokens = tokenize(value)
    expanded: list[str] = []
    for token in tokens:
        replacement = SLANG_MAP.get(token, token)
        expanded.append(replacement)
    result = NON_TEXT_RE.sub(" ", " ".join(expanded))
    return WHITESPACE_RE.sub(" ", result).strip()


def has_negation(tokens: list[str], index: int, lookback: int = 3) -> bool:
    start = max(0, index - lookback)
    return any(token in NEGATIONS for token in tokens[start:index])


def summarize_text(text: str, max_chars: int = 420) -> str:
    cleaned = clean_text(text)
    if len(cleaned) <= max_chars:
        return cleaned
    cut = cleaned[:max_chars]
    last_period = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    if last_period > max_chars // 2:
        return cut[: last_period + 1].strip()
    return cut.rsplit(" ", 1)[0].strip() + "…"
