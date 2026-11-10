# IMA-ISA — Indonesia Media & Social Intelligence Engine

Platform intelijen media dan jejaring sosial untuk memantau isu nasional, pergerakan
sentimen publik, ekstraksi entitas tokoh/organisasi, dan deteksi dini krisis
(*spike detection*) di Indonesia secara *real-time*.

![Preview](preview-ima-isa.png)

<sub>Dashboard Overview — KPI agregat, peta sebaran isu per wilayah, tren sentimen, dan live feed.</sub>

```
10 Portal Media (RSS) + Media Sosial (X / YouTube)
        │
        ▼
Ingestion Engine        services/worker-ai · feedparser · Trafilatura · dedupe SHA256 (Redis NX)
        │  media:raw (Redis Stream)
        ▼
AI & NLP Worker         IndoBERT / leksikon · spaCy / gazetteer · embedding 768d
        │
        ▼
PostgreSQL 16 + Redis 7  pgvector (HNSW) · Streams / Pub-Sub
        ▲  Drizzle ORM
Core API (Bun + Elysia)  REST · SSE · Alerts · LLM Gateway
        │  Eden Treaty (end-to-end type safety)
        ▼
Dashboard (React 19)     Vite · Tailwind · Recharts · MapLibre GL
```

## Daftar isi

