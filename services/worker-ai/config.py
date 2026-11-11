"""Central configuration for the ingestion & AI worker."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv(
        "DATABASE_URL", "postgres://postgres:postgres@localhost:5432/media_intel"
    )
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379")
    raw_stream: str = os.getenv("RAW_STREAM", "media:raw")
    processed_stream: str = os.getenv("PROCESSED_STREAM", "media:processed")
    dead_stream: str = os.getenv("DEAD_STREAM", "media:dead")
    cluster_jobs_stream: str = os.getenv("CLUSTER_JOBS_STREAM", "cluster:jobs")
    consumer_group: str = os.getenv("CONSUMER_GROUP", "ai-workers")
    consumer_name: str = os.getenv("CONSUMER_NAME", f"worker-{os.getpid()}")
    batch_size: int = int(os.getenv("WORKER_BATCH_SIZE", "6"))
    block_ms: int = int(os.getenv("WORKER_BLOCK_MS", "5000"))

    rss_poll_interval: int = int(os.getenv("RSS_POLL_INTERVAL_SECONDS", "180"))
    rss_max_entries_per_feed: int = int(os.getenv("RSS_MAX_ENTRIES_PER_FEED", "15"))
    rss_fetch_fulltext: bool = _bool("EXTRACT_FULLTEXT", True)
    rss_fulltext_limit_per_feed: int = int(os.getenv("FULLTEXT_LIMIT_PER_FEED", "5"))
    rss_timeout_seconds: int = int(os.getenv("RSS_TIMEOUT_SECONDS", "20"))
    dedupe_ttl_seconds: int = int(os.getenv("DEDUPE_TTL_SECONDS", str(7 * 24 * 3600)))
    user_agent: str = os.getenv(
        "USER_AGENT",
        "Mozilla/5.0 (compatible; IMA-ISA/0.1; +https://localhost) AppleWebKit/537.36",
    )

    sentiment_model: str = os.getenv(
        "SENTIMENT_MODEL", "mdhugol/indonesia-bert-sentiment-classification"
    )
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "indobenchmark/indobert-base-p1")
    spacy_model: str = os.getenv("SPACY_MODEL", "id_core_news_lg")
    use_transformers: bool = _bool("USE_TRANSFORMERS", True)
    use_spacy: bool = _bool("USE_SPACY", True)
    sentiment_label_map: str = os.getenv(
        "SENTIMENT_LABEL_MAP", "LABEL_0:POSITIVE,LABEL_1:NEUTRAL,LABEL_2:NEGATIVE"
    )
    max_analysis_chars: int = int(os.getenv("MAX_ANALYSIS_CHARS", "3200"))

    # ── LLM gateway eksternal (executive briefing) ────────────
    # LLM_URL menerima URL penuh OpenAI-compatible atau base /v1.
    # Kosong = briefing memakai fallback ekstraktif (tanpa model lokal).
    llm_url: str = (os.getenv("LLM_URL") or "").strip()
    llm_model: str = (os.getenv("LLM_MODEL") or "").strip()
    llm_api_key: str = (os.getenv("LLM_API_KEY") or "").strip()
    llm_provider: str = (os.getenv("LLM_PROVIDER") or "auto").strip().lower()
    llm_auth_header: str = (os.getenv("LLM_AUTH_HEADER") or "Authorization").strip()
    llm_auth_prefix: str = os.getenv("LLM_AUTH_PREFIX") or "Bearer"
    llm_timeout: int = int(os.getenv("LLM_TIMEOUT_MS") or "60000") // 1000
    llm_max_tokens: int = int(os.getenv("LLM_MAX_TOKENS") or "2000")
    generate_cluster_summaries: bool = _bool("GENERATE_CLUSTER_SUMMARIES", False)

    cluster_window_hours: int = int(os.getenv("CLUSTER_WINDOW_HOURS", "24"))
    # `0` means "auto": 0.25 for transformer embeddings, 0.62 for lexical fallback.
    cluster_distance_threshold: float = float(os.getenv("CLUSTER_DISTANCE_THRESHOLD", "0"))
    cluster_min_items: int = int(os.getenv("CLUSTER_MIN_ITEMS", "5"))
    cluster_max_span_hours: int = int(os.getenv("CLUSTER_MAX_SPAN_HOURS", "4"))
    cluster_interval_seconds: int = int(os.getenv("CLUSTER_INTERVAL_SECONDS", "300"))
    cluster_min_sources: int = int(os.getenv("CLUSTER_MIN_SOURCES", "2"))

    x_bearer_token: str | None = os.getenv("X_BEARER_TOKEN") or None
    #: Cookie login akun X (auth_token + ct0) untuk jalur tanpa X API berbayar.
    x_auth_token: str | None = os.getenv("X_AUTH_TOKEN") or None
    x_ct0: str | None = os.getenv("X_CT0") or None
    #: auto = API resmi → login → guest ; api/login/guest = paksa satu jalur.
    x_trends_mode: str = (os.getenv("X_TRENDS_MODE") or "auto").strip().lower()
    x_query: str = os.getenv("X_QUERY", "(Indonesia OR nasional) -is:retweet lang:id")
    x_trends_woeid: int = int(os.getenv("X_TRENDS_WOEID", "23424846"))
    x_trends_region: str = os.getenv("X_TRENDS_REGION", "Indonesia")

    # ── Trending: Google / TikTok / X ─────────────────────────
    google_trends_geo: str = os.getenv("GOOGLE_TRENDS_GEO", "ID")
    google_trends_region: str = os.getenv("GOOGLE_TRENDS_REGION", "Indonesia")
    #: Jendela waktu yang diambil dari halaman trending (pisahkan koma).
    #: 4/24/48/168 jam. Tiap jendela = 1 request ±1,3 MB.
    google_trends_windows: tuple[int, ...] = tuple(
        int(item)
        for item in os.getenv("GOOGLE_TRENDS_WINDOWS", "24").replace(" ", "").split(",")
        if item.strip().isdigit()
    )
    #: Halaman trending besar (±1,3 MB) sehingga timeout-nya lebih longgar.
    google_trends_timeout_seconds: int = int(os.getenv("GOOGLE_TRENDS_TIMEOUT_SECONDS", "45"))
    #: Hemat bandwidth: hanya ambil ulang bila dashboard sedang dibuka
    #: (API menulis penanda `trends:interest:<platform>` di Redis).
    trends_adaptive: bool = _bool("TRENDS_ADAPTIVE", True)
    #: Saat tidak ada yang membuka dashboard, tetap segarkan tiap N detik.
    trends_idle_interval_seconds: int = int(os.getenv("TRENDS_IDLE_INTERVAL_SECONDS", "3600"))
    #: Sumber utama Google: `page` (scrape halaman) atau `rss`.
    google_trends_source: str = (os.getenv("GOOGLE_TRENDS_SOURCE") or "page").strip().lower()
    tiktok_trends_region: str = os.getenv("TIKTOK_TRENDS_REGION", "ID")
    #: Cookie sesi TikTok Ads (sessionid/sid_tt) untuk Creative Center.
    tiktok_session_cookie: str = (os.getenv("TIKTOK_SESSION_COOKIE") or "").strip()
    tiktok_trends_period: int = int(os.getenv("TIKTOK_TRENDS_PERIOD", "7"))
    #: Jeda minimum antar snapshot tren per platform (detik).
    #: Google berganti tiap ±1 menit, X/TikTok lebih lambat, jadi dipisah.
    trends_capture_interval_seconds: int = int(os.getenv("TRENDS_CAPTURE_INTERVAL_SECONDS", "120"))
    trends_interval_google: int = int(
        os.getenv("TRENDS_INTERVAL_GOOGLE") or os.getenv("TRENDS_CAPTURE_INTERVAL_SECONDS") or "60"
    )
    trends_interval_tiktok: int = int(
        os.getenv("TRENDS_INTERVAL_TIKTOK") or os.getenv("TRENDS_CAPTURE_INTERVAL_SECONDS") or "300"
    )
    trends_interval_x: int = int(
        os.getenv("TRENDS_INTERVAL_X") or os.getenv("TRENDS_CAPTURE_INTERVAL_SECONDS") or "600"
    )
    #: Jumlah tren yang diambil per platform setiap siklus.
    trends_limit_per_platform: int = int(os.getenv("TRENDS_LIMIT_PER_PLATFORM", "20"))
    #: Google (halaman trending) punya ratusan baris — simpan lebih banyak.
    trends_google_limit: int = int(os.getenv("TRENDS_GOOGLE_LIMIT", "200"))
    youtube_channel_ids: tuple[str, ...] = tuple(
        item.strip()
        for item in os.getenv("YOUTUBE_CHANNEL_IDS", "").split(",")
        if item.strip()
    )


settings = Settings()


def _google_news(domain: str) -> str:
    return (
        "https://news.google.com/rss/search"
        f"?q=site:{domain}&hl=id&gl=ID&ceid=ID:id"
    )


@dataclass(frozen=True)
class MediaSource:
    name: str
    domain: str
    feed_url: str
    category: str = "nasional"
    #: Ordered fallbacks tried when the primary feed is unreachable/blocked.
    mirror_urls: tuple[str, ...] = ()
    #: Google News mirrors return redirect links, so full-text scraping is skipped.
    fulltext_supported: bool = True

    @property
    def candidate_urls(self) -> tuple[str, ...]:
        return (self.feed_url, *self.mirror_urls)


# Matriks 10 portal media Indonesia. Several outlets front their RSS with a CDN
# bot wall (HTTP 403), so a Google News site-scoped mirror is used as fallback.
MEDIA_SOURCES: tuple[MediaSource, ...] = (
    MediaSource(
        "Kompas.com",
        "kompas.com",
        _google_news("kompas.com"),
        "otoritatif",
        fulltext_supported=False,
    ),
    MediaSource("Tempo.co", "tempo.co", "https://rss.tempo.co/nasional", "investigasi"),
    MediaSource(
        "CNN Indonesia",
        "cnnindonesia.com",
        "https://www.cnnindonesia.com/nasional/rss",
        "nasional",
    ),
    MediaSource(
        "Detik.com",
        "detik.com",
        _google_news("detik.com"),
        "breaking",
        fulltext_supported=False,
    ),
    MediaSource(
        "Tribunnews.com",
        "tribunnews.com",
        "https://www.tribunnews.com/rss",
        "regional",
        mirror_urls=(_google_news("tribunnews.com"),),
        fulltext_supported=False,
    ),
    MediaSource(
        "Kumparan.com",
        "kumparan.com",
        "https://lapi.kumparan.com/v2.0/rss",
        "digital",
        mirror_urls=(_google_news("kumparan.com"),),
    ),
    MediaSource(
        "Tirto.id",
        "tirto.id",
        "https://tirto.id/rss",
        "data-driven",
        mirror_urls=(_google_news("tirto.id"),),
        fulltext_supported=False,
    ),
    MediaSource(
        "BBC News Indonesia",
        "bbc.com",
        "https://feeds.bbci.co.uk/indonesia/rss.xml",
        "internasional",
    ),
    MediaSource(
        "Bisnis.com",
        "bisnis.com",
        "https://www.bisnis.com/rss",
        "ekonomi",
        mirror_urls=(_google_news("bisnis.com"),),
        fulltext_supported=False,
    ),
    MediaSource(
        "CNBC Indonesia",
        "cnbcindonesia.com",
        "https://www.cnbcindonesia.com/rss",
        "finansial",
    ),
)

__all__ = ["settings", "MEDIA_SOURCES", "MediaSource"]
