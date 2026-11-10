"""768-dimension sentence embeddings (IndoBERT mean pooling + hashing fallback)."""

from __future__ import annotations

import hashlib
import logging
import math
import re

from config import settings
from nlp.normalizer import normalize_for_analysis, tokenize

logger = logging.getLogger(__name__)

DIMENSIONS = 768

LEXICAL_STOPWORDS = {
    "yang", "dan", "dengan", "untuk", "dari", "pada", "akan", "juga", "kata",
    "dalam", "atau", "tapi", "namun", "serta", "agar", "jika", "kalau", "bila",
    "sehingga", "tetapi", "bahkan", "hanya", "saja", "para", "bagi", "oleh",
    "karena", "saat", "masih", "telah", "sudah", "lebih", "paling", "sangat",
    "hampir", "baru", "lama", "kini", "sekarang", "kemudian", "lalu", "setelah",
    "sebelum", "ketika", "sejak", "hingga", "sampai", "tentang", "terhadap",
    "kepada", "adalah", "ialah", "merupakan", "menjadi", "sedang", "the", "and",
    "for", "with", "this", "that", "from", "ini", "itu", "tidak", "bisa", "jadi",
    "ada", "tersebut", "sebuah", "secara", "sesuai", "melalui", "maupun",
}


def _l2_normalize(values: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in values)) or 1.0
    return [value / norm for value in values]


def _fit_dimensions(values: list[float]) -> list[float]:
    if len(values) == DIMENSIONS:
        return _l2_normalize(values)
    if len(values) > DIMENSIONS:
        return _l2_normalize(values[:DIMENSIONS])
    return _l2_normalize(values + [0.0] * (DIMENSIONS - len(values)))


class Embedder:
    """Lazy IndoBERT embedder with a lexical (hashing TF) fallback.

    `mode` reports which backend is actually active so callers can pick a
    sensible cosine-distance threshold: transformer embeddings put same-topic
    articles at ~0.10–0.20, while lexical vectors land around 0.35–0.50.
    """

    def __init__(self) -> None:
        self._tokenizer = None
        self._model = None
        self._torch = None
        self._attempted = False

    @property
    def mode(self) -> str:
        self._load()
        return "transformer" if self._model is not None else "lexical"

    def _load(self) -> None:
        if self._attempted or not settings.use_transformers:
            return
        self._attempted = True
        try:
            import torch  # type: ignore
            from transformers import AutoModel, AutoTokenizer  # type: ignore

            logger.info("Loading embedding model %s", settings.embedding_model)
            self._torch = torch
            self._tokenizer = AutoTokenizer.from_pretrained(settings.embedding_model)
            self._model = AutoModel.from_pretrained(settings.embedding_model)
            self._model.eval()
            logger.info("Embedding model ready")
        except Exception as error:  # pragma: no cover - optional
            logger.warning("Embedding transformer unavailable (%s); using hashing", error)
            self._tokenizer = None
            self._model = None

    def _transformer_embedding(self, text: str) -> list[float] | None:
        if self._model is None or self._tokenizer is None or self._torch is None:
            return None
        try:
            torch = self._torch
            encoded = self._tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=512,
                padding=True,
            )
            with torch.no_grad():
                output = self._model(**encoded)
            hidden = output.last_hidden_state
            mask = encoded["attention_mask"].unsqueeze(-1).expand(hidden.size()).float()
            summed = (hidden * mask).sum(dim=1)
            counts = mask.sum(dim=1).clamp(min=1e-9)
            vector = (summed / counts)[0].tolist()
            return _fit_dimensions([float(value) for value in vector])
        except Exception as error:  # pragma: no cover
            logger.debug("Transformer embedding failed: %s", error)
            return None

    def _hashing_embedding(self, text: str) -> list[float]:
        """Signed hashing TF: unigrams + adjacent bigrams, L2 normalised.

        Document frequency is not available at ingestion time, so this stays a
        pure bag-of-words projection — enough to group near-duplicate headlines
        and wire copy without any model download.
        """
        vector = [0.0] * DIMENSIONS
        tokens = [
            token
            for token in tokenize(text)
            if len(token) > 2 and token not in LEXICAL_STOPWORDS
        ]
        if not tokens:
            return vector

        def add(term: str, weight: float) -> None:
            digest = hashlib.blake2b(term.encode("utf-8"), digest_size=16).digest()
            index = int.from_bytes(digest[:4], "big") % DIMENSIONS
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vector[index] += sign * weight

        for position, token in enumerate(tokens):
            add(token, 1.0)
            if position + 1 < len(tokens):
                add(f"{token} {tokens[position + 1]}", 0.6)

        return _l2_normalize(vector)

    def encode(self, text: str) -> list[float]:
        normalized = normalize_for_analysis(text)[: settings.max_analysis_chars]
        if not normalized:
            return [0.0] * DIMENSIONS
        self._load()
        transformed = self._transformer_embedding(normalized)
        if transformed is not None:
            return transformed
        return self._hashing_embedding(normalized)


_embedder: Embedder | None = None


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        _embedder = Embedder()
    return _embedder


def embed_text(text: str) -> list[float]:
    return get_embedder().encode(text)