1. [Arsitektur & komponen](#1-arsitektur--komponen)
2. [Prasyarat](#2-prasyarat)
3. [Quick start](#3-quick-start)
4. [Struktur monorepo](#4-struktur-monorepo)
5. [Skema database](#5-skema-database)
6. [API reference](#6-api-reference)
7. [Fitur per modul](#7-fitur-per-modul)
8. [Sumber data](#8-sumber-data)
9. [Perintah](#9-perintah)
10. [Konfigurasi](#10-konfigurasi)
11. [Catatan operasional](#11-catatan-operasional)
12. [Smoke test](#12-smoke-test)

---

## 1. Arsitektur & komponen

| Lapisan | Teknologi | Lokasi |
| --- | --- | --- |
| Ingestion | Python, feedparser, Trafilatura | `services/worker-ai/scrapers/` |
| AI & NLP | IndoBERT / leksikon, spaCy / gazetteer, embedding 768d | `services/worker-ai/nlp/` |
| Message bus | Redis Streams (`media:raw`, `media:dead`) + Pub/Sub | `docker-compose.yml` |
| Penyimpanan | PostgreSQL 16 + `pgvector` (HNSW cosine), Redis 7 | `docker/init/` |
| API | Bun, Elysia.js, TypeBox, Drizzle ORM | `apps/api/` |
| Dashboard | Vite, React 19, Tailwind, Recharts, MapLibre GL | `apps/web/` |
| Kontrak tipe | TypeScript DTO bersama | `packages/types/` |

Worker berjalan **ringan secara default**: tanpa torch, tanpa spaCy, tanpa model lokal.
Sentimen memakai leksikon bernegasi, NER memakai gazetteer, dan embedding memakai
hashing 768 dimensi — cukup untuk laptop biasa. Executive briefing tetap memakai LLM
eksternal dari `.env`.

---

## 2. Prasyarat

| Komponen | Versi | Catatan |
| --- | --- | --- |
| Bun | ≥ 1.2 | runtime API + package manager monorepo |
| Node.js | ≥ 20 | hanya untuk tooling Vite bila diperlukan |
| Python | 3.11 / 3.12 | worker AI (3.14 belum didukung torch) |
| Docker | terbaru | PostgreSQL 16 + pgvector, Redis 7 |
| LLM | opsional | endpoint OpenAI-compatible eksternal; tanpa itu briefing memakai fallback ekstraktif |

---

## 3. Quick start

### 3.1 Langkah dasar

```bash
# 1. Dependensi JS
bun install

# 2. Konfigurasi (satu .env untuk API + worker)
cp .env.example .env
# Opsional, hanya bila worker dijalankan terpisah tanpa root .env:
# cp services/worker-ai/.env.example services/worker-ai/.env

# 3. Infrastruktur
docker compose up -d postgres redis     # atau: bun run infra:up

# 4. Skema & seed 10 portal + kata kunci
bun run db:generate                     # hanya bila skema berubah
bun run db:migrate
bun run db:seed

# 5. API (:3001) + dashboard (:5173)
bun run dev

# 6. Data demo (opsional, idempoten)
curl -X POST "http://localhost:3001/api/dev/seed?generateAlerts=true"
```

Dashboard: <http://localhost:5173> · Swagger: <http://localhost:3001/docs>.

### 3.2 LLM gateway (OpenAI-compatible)

Cukup isi `.env`, tidak perlu ubah kode:

```env
# commandcode — tempel URL lengkapnya
LLM_URL=https://api.commandcode.ai/provider/v1/chat/completions
LLM_API_KEY=sk-...
LLM_MODEL=nama-model-yang-valid

# provider OpenAI-compatible lain
# LLM_URL=https://api.openai.com/v1
# LLM_URL=https://api.groq.com/openai/v1
```

Deteksi otomatis: URL berakhiran `/chat/completions`, mengandung `/v1`, atau berasal
dari provider umum → mode OpenAI. `LLM_PROVIDER=openai` memaksa mode tersebut.
**Tidak ada Ollama/model lokal.** Bila `LLM_URL`/`LLM_MODEL` kosong atau key salah,
briefing otomatis memakai ringkasan ekstraktif dan dashboard tetap jalan. Status
kesehatan tampil di sidebar & halaman Pengaturan sebagai **LLM Gateway**.

> Biaya & privasi: artikel yang diringkas dikirim ke provider pilihanmu. Jangan
> aktifkan briefing untuk data yang tidak boleh keluar dari jaringan.

### 3.3 Satu origin (opsional)

```bash
bun run build
WEB_DIST=apps/web/dist bun run start --cwd apps/api
# dashboard + API + /docs disajikan dari http://localhost:3001
```

### 3.4 Pipeline penuh (dev)

```bash
# Sekali saja: venv worker (dipakai otomatis oleh semua script worker:*)
bun run worker:setup

bun run dev:api        # terminal 1 — API
bun run worker:poll    # terminal 2 — RSS poller → Redis Streams
bun run worker         # terminal 3 — AI enrichment daemon
bun run worker:cluster # terminal 4 — klasterisasi + executive briefing
bun run worker:social  # opsional — poller X + YouTube
```

Script `worker:*` memakai `scripts/py`, yang otomatis memilih
`services/worker-ai/.venv/bin/python` (bukan `python3` global/conda). Override dengan
`PYTHON=/path/to/python bun run worker:poll`.

```bash
bun run dev:worker   # AI + RSS + sosial + cluster sekaligus
bun run dev:all      # API + dashboard + seluruh worker
```

Ingin model AI asli (lebih berat):

```bash
.venv/bin/pip install -r services/worker-ai/requirements-ai.txt
.venv/bin/python -m spacy download id_core_news_lg
# .env: USE_TRANSFORMERS=true, USE_SPACY=true
```

Docker lengkap (API + worker): `docker compose --profile full up -d`.
Untuk worker dengan AI stack di Docker:
`docker compose --profile full build --build-arg INSTALL_AI=true worker-ai`.

---

## 4. Struktur monorepo

```text
IMA-ISA/
├── apps/
│   ├── api/                    # Bun + Elysia gateway, Drizzle, SSE, spike engine
│   │   ├── drizzle/            # migrasi SQL hasil generate
│   │   └── src/
│   │       ├── db/             # schema, client, migrate, seed
│   │       ├── lib/            # env, boolean parser, filters, SSE, redis, LLM, notify, geo
│   │       └── modules/        # analytics, feeds, clusters, alerts, keywords, sources,
│   │                           # trending, system, dev
│   └── web/                    # Vite + React 19 + Tailwind + shadcn-style UI
│       └── src/
│           ├── components/     # ui/ charts/ map/ feeds/ layout/ shared/
│           ├── hooks/          # useSSE, useAnalytics, useTrending, useDebounce
│           ├── lib/            # api (Eden Treaty), format, utils
│           └── pages/          # Overview, MediaMonitoring, TopicClusters, Trending,
│                               # CrisisAlerts, Settings
├── packages/types/             # kontrak DTO bersama (TypeScript)
├── services/worker-ai/         # Python: scrapers, nlp, cluster worker
├── docker/init/                # ekstensi pgvector & pg_trgm
├── scripts/py                  # launcher Python → venv worker
├── docker-compose.yml
└── package.json                # Bun workspaces
```

---

## 5. Skema database

| Tabel | Fungsi | Kolom kunci |
| --- | --- | --- |
| `sources` | master 10 portal + kanal sosial | `domain` unik, `rss_url`, `is_active` |
| `media_items` | artikel/postingan ter-enrich | `external_id` unik (SHA256), `sentiment`, `sentiment_score`, `entities` (jsonb), `embedding vector(768)` |
| `topic_clusters` | klaster isu | `centroid vector(768)`, `total_articles`, `summary` |
| `cluster_items` | relasi klaster ↔ artikel | unik `(cluster_id, media_item_id)` |
| `monitored_keywords` | Boolean watchlist | `boolean_query`, `is_active` |
| `social_trends` | X Trends hasil poller sosial | `woeid`, `name`, `tweet_volume`, `captured_at` |
| `alerts` | peringatan lonjakan | `severity`, `metrics_snapshot` (jsonb), `is_resolved` |

Indeks: HNSW cosine pada `media_items.embedding`, B-tree pada `published_at`,
`sentiment`, `source_id`, `platform`, serta `alerts(triggered_at, severity, is_resolved)`.

---

## 6. API reference

Semua endpoint berada di bawah `/api`.

| Method | Path | Deskripsi |
| --- | --- | --- |
| GET | `/analytics/overview` | KPI, tren sentimen, share of voice, entitas, heatmap |
| GET | `/analytics/locations` | Agregasi entitas lokasi untuk peta sebaran |
| GET | `/feeds` | Feed berpaginasi + filter (`search`, `sentiment`, `sourceId`, `keywordId`, `from`, `to`) |
| GET | `/feeds/breakdown` | Distribusi sentimen untuk filter aktif |
| GET | `/feeds/stream` | **SSE** — event `media`, `alert`, `cluster` |
| GET | `/feeds/:id` | Detail artikel |
| GET | `/clusters` | Daftar klaster (≥ 5 artikel) |
| GET | `/clusters/:id` | Detail klaster + artikel anggota |
| POST | `/clusters/:id/summarize` | Executive briefing (LLM gateway, fallback ekstraktif) |
| POST | `/clusters/rebuild` | Klasterisasi inkremental (admin) |
| GET | `/trending/social` | Trending sosial: X Trends + hashtag (`window=24h\|7d`) |
| GET | `/trending/figures` | Tokoh paling disebut (`period=daily\|weekly\|monthly\|yearly`) |
| GET | `/alerts` | Daftar peringatan (`severity`, `resolved`) |
| POST | `/alerts/scan` | Pindai lonjakan manual (admin) |
| PATCH | `/alerts/:id/resolve` | Tandai selesai |
| GET | `/keywords` | Watchlist Boolean (`withMatches=true` menghitung 7 hari) |
| POST | `/keywords/validate` | Uji sintaks Boolean |
| POST/PATCH/DELETE | `/keywords[/:id]` | CRUD kata kunci |
| GET/PATCH | `/sources[/:id]` | Daftar & toggle portal |
| GET | `/system/status` | Status PostgreSQL, Redis, LLM, backlog worker |
| POST | `/dev/seed` | Dataset demo (non-production) |
| GET | `/health` · `/docs` | Health check & Swagger UI |

Bila `API_KEY` di-set pada `.env`, endpoint mutasi memerlukan header `x-api-key`.
Klien dashboard membaca `VITE_API_KEY` secara otomatis.

---

## 7. Fitur per modul

### Modul 1 — Ingestion & normalisasi

- **1.1 Deduplikasi.** `SHA256(domain + clean_title)` → `external_id` unik. Redis `SETNX`
  mencegah duplikat masuk antrean; `ON CONFLICT DO NOTHING` menjaga idempotensi DB.
- **1.2 Normalisasi slang.** Leksikon 90+ pemetaan (`bgt`→`banget`, `dgn`→`dengan`,
  `bumn`→`BUMN`, …) dijalankan sebelum inferensi, tanpa merusak sintaksis.

### Modul 2 — AI enrichment

- **2.1 Sentimen 3 kelas.** IndoBERT (`USE_TRANSFORMERS=true`) atau leksikon bernegasi;
  label `POSITIVE|NEUTRAL|NEGATIVE` dengan confidence `0.00–1.00`.
- **2.2 Semantic clustering.** Cosine distance < `0.25` (IndoBERT) atau `< 0.62`
  (fallback leksikal TF-hashing — jarak antar embedding leksikal memang lebih lebar),
  jendela `CLUSTER_WINDOW_HOURS` (default 24 jam), ≥ 5 artikel dari ≥ 2 portal.
  Centroid diperbarui inkremental (*weighted average*) dan mode embedding aktif
  di-publish worker ke Redis key `nlp:embedding_mode` agar API memilih ambang yang
  tepat otomatis.

### Modul 3 — Dashboard

- **3.1 SSE live feed.** `useSSE` menahan koneksi dengan backoff eksponensial. Bila
  pengguna sudah scroll (`scrollY > 180`), artikel baru ditahan dan ditampilkan sebagai
  banner *"N artikel baru tersedia"* sehingga posisi scroll tidak pernah di-reset.
- **3.2 Share of voice & filter.** Query terindeks + `staleTime`/`placeholderData`
  TanStack Query; chart ter-render ulang < 600 ms pada dataset uji.
- **3.3 Peta sebaran wilayah.** `GET /api/analytics/locations` memetakan entitas
  `locations` hasil NER ke katalog koordinat statis (`apps/api/src/lib/geo.ts`, ±270
  wilayah) lalu dirender MapLibre GL + basemap vektor gelap OpenFreeMap di Overview.
  Kamera selalu berpusat di Indonesia (Sabang–Merauke) dan dibatasi `maxBounds`
  Nusantara, sehingga sebutan luar negeri tidak menarik peta ke skala dunia.
  Ukuran gelembung = volume sebutan, warna = rasio sentimen negatif (hijau → kuning →
  merah), klik wilayah untuk melihat portal dan headline yang menyebutnya. Wilayah
  asing tetap ada di daftar peringkat (bertanda `LN`), dan lokasi tanpa koordinat
  dilaporkan sebagai `unmapped` agar tidak diam-diam hilang.

### Modul 4 — Crisis & spike engine

- **4.1 Anomali.** Volume 30 menit > `2.5×` baseline 6 jam **atau** rasio negatif ≥ `65%`,
  minimum 5 artikel, cooldown 30 menit → severity `HIGH`/`CRITICAL`. Pemindai berjalan
  otomatis setiap 5 menit dan bisa dipicu manual.
- **4.2 Notifikasi.** `HIGH`/`CRITICAL` dikirim paralel ke Telegram Bot dan/atau webhook
  generik (`notify.ts`), plus siaran SSE dan Redis `alerts:new`.

### Modul 5 — AI executive briefing

- **5.1 Ringkasan klaster.** `POST /clusters/:id/summarize` memanggil LLM gateway
  (prompt terstruktur: Latar Belakang / Eskalasi / Respons / Sumber Rujukan, wajib
  sitasi portal) dan menyimpan hasil ke `topic_clusters.summary`. `LLM_URL` menerima
  **URL penuh OpenAI-compatible** (mis. commandcode
  `.../provider/v1/chat/completions`) atau base `/v1` — tanpa model lokal. API key
  dikirim sebagai `Authorization: Bearer`. Bila belum dikonfigurasi / key salah,
  ringkasan ekstraktif deterministik dipakai agar UI tetap berfungsi.

### Modul 6 — Trending sosial & peringkat tokoh

- **6.1 Trending sosial.** `GET /api/trending/social?window=24h|7d` menggabungkan
  X Trends (tabel `social_trends`, diisi bila `X_BEARER_TOKEN` ada) dengan hashtag
  yang diekstrak dari post sosial (`entities.hashtags`). Setiap item memuat volume,
  delta vs periode sebelumnya, rasio negatif, platform, dan tautan pencarian.
- **6.2 Peringkat tokoh.** `GET /api/trending/figures?period=daily|weekly|monthly|yearly`
  menghitung sebutan entitas `persons` pada jendela harian (1 hari), mingguan (7),
  bulanan (30), atau tahunan (365), beserta pembanding periode sebelumnya, rasio
  negatif, sumber, dan contoh headline. Varian nama (`Prabowo` vs `Prabowo Subianto`)
  digabung otomatis.
- Keduanya tampil di halaman **Trending & Tokoh** dengan tab Sosial Media / Tokoh dan
  filter periode. Data ikut ter-refresh via SSE saat artikel baru masuk.

---

## 8. Sumber data

### 8.1 Media (10 portal)

| # | Portal | Karakteristik | Metode ingestion |
| --- | --- | --- | --- |
| 1 | Kompas.com | otoritatif, agenda setter | Google News mirror (RSS asli 404) |
| 2 | Tempo.co | kritis, investigasi | `rss.tempo.co/nasional` |
| 3 | CNN Indonesia | cepat, geopolitik | `/nasional/rss` |
| 4 | Detik.com | volume tinggi | Google News mirror |
| 5 | Tribunnews.com | regional terluas | RSS + mirror fallback |
| 6 | Kumparan.com | modern, urban | `lapi.kumparan.com/v2.0/rss` |
| 7 | Tirto.id | data-driven | RSS + mirror fallback (Cloudflare) |
| 8 | BBC News Indonesia | netral, analitis | `feeds.bbci.co.uk/indonesia` |
| 9 | Bisnis.com | ekonomi, korporasi | RSS + mirror fallback (Cloudflare) |
| 10 | CNBC Indonesia | pasar & fiskal | `/rss` |

`MediaSource.candidate_urls` mencoba feed utama lalu mirror secara berurutan, sehingga
portal yang memblokir bot (403 Cloudflare) tetap ter-ingest lewat Google News
site-scoped. Skema domain tetap memakai domain asli untuk atribusi & deduplikasi.

### 8.2 Media sosial (opsional)

`services/worker-ai/scrapers/social_poller.py` memakai kontrak payload yang sama dengan
RSS (`media:raw`), jadi AI worker dan dashboard tidak perlu diubah.

| Platform | Metode | Kredensial | Catatan |
| --- | --- | --- | --- |
| X / Twitter | API v2 `search/recent` | `X_BEARER_TOKEN` | perlu akses API berbayar; query diatur `X_QUERY` |
| YouTube | RSS channel publik | `YOUTUBE_CHANNEL_IDS` | tanpa API key; hanya video terbaru, bukan komentar |
| TikTok / Instagram | belum diimplementasikan | — | butuh API resmi/penyedia pihak ketiga |

```env
X_BEARER_TOKEN=...
X_QUERY=(Indonesia OR nasional) -is:retweet lang:id
YOUTUBE_CHANNEL_IDS=UCxxxxxxxx,UCyyyyyyyy
X_TRENDS_WOEID=23424846    # Indonesia
X_TRENDS_REGION=Indonesia
```

```bash
bun run worker:social
# atau: cd services/worker-ai && .venv/bin/python -m scrapers.social_poller
```

Data sosial masuk dengan `platform = TWITTER_X` / `YOUTUBE`, lalu diproses dengan
normalisasi slang, sentimen, NER, dan embedding yang sama. Batasan: teks pendek
membuat NER lebih jarang, dan X umumnya membatasi jumlah request per tier.
X Trends disimpan di `social_trends` lalu digabung dengan hashtag turunan post sosial
oleh Modul 6.

---

## 9. Perintah

| Perintah | Fungsi |
| --- | --- |
| `bun run dev` | API (:3001) + dashboard (:5173) paralel |
| `bun run dev:api` / `dev:web` | salah satu layanan saja |
| `bun run build` | build `packages/types` + dashboard produksi (`tsc -b` & `vite build`) |
| `bun run typecheck` | typecheck API & web |
| `bun run db:generate` / `db:migrate` / `db:push` / `db:seed` | siklus skema |
| `bun run worker:setup` | buat venv + dependencies inti |
| `bun run worker:setup:ai` | opsional: torch + spaCy + model IndoBERT |
| `bun run worker` | AI enrichment daemon |
| `bun run worker:poll` | RSS poller |
| `bun run worker:social` | poller X/YouTube |
| `bun run worker:cluster` | cron klasterisasi |
| `bun run dev:worker` | semua worker sekaligus |
| `bun run dev:all` | API + web + semua worker |
| `bun run infra:up` / `infra:down` / `infra:logs` | Docker Compose |
| `bun run test` | unit test API (parser Boolean, LLM helper) |
| `bun run test:worker` | unit test NLP worker (Python `unittest`) |

---

## 10. Konfigurasi

| Variabel | Default | Fungsi |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/media_intel` | PostgreSQL + pgvector |
| `REDIS_URL` | `redis://localhost:6379` | Streams bus & pub/sub |
| `API_KEY` / `VITE_API_KEY` | kosong | shared secret endpoint mutasi |
| `ALERT_VOLUME_MULTIPLIER` | `2.5` | ambang lonjakan volume |
| `ALERT_NEGATIVE_RATIO` | `0.65` | ambang rasio negatif |
| `ALERT_SCAN_INTERVAL_MS` | `300000` | interval pemindai |
| `LLM_URL` | commandcode URL | URL penuh/base OpenAI-compatible |
| `LLM_API_KEY` | kosong | key provider (dikirim via `Authorization: Bearer`) |
| `LLM_MODEL` | kosong | model ID persis dari provider |
| `LLM_PROVIDER` | `auto` | `auto` \| `openai` (paksa format) |
| `LLM_AUTH_HEADER` / `LLM_AUTH_PREFIX` | `Authorization` / `Bearer` | kustomisasi header auth |
| `LLM_TIMEOUT_MS` | `60000` | timeout request LLM (model reasoning bisa lambat) |
| `LLM_MAX_TOKENS` | `2000` | batas token jawaban (model reasoning butuh lebih besar) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | kosong | fan-out notifikasi |
| `ALERT_WEBHOOK_URL` | kosong | webhook Slack/Teams |
| `X_TRENDS_WOEID` | `23424846` | WOEID wilayah untuk X Trends (Indonesia) |
| `X_TRENDS_REGION` | `Indonesia` | label wilayah pada tabel `social_trends` |
| `CLUSTER_WINDOW_HOURS` | `24` | jendela waktu kandidat klaster |
| `CLUSTER_DISTANCE_THRESHOLD` | `0` (auto) | cosine distance maksimum — 0.25 IndoBERT, 0.62 leksikal |
| `CLUSTER_MIN_ITEMS` | `5` | minimum artikel per klaster |
| `USE_TRANSFORMERS` / `USE_SPACY` | `false` di `.env.example` | mode ringan; set `true` untuk memakai IndoBERT/spaCy asli |

---

## 11. Catatan operasional

- **Worker restart-safe**: pesan gagal dipindah ke `media:dead` lalu di-`XACK`, sehingga
  antrean tidak pernah macet.
- **Redis opsional**: bila Redis mati, API tetap melayani REST (SSE live nonaktif dan
  statusnya tampil di sidebar/settings).
- **Seed idempoten**: eksternal ID demo bersifat deterministik; aman diulang.
- **Rentang waktu** dibatasi maksimum 90 hari per query untuk menjaga latensi agregasi.
- **Zona waktu**: bucket tren dan heatmap dihitung pada WIB (UTC+7).

---

## 12. Smoke test

```bash
# health
curl -s localhost:3001/health

# seed demo (60 artikel, 5 klaster, 3 alert)
curl -s -X POST "localhost:3001/api/dev/seed?generateAlerts=true"

# agregasi (macOS: date -u -v-7d +%FT%TZ · GNU/Linux: date -u -d '7 days ago' +%FT%TZ)
FROM=$(date -u -v-7d +%FT%TZ 2>/dev/null || date -u -d '7 days ago' +%FT%TZ)
curl -s "localhost:3001/api/analytics/overview?from=$FROM&to=$(date -u +%FT%TZ)"

# peta sebaran wilayah
curl -s "localhost:3001/api/analytics/locations?from=$FROM&to=$(date -u +%FT%TZ)"

# klaster + executive briefing
CID=$(curl -s localhost:3001/api/clusters?limit=1 | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
curl -s -X POST localhost:3001/api/clusters/$CID/summarize \
  -H 'content-type: application/json' -d '{"refresh":true}'

# SSE (terminal terpisah)
curl -N "localhost:3001/api/feeds/stream?topics=media"
redis-cli publish media:new '{"id":"x","title":"Tes","sourceName":"Kompas.com","sentiment":"NEGATIVE"}'
```
