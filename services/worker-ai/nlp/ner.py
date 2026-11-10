"""Named entity extraction for Indonesian news (spaCy + gazetteer fallback)."""

from __future__ import annotations

import logging
import re
from typing import Any

from config import settings
from nlp.normalizer import clean_text

logger = logging.getLogger(__name__)

KNOWN_ORGANIZATIONS = (
    "Bank Indonesia",
    "Kementerian Keuangan",
    "Kementerian ESDM",
    "Kementerian Kesehatan",
    "Kementerian Pendidikan",
    "Kementerian Luar Negeri",
    "Kementerian Dalam Negeri",
    "Kementerian BUMN",
    "Kementerian Pertahanan",
    "Pemerintah Provinsi DKI Jakarta",
    "Pemerintah",
    "Pemprov DKI",
    "Pemkot",
    "Pemkab",
    "DPR",
    "DPRD",
    "MPR",
    "KPK",
    "Polri",
    "TNI",
    "BIN",
    "KPU",
    "Bawaslu",
    "OJK",
    "LPS",
    "BPS",
    "Pertamina",
    "PLN",
    "Bulog",
    "BUMN",
    "PSSI",
    "FIFA",
    "WHO",
    "PBB",
    "IMF",
    "World Bank",
    "The Fed",
    "Mahkamah Konstitusi",
    "Mahkamah Agung",
    "Kejaksaan Agung",
    "Istana",
    "Partai Politik",
    "Bank Indonesia",
)

KNOWN_LOCATIONS = (
    "Indonesia",
    "Jakarta",
    "Jawa Barat",
    "Jawa Tengah",
    "Jawa Timur",
    "Sumatera Utara",
    "Sumatera Barat",
    "Sumatera Selatan",
    "Kalimantan Timur",
    "Kalimantan Barat",
    "Kalimantan Selatan",
    "Sulawesi Selatan",
    "Sulawesi Utara",
    "Papua",
    "Bali",
    "Aceh",
    "Yogyakarta",
    "Bandung",
    "Surabaya",
    "Medan",
    "Semarang",
    "Makassar",
    "Palembang",
    "Denpasar",
    "Bekasi",
    "Depok",
    "Tangerang",
    "Bogor",
    "Jabodetabek",
    "Amerika Serikat",
    "China",
    "Jepang",
    "Singapura",
    "Malaysia",
    "Australia",
    "Eropa",
    "Timur Tengah",
)

PERSON_TITLE_PATTERN = re.compile(
    r"\b(Presiden|Wakil Presiden|Menteri|Wakil Menteri|Gubernur|Wakil Gubernur|"
    r"Wali Kota|Wakil Wali Kota|Bupati|Wakil Bupati|Ketua|Wakil Ketua|Jenderal|"
    r"Kapolri|Panglima|Direktur Utama|Dirut|CEO|Sekretaris Jenderal|Sekjen|"
    r"Jaksa Agung|Kepala Staf|Calon Presiden|Capres|Cawapres|Anggota DPR)\s+"
    r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})"
)

MINISTRY_ORG_PATTERN = re.compile(
    r"\b(Kementerian|Kemenko|Badan|Lembaga|Direktorat Jenderal|Pemerintah (?:Provinsi|Kabupaten|Kota))\s+"
    r"([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})"
)

ACRONYM_ORG_PATTERN = re.compile(
    r"\b(PT\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}|[A-Z]{3,6})\b"
)

MINISTRY_WORDS = {
    "keuangan", "kesehatan", "pendidikan", "esdm", "energi", "luar", "dalam",
    "negeri", "bumn", "pertahanan", "agama", "sosial", "perdagangan",
    "perindustrian", "pertanian", "perhubungan", "pariwisata", "hukum",
    "imigrasi", "pemuda", "olahraga", "kelautan", "perikanan", "lingkungan",
    "hidup", "kehutanan", "pertanahan", "desa", "pemberdayaan", "tenaga",
    "kerja", "komunikasi", "digital", "informasi", "aparatur", "pembangunan",
    "nasional", "investasi", "koperasi", "umkm", "pemberdayaan", "perempuan",
    "agama", "sekretariat", "negara",
}

# Bare titles that are not real names ("Presiden", "Menteri ESDM", …).
TITLE_ONLY = {
    "presiden", "wakil", "menteri", "gubernur", "wali", "bupati", "ketua",
    "jenderal", "kapolri", "panglima", "direktur", "dirut", "ceo", "sekjen",
    "jaksa", "kepala", "staf", "calon", "capres", "cawapres", "anggota", "esdm",
    "keuangan", "kesehatan", "pendidikan", "luar", "dalam", "negeri", "bumn",
    "pertahanan", "agama", "sosial", "hukum", "politik", "sekretaris", "dewan",
    "komisioner", "republik", "negara", "badan", "lembaga", "kementerian",
    "pemerintah", "pemprov", "pemkot", "pemkab", "umum", "nasional", "pusat",
    "daerah", "indonesia",
}

PERSON_STOPWORDS = {
    "Republik", "Negara", "Dewan", "Komisioner", "Sekretaris", "Umum", "Badan",
    "Lembaga", "Kementerian", "Pemerintah", "Jenderal", "Menteri", "Presiden",
    "Indonesia", "Jakarta", "Jawa", "Sumatera", "Kalimantan", "Sulawesi", "Papua",
    "Bali", "Aceh", "Yogyakarta", "Bandung", "Surabaya", "Medan", "Semarang",
    "Makassar", "Palembang", "Denpasar", "Bekasi", "Depok", "Tangerang", "Bogor",
    "BUMN", "DPR", "DPRD", "MPR", "KPK", "Polri", "TNI", "BIN", "KPU", "Bawaslu",
    "OJK", "LPS", "BPS", "PLN", "PBB", "IMF", "WHO", "FIFA", "CEO", "ESDM",
}

