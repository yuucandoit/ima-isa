"""3-class Indonesian sentiment classification with IndoBERT + lexicon fallback."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from config import settings
from nlp.normalizer import has_negation, normalize_for_analysis, tokenize

logger = logging.getLogger(__name__)

POSITIVE_WORDS = {
    "baik", "bagus", "positif", "naik", "meningkat", "untung", "sukses", "berhasil",
    "maju", "stabil", "kuat", "aman", "dukung", "mendukung", "apresiasi", "bangga",
    "senang", "puas", "optimis", "cerah", "tumbuh", "pertumbuhan", "rekor", "cuan",
    "berkah", "manfaat", "solusi", "transparan", "adil", "sehata", "sehat", "bersih",
    "mudah", "cepat", "murah", "hemat", "berkualitas", "terbaik", "juara", "menang",
    "setuju", "harapan", "harap", "bonus", "insentif", "subsidi", "kemudahan",
}

NEGATIVE_WORDS = {
    "buruk", "jelek", "negatif", "turun", "menurun", "rugi", "gagal", "krisis",
    "mahal", "langka", "korupsi", "korup", "bohong", "hoaks", "bencana", "banjir",
    "kebakaran", "gempa", "longsor", "korban", "tewas", "meninggal", "luka", "rusak",
    "protes", "demo", "tolak", "menolak", "marah", "kecewa", "khawatir", "takut",
    "cemas", "tertekan", "melemah", "anjlok", "ambruk", "bangkrut", "phk", "pengangguran",
    "kemiskinan", "miskin", "beban", "masalah", "konflik", "sengketa", "salah", "curang",
    "kecurangan", "penipuan", "tipu", "lambat", "molor", "macet", "penuh", "sesak",
    "kotor", "tercemar", "polusi", "kekerasan", "pukul", "serang", "ancaman", "bahaya",
    "darurat", "zonk", "parah", "ribet", "rumit", "antre", "kelangkaan", "inflasi",
}

NEGATION_FLIP = {
    "baik": "buruk",
    "bagus": "buruk",
    "positif": "negatif",
    "naik": "turun",
    "meningkat": "menurun",
    "untung": "rugi",
    "sukses": "gagal",
    "stabil": "tidak stabil",
    "aman": "tidak aman",
    "murah": "mahal",
}

LABEL_ALIASES = {
    "positive": "POSITIVE",
    "positif": "POSITIVE",
    "neutral": "NEUTRAL",
    "netral": "NEUTRAL",
    "negative": "NEGATIVE",
    "negatif": "NEGATIVE",
    "label_0": "POSITIVE",
    "label_1": "NEUTRAL",
    "label_2": "NEGATIVE",
    "label_3": "NEUTRAL",
}


@dataclass
class SentimentResult:
    label: str
    score: float
    model: str


def _parse_label_map(raw: str) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for pair in raw.split(","):
        if not pair.strip() or ":" not in pair:
            continue
        key, value = pair.split(":", 1)
        mapped = LABEL_ALIASES.get(value.strip().lower())
        if mapped:
            mapping[key.strip().upper()] = mapped
    return mapping


class SentimentAnalyzer:
    def __init__(self) -> None:
        self._pipeline: Any | None = None
        self._label_map = _parse_label_map(settings.sentiment_label_map)
        self._attempted = False

    def _load(self) -> None:
        if self._attempted or not settings.use_transformers:
            return
        self._attempted = True
        try:
            from transformers import pipeline  # type: ignore

            logger.info("Loading sentiment model %s", settings.sentiment_model)
            self._pipeline = pipeline(
                "text-classification",
                model=settings.sentiment_model,
                tokenizer=settings.sentiment_model,
                top_k=None,
                truncation=True,
                max_length=512,
            )
            logger.info("Sentiment model ready")
        except Exception as error:  # pragma: no cover - model optional
            logger.warning("Sentiment transformer unavailable (%s); using lexicon", error)
            self._pipeline = None

    def _model_labels(self) -> dict[str, str]:
        mapping = dict(self._label_map)
        try:  # enrich with model config when available
            config = getattr(self._pipeline.model, "config", None)
            id2label = getattr(config, "id2label", None) or {}
            for key, value in id2label.items():
                label_key = str(value).upper()
                alias = LABEL_ALIASES.get(str(value).lower())
                if alias:
                    mapping[f"LABEL_{key}"] = alias
                    mapping[label_key] = alias
        except Exception:
            pass
        return mapping

    def analyze(self, text: str) -> SentimentResult:
        normalized = normalize_for_analysis(text)[: settings.max_analysis_chars]
        if not normalized:
            return SentimentResult("NEUTRAL", 0.5, "empty")

        self._load()
        if self._pipeline is not None:
            try:
                raw = self._pipeline(normalized[:2000])
                scores = raw[0] if raw and isinstance(raw[0], list) else raw
                mapping = self._model_labels()
                best: tuple[str, float] | None = None
                for entry in scores:
                    label = mapping.get(str(entry["label"]).upper())
                    if not label:
                        label = LABEL_ALIASES.get(str(entry["label"]).lower())
                    if not label:
                        continue
                    score = float(entry["score"])
                    if best is None or score > best[1]:
                        best = (label, score)
                if best:
                    return SentimentResult(best[0], round(min(0.99, max(0.01, best[1])), 4), settings.sentiment_model)
            except Exception as error:  # pragma: no cover
                logger.debug("Sentiment inference failed: %s", error)

        return self._lexicon(normalized)

    def _lexicon(self, normalized: str) -> SentimentResult:
        tokens = tokenize(normalized)
        positive = 0
        negative = 0
        for index, token in enumerate(tokens):
            if token in POSITIVE_WORDS:
                if has_negation(tokens, index):
                    flipped = NEGATION_FLIP.get(token)
                    if flipped in NEGATIVE_WORDS:
                        negative += 1
                    else:
                        negative += 0.6
                else:
                    positive += 1
            elif token in NEGATIVE_WORDS:
                if has_negation(tokens, index):
                    positive += 0.8
                else:
                    negative += 1

        total = positive + negative
        if total == 0:
            return SentimentResult("NEUTRAL", 0.55, "lexicon")
        balance = (positive - negative) / total
        confidence = min(0.96, 0.5 + abs(balance) * 0.45 + min(total, 10) * 0.01)
        if balance >= 0.2:
            label = "POSITIVE"
        elif balance <= -0.2:
            label = "NEGATIVE"
        else:
            label = "NEUTRAL"
        return SentimentResult(label, round(confidence, 4), "lexicon")


_analyzer: SentimentAnalyzer | None = None


def get_analyzer() -> SentimentAnalyzer:
    global _analyzer
    if _analyzer is None:
        _analyzer = SentimentAnalyzer()
    return _analyzer


def analyze_sentiment(text: str) -> SentimentResult:
    return get_analyzer().analyze(text)
