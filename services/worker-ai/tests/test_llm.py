"""Unit tests for the generic LLM URL resolver."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("USE_TRANSFORMERS", "false")
os.environ.setdefault("USE_SPACY", "false")

from llm import resolve_llm  # noqa: E402


class ResolveLlmTest(unittest.TestCase):
    def test_full_openai_url(self) -> None:
        llm = resolve_llm(
            url="https://api.commandcode.ai/provider/v1/chat/completions",
            model="test-model",
        )
        self.assertEqual(llm.provider, "openai")
        self.assertEqual(
            llm.chat_url,
            "https://api.commandcode.ai/provider/v1/chat/completions",
        )
        self.assertEqual(llm.root_url, "https://api.commandcode.ai/provider/v1")

    def test_v1_base(self) -> None:
        llm = resolve_llm(url="https://api.openai.com/v1/", model="m")
        self.assertEqual(llm.chat_url, "https://api.openai.com/v1/chat/completions")

    def test_commandcode_base_without_v1(self) -> None:
        llm = resolve_llm(url="https://api.commandcode.ai/provider", model="m")
        self.assertEqual(
            llm.chat_url,
            "https://api.commandcode.ai/provider/v1/chat/completions",
        )

    def test_full_ollama_url(self) -> None:
        llm = resolve_llm(url="http://localhost:11434/api/chat", model="m")
        self.assertEqual(llm.provider, "ollama")
        self.assertEqual(llm.chat_url, "http://localhost:11434/api/chat")

    def test_unknown_host_defaults_to_openai(self) -> None:
        llm = resolve_llm(url="https://gateway.example.com", model="m")
        self.assertEqual(llm.provider, "openai")
        self.assertEqual(
            llm.chat_url, "https://gateway.example.com/v1/chat/completions"
        )

    def test_disabled_when_url_empty(self) -> None:
        llm = resolve_llm(url="", model="m")
        self.assertEqual(llm.provider, "none")
        self.assertEqual(llm.chat_url, "")

    def test_explicit_provider_override(self) -> None:
        llm = resolve_llm(url="https://gateway.example.com", model="m", provider="openai")
        self.assertEqual(
            llm.chat_url, "https://gateway.example.com/v1/chat/completions"
        )

        ollama = resolve_llm(url="https://gateway.example.com", model="m", provider="ollama")
        self.assertEqual(ollama.chat_url, "https://gateway.example.com/api/chat")


if __name__ == "__main__":
    unittest.main()