TITLE_PREFIXES = (
    "Presiden", "Wakil Presiden", "Menteri", "Wakil Menteri", "Gubernur",
    "Wakil Gubernur", "Wali Kota", "Wakil Wali Kota", "Bupati", "Wakil Bupati",
    "Ketua", "Wakil Ketua", "Jenderal", "Kapolri", "Panglima", "Direktur Utama",
    "Dirut", "CEO", "Sekretaris Jenderal", "Sekjen", "Jaksa Agung", "Kepala Staf",
    "Calon Presiden", "Capres", "Cawapres", "Anggota DPR",
)


def _dedupe(values: list[str], limit: int = 12) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        key = value.lower().strip()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(value.strip())
        if len(result) >= limit:
            break
    return result


class EntityExtractor:
    def __init__(self) -> None:
        self._nlp: Any | None = None
        self._attempted = False

    def _load(self) -> None:
        if self._attempted or not settings.use_spacy:
            return
        self._attempted = True
        try:
            import spacy  # type: ignore

            self._nlp = spacy.load(settings.spacy_model)
            logger.info("spaCy NER model %s ready", settings.spacy_model)
        except Exception as error:  # pragma: no cover - optional
            logger.warning("spaCy model unavailable (%s); using gazetteer NER", error)
            try:
                import spacy  # type: ignore

                nlp = spacy.blank("id")
                ruler = nlp.add_pipe("entity_ruler")
                patterns = [
                    {"label": "ORG", "pattern": org} for org in KNOWN_ORGANIZATIONS
                ] + [
                    {"label": "GPE", "pattern": loc} for loc in KNOWN_LOCATIONS
                ]
                ruler.add_patterns(patterns)
                self._nlp = nlp
                logger.info("spaCy blank model with entity ruler ready")
            except Exception as nested:  # pragma: no cover
                logger.warning("spaCy unavailable entirely: %s", nested)
                self._nlp = None

    def extract(self, text: str) -> dict[str, list[str]]:
        cleaned = clean_text(text)
        persons: list[str] = []
        organizations: list[str] = []
        locations: list[str] = []

        for _title, name in PERSON_TITLE_PATTERN.findall(cleaned):
            words = name.split()
            # "Menteri Keuangan Sri Mulyani" / "Jenderal Listyo Sigit" →
            # buang kata jabatan/lembaga di depan nama.
            while words and (
                words[0].lower() in MINISTRY_WORDS
                or words[0].lower() in TITLE_ONLY
            ):
                words.pop(0)
            if not words:
                continue
            candidate = " ".join(words)
            if words[0] in PERSON_STOPWORDS:
                continue
            if all(word.lower() in TITLE_ONLY or word.isupper() for word in words):
                continue
            persons.append(candidate)

        for ministry, name in MINISTRY_ORG_PATTERN.findall(cleaned):
            organizations.append(f"{ministry} {name}")

        lowered = cleaned.lower()
        for organization in KNOWN_ORGANIZATIONS:
            if organization.lower() in lowered:
                organizations.append(organization)

        for location in KNOWN_LOCATIONS:
            if location.lower() in lowered:
                locations.append(location)

        for match in ACRONYM_ORG_PATTERN.findall(cleaned):
            candidate = match.strip()
            if candidate.upper() in {"BUMN", "DPR", "DPRD", "MPR", "KPK", "TNI", "POLRI", "KPU", "BAWASLU", "OJK", "LPS", "BPS", "PLN", "PBB", "IMF", "WHO", "FIFA", "CEO"}:
                organizations.append(candidate.upper() if candidate.isupper() else candidate)

        self._load()
        if self._nlp is not None:
            try:
                document = self._nlp(cleaned[:6000])
                for entity in document.ents:
                    value = entity.text.strip()
                    if not value or len(value) < 3:
                        continue
                    if entity.label_ in {"PERSON", "PER"}:
                        changed = True
                        while changed:
                            changed = False
                            for prefix in TITLE_PREFIXES:
                                if value.startswith(prefix + " "):
                                    value = value[len(prefix) + 1 :]
                                    changed = True
                                    break
                        if (
                            value
                            and value.split()[0] not in PERSON_STOPWORDS
                            and not all(
                                word.lower() in TITLE_ONLY for word in value.split()
                            )
                        ):
                            persons.append(value)
                    elif entity.label_ in {"ORG"}:
                        organizations.append(value)
                    elif entity.label_ in {"GPE", "LOC"}:
                        locations.append(value)
            except Exception as error:  # pragma: no cover
                logger.debug("spaCy inference failed: %s", error)

        return {
            "persons": _dedupe(persons),
            "organizations": _dedupe(organizations),
            "locations": _dedupe(locations),
        }


_extractor: EntityExtractor | None = None


def get_extractor() -> EntityExtractor:
    global _extractor
    if _extractor is None:
        _extractor = EntityExtractor()
    return _extractor


def extract_entities(text: str) -> dict[str, list[str]]:
    return get_extractor().extract(text)
