"""Generic LLM gateway client for the Python worker.

`LLM_URL` di `.env` boleh berupa:
  * URL penuh OpenAI-compatible : https://api.commandcode.ai/provider/v1/chat/completions
  * base OpenAI                 : https://api.commandcode.ai/provider/v1
  * URL penuh Ollama            : http://localhost:11434/api/chat
  * base Ollama                 : http://localhost:11434

API key opsional dikirim via `Authorization: Bearer <key>` (bisa diubah lewat
`LLM_AUTH_HEADER` / `LLM_AUTH_PREFIX`). Body dan parsing respons menyesuaikan
format provider yang terdeteksi.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import requests

from config import settings

logger = logging.getLogger(__name__)

@dataclass(frozen=True)
class ResolvedLlm:
    provider: str  # 'openai' | 'ollama' | 'none'
    chat_url: str
    root_url: str
    model: str


def _strip(value: str) -> str:
    return value.rstrip("/")


def _openai_base(raw: str) -> str:
    return raw if re.search(r"/v\d+(/|$)", raw, re.I) else f"{raw}/v1"


def resolve_llm(
    url: str | None = None,
    model: str | None = None,
    provider: str | None = None,
) -> ResolvedLlm:
    configured = _strip((url if url is not None else settings.llm_url) or "")
    chosen_model = (model if model is not None else settings.llm_model or "").strip()
    if not configured:
        return ResolvedLlm("none", "", "", chosen_model)

    explicit = (provider or settings.llm_provider or "auto").strip().lower()
    lower = configured.lower()

    if lower.endswith("/chat/completions"):
        return ResolvedLlm(
            "openai", configured, configured[: -len("/chat/completions")], chosen_model
        )

    if lower.endswith("/api/chat"):
        return ResolvedLlm(
            "ollama", configured, configured[: -len("/api/chat")], chosen_model
        )

    if lower.endswith("/v1"):
        return ResolvedLlm(
            "openai", f"{configured}/chat/completions", configured, chosen_model
        )

    if lower.endswith("/api"):
        return ResolvedLlm("ollama", f"{configured}/chat", configured, chosen_model)

    if explicit in {"openai", "ollama"}:
        if explicit == "openai":
            base = _openai_base(configured)
            return ResolvedLlm("openai", f"{base}/chat/completions", base, chosen_model)
        return ResolvedLlm("ollama", f"{configured}/api/chat", configured, chosen_model)

    # Auto-detect pola URL umum (OpenAI, commandcode, .../v1/...).
    if (
        re.search(r"/(v\d+|openai)(/|$)", lower)
        or "openai" in lower
        or "commandcode" in lower
    ):
        base = _openai_base(configured)
        return ResolvedLlm("openai", f"{base}/chat/completions", base, chosen_model)

    # Default aman: anggap OpenAI-compatible.
    base = _openai_base(configured)
    return ResolvedLlm("openai", f"{base}/chat/completions", base, chosen_model)


def _headers() -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        # Sebagian gateway (Cloudflare) memblokir UA non-browser/library default.
        "User-Agent": "IMA-ISA/0.1 (+https://localhost)",
    }
    if settings.llm_api_key:
        headers[settings.llm_auth_header] = (
            f"{settings.llm_auth_prefix} {settings.llm_api_key}".strip()
            if settings.llm_auth_prefix
            else settings.llm_api_key
        )
    return headers


def is_configured() -> bool:
    return bool(settings.llm_url and settings.llm_model)


def health(llm: ResolvedLlm | None = None) -> bool:
    target = llm or resolve_llm()
    if target.provider == "none":
        return False
    url = (
        f"{target.root_url}/models"
        if target.provider == "openai"
        else f"{target.root_url}/api/tags"
    )
    try:
        response = requests.get(url, headers=_headers(), timeout=3)
        return response.ok
    except requests.RequestException:
        return False


def _content_to_text(content: object) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                parts.append(str(part.get("text") or ""))
        return "".join(parts).strip()
    return ""


def _extract_text(provider: str, payload: dict) -> str:
    if provider == "openai":
        choices = payload.get("choices") or []
        if not choices:
            return ""
        choice = choices[0] or {}
        message = choice.get("message") or {}
        answer = _content_to_text(message.get("content")) or _content_to_text(
            choice.get("text")
        )
        if answer:
            return answer
        # Hanya pakai CoT bila generasi selesai normal; kalau terpotong,
        # lebih baik fallback daripada menampilkan reasoning mentah.
        if choice.get("finish_reason") == "stop":
            return _content_to_text(message.get("reasoning_content"))
        return ""
    return str(
        (payload.get("message") or {}).get("content") or payload.get("response") or ""
    ).strip()


def chat_complete(messages: list[dict[str, str]]) -> tuple[str, str, str]:
    """Return `(text, model, provider)`; raises on config/transport/HTTP errors."""
    llm = resolve_llm()
    if llm.provider == "none":
        raise RuntimeError("LLM belum dikonfigurasi: set LLM_URL di .env.")
    if not llm.model:
        raise RuntimeError("LLM_MODEL belum diisi di .env.")
    if llm.provider == "openai":
        body = {
            "model": llm.model,
            "messages": messages,
            "stream": False,
            "temperature": 0.2,
            "top_p": 0.9,
            "max_tokens": settings.llm_max_tokens,
        }
    else:
        body = {
            "model": llm.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.2,
                "top_p": 0.9,
                "num_predict": settings.llm_max_tokens,
            },
        }

    response = requests.post(
        llm.chat_url,
        json=body,
        headers=_headers(),
        timeout=settings.llm_timeout,
    )
    if not response.ok:
        detail = " ".join(response.text.split())[:300]
        raise RuntimeError(
            f"LLM HTTP {response.status_code} ({llm.provider}) {detail}".strip()
        )

    text = _extract_text(llm.provider, response.json())
    if not text:
        raise RuntimeError(f"Respons LLM kosong ({llm.provider})")
    return text, llm.model, llm.provider
