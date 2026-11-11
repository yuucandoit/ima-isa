"""Adapter trending multi-platform: X/Twitter, TikTok, dan Google Trends.

Setiap adapter mengembalikan `TrendItem` yang seragam, lalu `store.save_trends()`
menuliskannya ke tabel `social_trends` (dipakai `/api/trending/social`).

Tiga jalur data, dengan kebutuhan kredensial berbeda:

| Sumber | Tanpa kredensial | Dengan kredensial |
| --- | --- | --- |
| Google Trends | ya (RSS publik) | — |
| TikTok | ya (`/node/share/discover`) | cookie sesi opsional |
| X / Twitter | token guest publik | `X_BEARER_TOKEN` (resmi) atau `X_AUTH_TOKEN` + `X_CT0` (login) |
"""

from __future__ import annotations

from .base import TrendItem, save_trends
from .google import fetch_google_trends
from .tiktok import fetch_tiktok_trends
from .x import fetch_x_trends

__all__ = [
    "TrendItem",
    "fetch_google_trends",
    "fetch_tiktok_trends",
    "fetch_x_trends",
    "save_trends",
]
