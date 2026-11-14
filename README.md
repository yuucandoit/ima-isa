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
4. [Setup server Ubuntu](#4-setup-server-ubuntu)
5. [Struktur monorepo](#5-struktur-monorepo)
6. [Skema database](#6-skema-database)
7. [API reference](#7-api-reference)
   - [7.1 Autentikasi](#71-autentikasi) · [7.2 Bentuk respons error](#72-bentuk-respons-error)
8. [Fitur per modul](#8-fitur-per-modul)
9. [Sumber data](#9-sumber-data)
10. [Perintah](#10-perintah)
11. [Konfigurasi](#11-konfigurasi)
12. [Catatan operasional](#12-catatan-operasional)
13. [Smoke test](#13-smoke-test)

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
WEB_DIST=../web/dist bun run --cwd apps/api start
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

## 4. Setup server Ubuntu

Panduan ini untuk Ubuntu 22.04 / 24.04 LTS (VPS 2 vCPU / 4 GB RAM sudah cukup untuk
mode worker ringan). Semua perintah dijalankan sebagai user non-root dengan `sudo`.

### 4.1 Topologi yang direkomendasikan

```text
Internet :443
   │
 Nginx (TLS certbot) ──► 127.0.0.1:3001  Bun API + dashboard statis (WEB_DIST)
                              │
                              ├─► 127.0.0.1:5432  PostgreSQL 16 + pgvector (Docker)
                              └─► 127.0.0.1:6379  Redis 7 (Docker)

systemd: ima-api · ima-worker · ima-poll · ima-cluster · ima-social (opsional)
```

PostgreSQL, Redis, dan port API **tidak** dibuka ke publik — hanya Nginx (80/443).

### 4.2 Paket sistem

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git unzip build-essential python3 python3-venv python3-dev \
  libxml2-dev libxslt1-dev nginx ufw

# Docker Engine + plugin compose
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # logout/login agar berlaku
```

Ubuntu 24.04 sudah memakai Python 3.12. Untuk 22.04 (Python 3.10) pasang 3.12 dari
[deadsnakes](https://launchpad.net/~deadsnakes/+archive/ubuntu/ppa), lalu gunakan
`python3.12 -m venv` pada langkah 4.5.

### 4.3 Bun

```bash
curl -fsSL https://bun.sh/install | bash
sudo install -m 755 "$HOME/.bun/bin/bun" /usr/local/bin/bun
bun --version   # ≥ 1.2
```

### 4.4 User layanan & kode

```bash
sudo adduser --disabled-password --gecos "" ima
sudo mkdir -p /opt/ima-isa && sudo chown ima:ima /opt/ima-isa
sudo usermod -aG docker ima      # agar user layanan bisa memakai docker CLI
sudo -iu ima

cd /opt/ima-isa
git clone <URL-REPO> .          # atau rsync/scp dari mesin lokal
bun install --frozen-lockfile
```

### 4.5 Konfigurasi `.env` produksi

```bash
cp .env.example .env && chmod 600 .env
nano .env
```

Nilai minimum yang **wajib** diubah (LLM opsional — tanpa itu briefing memakai
fallback ekstraktif):

```env
POSTGRES_PASSWORD=<password-panjang-acak>
POSTGRES_PORT=127.0.0.1:5432        # jangan 5432 saja → Docker membuka ke publik
REDIS_PORT=127.0.0.1:6379
DATABASE_URL=postgres://postgres:<password-panjang-acak>@127.0.0.1:5432/media_intel
REDIS_URL=redis://127.0.0.1:6379
CORS_ORIGIN=https://intel.example.id
API_KEY=<random-32-karakter>
VITE_API_KEY=<sama-dengan-API_KEY>
LLM_URL=https://api.commandcode.ai/provider/v1/chat/completions
LLM_API_KEY=sk-...
LLM_MODEL=nama-model-yang-valid
```

Catatan:

- Karakter khusus pada password harus di-URL-encode di `DATABASE_URL` (mis. `@` → `%40`).
- API memuat `.env` root otomatis (`apps/api/src/lib/load-env.ts`): urutan
  prioritas process env → `apps/api/.env` → `.env` root. Tidak perlu symlink,
  dan `drizzle.config.ts` juga membaca root `.env`. Di systemd tetap tidak
  perlu — variabel di-inject lewat `EnvironmentFile` (menang atas file).
- `.env` root berisi nilai yang di-*quote* dengan benar. Baris seperti
  `X_QUERY=(Indonesia OR nasional) -is:retweet lang:id` tidak boleh
  di-`source` di shell (tanda kurung akan dieksekusi); biarkan dibaca Bun/dotenv.
- Verifikasi cepat bahwa konfigurasi terbaca: `GET /api/system/status` harus
  menampilkan `"llm": "ok"` bila `LLM_URL` + `LLM_MODEL` valid.
- `VITE_API_KEY` di-*bake* saat build dashboard. Bila `API_KEY` diisi, build ulang
  setiap kali key berubah (lihat 4.7).

### 4.6 Infrastruktur database & Redis

```bash
docker compose up -d postgres redis
docker compose ps

# pastikan hanya listening di loopback
ss -lntp | grep -E '5432|6379'
```

Memakai PostgreSQL/Redis yang sudah terpasang di host (tanpa Docker)? Jangan jalankan
compose untuk keduanya — port 5432/6379 akan bentrok. Cukup arahkan `DATABASE_URL` dan
`REDIS_URL` ke instance host, dan pastikan ekstensi tersedia:

```bash
# Ubuntu (versi mengikuti cluster): postgresql-16-pgvector
sudo apt install -y postgresql-16-pgvector

# macOS (Homebrew)
brew install pgvector
psql -d media_intel -c 'CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;'
```

Catatan: `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` hanya dibaca image
PostgreSQL **saat volume pertama kali dibuat**. Mengubahnya setelah cluster ada tidak
mengubah role/password yang sudah ada; untuk instance host, variabel yang berlaku hanya
`DATABASE_URL`.

### 4.7 Skema, build, dan uji API

```bash
# Migrasi (file SQL sudah ada di apps/api/drizzle)
bun run db:migrate
bun run db:seed

# Build dashboard (wajib bila API_KEY diisi, agar VITE_API_KEY ikut ter-bake)
VITE_API_KEY=<nilai-sama> bun run build

# Uji manual sebelum systemd (dari root repo /opt/ima-isa)
NODE_ENV=production WEB_DIST=../web/dist bun run --cwd apps/api start
curl -s localhost:3001/health
```

Hentikan dengan `Ctrl+C` setelah health check mengembalikan status `ok`.

### 4.8 systemd: API

```ini
# /etc/systemd/system/ima-api.service
[Unit]
Description=IMA-ISA API & dashboard (Bun)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=ima
Group=ima
WorkingDirectory=/opt/ima-isa/apps/api
EnvironmentFile=/opt/ima-isa/.env
Environment=NODE_ENV=production
Environment=WEB_DIST=/opt/ima-isa/apps/web/dist
Environment=TZ=Asia/Jakarta
ExecStart=/usr/local/bin/bun src/index.ts
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

### 4.9 systemd: worker Python

Sekali saja, siapkan venv sebagai user `ima`:

```bash
sudo -iu ima /bin/bash -lc 'cd /opt/ima-isa && bun run worker:setup'
```

Unit worker memakai pola yang sama; cukup beda `Description` dan `ExecStart`:

```ini
# /etc/systemd/system/ima-worker.service
[Unit]
Description=IMA-ISA AI enrichment worker
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=ima
Group=ima
WorkingDirectory=/opt/ima-isa/services/worker-ai
EnvironmentFile=/opt/ima-isa/.env
Environment=TZ=Asia/Jakarta
Environment=PYTHONUNBUFFERED=1
ExecStart=/opt/ima-isa/services/worker-ai/.venv/bin/python -m main
Restart=always
RestartSec=10
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

| Service | `ExecStart` (python) | Fungsi |
| --- | --- | --- |
| `ima-worker` | `-m main` | AI enrichment daemon (wajib) |
| `ima-poll` | `-m scrapers.rss_poller` | RSS poller 10 portal (wajib) |
| `ima-cluster` | `-m cluster_worker` | Klasterisasi + briefing |
| `ima-social` | `-m scrapers.social_poller` | X / YouTube (opsional, perlu token) |

Aktifkan semuanya:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ima-api ima-worker ima-poll ima-cluster
sudo systemctl status ima-api ima-worker --no-pager
```

### 4.10 Nginx reverse proxy

Dua varian config sudah tersedia di repo — pilih sesuai kebutuhan:

| File di repo | Dipasang ke | Untuk |
| --- | --- | --- |
| `deploy/nginx/ima-isa.conf` | `/etc/nginx/sites-available/ima-isa` | **produksi**: redirect 80→443, TLS 1.2/1.3, rate limit, SSE, aset immutable, SPA, gzip |
| `deploy/nginx/ima-isa-headers.conf` | `/etc/nginx/snippets/ima-isa-headers.conf` | header keamanan untuk varian produksi (HSTS, nosniff, CSP opsional) |
| `deploy/nginx/ima-isa-http.conf` | `/etc/nginx/sites-available/ima-isa-http` | **lokal/HTTP**: tanpa TLS & certbot, tanpa HSTS |

#### 4.10.1 Varian produksi (HTTPS)

Ganti domain contoh (`server_name` + 2 path sertifikat) di file repo:

```bash
sed -i 's/intel\.example\.id/domain-anda.id/g' deploy/nginx/ima-isa.conf
```

Terbitkan sertifikat dulu (nginx belum jalan, port 80 bebas). Hook disimpan certbot
sehingga renewal otomatis menghentikan/menyalakan nginx:

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone \
  --pre-hook "systemctl stop nginx" --post-hook "systemctl start nginx" \
  -d domain-anda.id -m admin@example.id --agree-tos --no-eff-email
```

Pasang config, lalu uji:

```bash
sudo mkdir -p /var/www/certbot
sudo cp deploy/nginx/ima-isa.conf         /etc/nginx/sites-available/ima-isa
sudo cp deploy/nginx/ima-isa-headers.conf /etc/nginx/snippets/ima-isa-headers.conf
sudo ln -sfn /etc/nginx/sites-available/ima-isa /etc/nginx/sites-enabled/ima-isa
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run
```

Poin penting yang sudah diatur di dalamnya:

- **SSE** `/api/feeds/stream`: `proxy_buffering off`, `proxy_read_timeout 24h`,
  `gzip off`, dan `Connection ''` — tanpa ini live feed tersendat/di-buffer.
- **API** `/api/`: `proxy_read_timeout 180s` agar executive briefing (LLM) tidak
  timeout, plus rate limit 30 r/s per IP (burst 40) dan blokir `/api/dev/` di edge.
- **Aset** `/assets/`: `Cache-Control: immutable` 1 tahun (nama file ber-hash);
  `index.html` justru `no-cache` agar deploy baru langsung terpakai.
- **Headers**: HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`. CSP disediakan sebagai komentar karena MapLibre GL memakai
  worker/blob dan Swagger UI memuat aset dari unpkg — uji di staging sebelum aktif.
- **HTTP/2** memakai sintaks `listen 443 ssl http2;` yang valid di nginx 1.18
  (Ubuntu 22.04) maupun 1.24 (24.04).

#### 4.10.2 Varian lokal (HTTP, tanpa TLS)

Untuk mencoba build produksi tanpa domain/sertifikat — akses lewat
**`http://localhost:2323`**. Port 2323 dipakai (bukan 80) karena tidak butuh root dan
di luar rentang port sementara kernel, jadi tidak bentrok dengan proses lain.

```bash
# 1. API + dashboard dari satu origin (terminal 1)
bun run build
NODE_ENV=production WEB_DIST=../web/dist bun run --cwd apps/api start   # :3001

# 2. Pasang config HTTP (terminal 2)
sudo cp deploy/nginx/ima-isa-http.conf /etc/nginx/sites-available/ima-isa-http
sudo ln -sfn /etc/nginx/sites-available/ima-isa-http /etc/nginx/sites-enabled/ima-isa-http
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Buka <http://localhost:2323>. Ingin port lain? Ubah kedua baris `listen` (IPv4 dan
IPv6) di file config, mis. ke 8080:

```bash
sudo sed -i 's/listen 2323 default_server;/listen 8080 default_server;/' /etc/nginx/sites-available/ima-isa-http
sudo sed -i 's/listen \[::\]:2323 default_server;/listen [::]:8080 default_server;/' /etc/nginx/sites-available/ima-isa-http
sudo nginx -t && sudo systemctl reload nginx
```

Bila nginx berjalan di server (bukan lokal) dan `ufw` aktif, buka port-nya:
`sudo ufw allow 2323/tcp`.

Perbedaan dengan varian produksi:

- Tanpa blok TLS/certbot dan **tanpa HSTS** (header itu tidak berlaku di HTTP).
- Tanpa rate limit per IP — lebih nyaman saat testing.
- `/api/dev/` sengaja tidak diblokir, jadi `POST /api/dev/seed` tetap bisa dipakai
  mengisi data demo selama API berjalan mode dev. Di produksi API sendiri menolak
  endpoint tersebut dengan `403` saat `NODE_ENV=production`.
- Jangan pakai config ini untuk domain publik: API key dan data dashboard lewat
  jaringan tanpa enkripsi.

Varian ini sudah diuji end-to-end pada port 2323: `/health` → `200`, dashboard
`text/html`, SPA fallback `200`, aset `immutable`, dan SSE `text/event-stream`.

### 4.11 Firewall

```bash
sudo ufw default deny incoming
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status verbose
```

Port `3001`, `5432`, dan `6379` **tidak** dibuka — semuanya lewat loopback.
Bun mendengarkan di `0.0.0.0:3001`, jadi jangan matikan `ufw`; bila perlu lapisan
tambahan, batasi akses ke port tersebut lewat aturan `ufw deny 3001`.

### 4.12 Update & backup

```bash
# Update kode
sudo -iu ima /bin/bash -lc '
  cd /opt/ima-isa
  git pull
  bun install --frozen-lockfile
  bun run db:migrate
  VITE_API_KEY=<kunci-yang-sama> bun run build
'
sudo systemctl restart ima-api ima-worker ima-poll ima-cluster

# Backup harian (cron user ima)
mkdir -p ~/backups
docker exec media-intel-postgres pg_dump -U postgres media_intel \
  | gzip > "$HOME/backups/ima-isa-$(date +%F).sql.gz"
```

### 4.13 Verifikasi produksi

```bash
curl -s localhost:3001/health
curl -sI https://intel.example.id | head -1
sudo systemctl is-active ima-api ima-worker ima-poll ima-cluster
sudo journalctl -u ima-api -n 30 --no-pager
curl -N "https://intel.example.id/api/feeds/stream?topics=media"   # SSE tidak boleh ter-buffer
```

### 4.14 Alternatif: Docker penuh

```bash
docker compose --profile full up -d --build
```

Container `worker-ai` hanya menjalankan `python -m main`. Untuk poller & klaster,
tambahkan service turunan di `docker-compose.yml` (profil `full`) dengan
`command` berbeda, mis.:

```yaml
  poller:
    profiles: ["full"]
    build: { context: ./services/worker-ai }
    command: ["python", "-m", "scrapers.rss_poller"]
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-media_intel}
      REDIS_URL: redis://redis:6379
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
```

Jalankan ulang `docker compose --profile full up -d --build` setelah menambah service.
Untuk produksi jangka panjang, systemd (4.8–4.9) lebih mudah di-*restart* per proses
dan log-nya menyatu di `journalctl`.

---

## 5. Struktur monorepo

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
│           ├── features/clipping/  # UrlIngestForm, ClipPreviewCard, DistributionMatrix,
│           │                       # ViralTriggerPanel, ClippingStudioPage
│           ├── hooks/          # useSSE, useAnalytics, useTrending, useClipping, useDebounce
│           ├── lib/            # api (Eden Treaty), format, utils
│           └── pages/          # Overview, MediaMonitoring, TopicClusters, Trending,
│                               # CrisisAlerts, Settings
├── packages/types/             # kontrak DTO bersama (TypeScript)
├── services/worker-ai/         # Python: scrapers, nlp, cluster worker
│   ├── scrapers/               # rss_poller, social_poller, extractor, body_cleaner,
│   │                           # google_news, trends/{google,google_trending,tiktok,x}
│   ├── trends_poller.py        # trending X · TikTok · Google Trends
│   ├── clean_bodies.py         # perapian badan artikel lama di DB
│   ├── clipping/               # pipeline klip: ingestor, curator, renderer,
│   │   │                       # distributor, viral_trigger, tracker, worker
│   │   └── assets/filler_library/  # stok video filler split-screen (9:16)
│   └── nlp/                    # normalizer, sentiment, ner, embedder, summarizer
├── deploy/nginx/               # config Nginx siap pakai (site + headers)
├── docker/init/                # ekstensi pgvector & pg_trgm
├── scripts/py                  # launcher Python → venv worker
├── docker-compose.yml
└── package.json                # Bun workspaces
```

---

## 6. Skema database

| Tabel | Fungsi | Kolom kunci |
| --- | --- | --- |
| `sources` | master 10 portal + kanal sosial | `domain` unik, `rss_url`, `is_active` |
| `media_items` | artikel/postingan ter-enrich | `external_id` unik (SHA256), `sentiment`, `sentiment_score`, `entities` (jsonb), `embedding vector(768)` |
| `topic_clusters` | klaster isu | `centroid vector(768)`, `total_articles`, `summary` |
| `cluster_items` | relasi klaster ↔ artikel | unik `(cluster_id, media_item_id)` |
| `monitored_keywords` | Boolean watchlist | `boolean_query`, `is_active` |
| `social_trends` | snapshot tren X/TikTok/Google | `platform`, `name`, `rank`, `tweet_volume` + `volume_label`, `trend_type`, `window_hours`, `source_published_at`, `related_queries` (jsonb), `news_count`, `raw` (jsonb), `captured_at` |
| `alerts` | peringatan lonjakan | `severity`, `metrics_snapshot` (jsonb), `is_resolved` |
| `clip_sources` | video sumber kliping | `url`, `platform`, `transcript_json` (word-level), `heatmap_json` (most-replayed), `status` |
| `generated_clips` | klip hasil kurasi AI | `start_time`/`end_time`, `virality_score`, `ai_reasoning`, `render_mode`, `output_file_path`, `file_hash` (SHA-256) |
| `clip_distributions` | distribusi multi-akun + payout | `account_username`, `device_serial`, `mutated_file_path`, `status`, metrik views/likes/saves, `cpm_rate_idr`, `estimated_revenue_idr` |

Indeks: HNSW cosine pada `media_items.embedding`, B-tree pada `published_at`,
`sentiment`, `source_id`, `platform`, `social_trends(platform, window_hours, captured_at)`,
serta `alerts(triggered_at, severity, is_resolved)`.

Migrasi `0002`–`0007` menambahkan enum `GOOGLE_TRENDS`, kolom tren baru, dan
membersihkan snapshot lama (RSS 10 item + duplikat akumulatif). Migrasi `0008`
menambahkan tiga tabel pipeline kliping beserta enum status/render. Tabel kliping
memakai `serial` (bukan UUID) karena ID-nya dipakai sebagai nama file artefak
(`clip_<id>.mp4`).

---

## 7. API reference

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
| GET | `/trending/social` | Trending gabungan: X · TikTok · Google Trends + hashtag (`window=24h\|7d`, `platform=TWITTER_X\|TIKTOK\|GOOGLE_TRENDS`, `sort=volume\|rank`, `hours=4\|24\|48\|168`) |
| GET | `/trending/figures` | Tokoh paling disebut (`period=daily\|weekly\|monthly\|yearly`) |
| GET | `/alerts` | Daftar peringatan (`severity`, `resolved`) |
| POST | `/alerts/scan` | Pindai lonjakan manual (admin) |
| PATCH | `/alerts/:id/resolve` | Tandai selesai |
| GET | `/keywords` | Watchlist Boolean (`withMatches=true` menghitung 7 hari) |
| POST | `/keywords/validate` | Uji sintaks Boolean |
| POST/PATCH/DELETE | `/keywords[/:id]` | CRUD kata kunci |
| GET/PATCH | `/sources[/:id]` | Daftar & toggle portal |
| GET | `/system/status` | Status PostgreSQL, Redis, LLM, backlog worker, dan kesehatan pipeline kliping (`clipping.worker` + antrean + dependensi hilang) |
| POST | `/clipping/sources` | Submit URL video → job `clip:ingest` (yt-dlp + heatmap + Whisper) |
| GET | `/clipping/sources` | Daftar sumber + status pipeline |
| GET | `/clipping/sources/:id` | Detail sumber: transkrip word-level, heatmap, daftar klip |
| POST | `/clipping/sources/:id/retry` | Ulangi ingest sumber gagal |
| DELETE | `/clipping/sources/:id` | Hapus sumber + klip + distribusi (cascade) |
| GET | `/clipping/clips` | Daftar klip hasil kurasi AI |
| PATCH/DELETE | `/clipping/clips/:id` | Ubah hook/timing/mode atau hapus klip |
| POST | `/clipping/clips/:id/render` | Render 9:16 (`split_screen` \| `face_reframe` \| `blur_background`) |
| POST | `/clipping/clips/:id/approve` | Setujui / tolak klip |
| POST | `/clipping/clips/:id/distribute` | Jadwalkan distribusi multi-akun + viral trigger |
| GET | `/clipping/distributions` | Daftar distribusi + metrik + estimasi payout |
| POST | `/clipping/distributions/:id/boost` | Picu drip-feed boost manual |
| POST | `/clipping/distributions/track` | Paksa scrape metrik (cron: tiap 3 jam) |
| GET | `/clipping/analytics/summary` | Agregasi views, retensi, payout CPM per platform |
| POST | `/dev/seed` | Dataset demo (non-production) |
| POST | `/auth/login` · `/auth/logout` | Sesi dashboard (cookie `httpOnly`) |
| GET | `/auth/me` | Status sesi saat ini |
| GET | `/health` · `/docs` | Health check & Swagger UI |

Bila `API_KEY` di-set pada `.env`, endpoint mutasi memerlukan header `x-api-key`.
Klien dashboard membaca `VITE_API_KEY` secara otomatis.

### 7.1 Autentikasi

Dashboard dilindungi login. Halaman `/login` menampilkan panel sinyal di kiri
(cakupan 10 portal, tahapan pipeline, log SSE bergulir) dan form di kanan —
di layar kecil panel kiri disembunyikan dan form memenuhi lebar.

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=ima-isa-2026     # WAJIB diganti sebelum deploy publik
AUTH_REQUIRED=true              # false = matikan gerbang login (lokal saja)
```

| Method | Path | Deskripsi |
| --- | --- | --- |
| POST | `/api/auth/login` | Verifikasi kredensial → set cookie sesi `httpOnly` |
| POST | `/api/auth/logout` | Hapus sesi (Redis + cookie) |
| GET | `/api/auth/me` | Status sesi (`authenticated`, `via`, `authRequired`) |

Model keamanan:

- **Cookie `httpOnly` + `SameSite=Lax`.** Token tidak bisa dibaca JavaScript,
  sehingga tidak bisa dicuri lewat XSS. `EventSource` SSE ikut mengirim cookie
  karena same-origin, jadi live feed tetap jalan.
- **Password di-hash argon2id** (`Bun.password`) dan diverifikasi constant-time,
  termasuk perbandingan username — mencegah *timing attack* yang membocorkan
  username valid.
- **Rate limit login**: 8 percobaan gagal / 10 menit per IP (`429`).
- **Sesi disimpan di Redis** (TTL 7 hari) sehingga bertahan saat API restart;
  fallback in-memory bila Redis mati agar dashboard tidak terkunci.
- **Otomasi tetap jalan.** Header `x-api-key` (`API_KEY` di `.env`) masih
  diterima untuk `curl`, cron, dan integrasi — tidak perlu login manual.
- `Secure` pada cookie hanya dipasang saat request HTTPS (mendukung
  `X-Forwarded-Proto` di belakang nginx), supaya dev `http://localhost` tetap bisa.

Semua endpoint di bawah `/api` dijaga satu `onBeforeHandle` global; hanya
`/api/auth/*` yang dikecualikan. Bila `AUTH_REQUIRED=false` dan `API_KEY` kosong,
API terbuka (mode pengembangan).

### 7.2 Bentuk respons error

Semua kegagalan mengembalikan JSON `{ "error": string, "details"?: unknown }`. Handler
`onError` dipasang **sebelum** route (khususnya sebelum `group('/api')`) karena Elysia
1.4 hanya menerapkan handler validasi pada route yang didaftarkan setelahnya.

| Status | Kapan | Contoh `error` |
| --- | --- | --- |
| `401` | `API_KEY` di-set tapi header salah/kosong | `API key tidak valid.` |
| `404` | Path tidak dikenal, atau entitas tidak ada | `Endpoint tidak ditemukan.` / `Artikel tidak ditemukan.` |
| `422` | Skema TypeBox gagal (`details` berisi `path` + `message` per field) | `Validasi input gagal: Expected union value` |
| `503` | PostgreSQL/Redis belum siap (`details` hanya saat `NODE_ENV != production`) | `Layanan data belum siap. Periksa PostgreSQL/Redis.` |
| `500` | Kesalahan tak terduga (`details` hanya saat `NODE_ENV != production`) | `Terjadi kesalahan internal.` |

---

## 8. Fitur per modul

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

- **6.1 Trending multi-platform.** `GET /api/trending/social` menggabungkan tiga
  sumber tren (`social_trends`) dengan hashtag turunan post sosial
  (`entities.hashtags`):
  - **X** — API v2 resmi, cookie login (`X_AUTH_TOKEN`+`X_CT0`), atau guest token
    publik (`X_TRENDS_MODE=auto|api|login|guest`);
  - **TikTok** — Creative Center bila `TIKTOK_SESSION_COOKIE` diisi, jika tidak
    Discover feed publik (hashtag + sound);
  - **Google Trends** — scrape halaman `/trending` (140 tren/24 jam: volume,
    waktu mulai, related queries, jumlah berita) dengan fallback otomatis ke RSS.

  Parameter: `window=24h|7d` (hashtag), `platform`, `sort=volume|rank`
  (default **volume**, karena feed Google sendiri urut kebaruan), dan `hours`
  untuk jendela Google. Respons memuat `sources`, `breakdown`, dan `windows`
  (jendela Google yang benar-benar tersedia). Setiap item membawa `volume`,
  `volumeLabel`, `relatedQueries`, `newsCount`, `publishedAt`, dan `dataSource`
  (`trending_page` / `rss`) agar kualitas data terlihat di UI.
- **6.2 Peringkat tokoh.** `GET /api/trending/figures?period=daily|weekly|monthly|yearly`
  menghitung sebutan entitas `persons` pada jendela harian (1 hari), mingguan (7),
  bulanan (30), atau tahunan (365), beserta pembanding periode sebelumnya, rasio
  negatif, sumber, dan contoh headline. Varian nama (`Prabowo` vs `Prabowo Subianto`)
  digabung otomatis.
- Keduanya tampil di halaman **Trending & Tokoh**: tab Sosial Media (sub-tab
  Semua / X / TikTok / Google, tombol urut *Volume* atau *Peringkat feed*, serta
  pemilih jendela 4 jam / 24 jam / 7 hari yang hanya muncul bila datanya tersedia)
  dan tab Tokoh dengan filter periode. Data ikut ter-refresh via SSE saat artikel
  baru masuk.

### Modul 7 — Automated AI clipping & distribution (`clip.plan.md`)

Pipeline event-driven yang mengubah video panjang menjadi klip vertikal siap-viral.
Orkestrasi HTTP di Bun/Elysia, pemrosesan media berat di worker Python, komunikasi
lewat Redis Streams (`clip:ingest`, `clip:render`, `clip:distribute`, `clip:boost`,
`clip:track`).

- **7.1 Ingest & deteksi viral multi-sinyal.** `yt-dlp --dump-json` mengambil metadata
  + array `heatmap` ("most replayed"). Audio diekstrak ke 16 kHz mono untuk
  `faster-whisper` (word timestamps) dan `librosa` (RMS per 2 detik). Ketiga sinyal
  (heatmap · energi akustik · transkrip) dikirim ke LLM dengan prompt *structured JSON*:
  hook < 3 detik, penutup kalimat selesai, durasi 30–75 detik, skor virality 1–100.
  Tanpa LLM, curator tetap jalan memakai sliding-window heuristik (55% heatmap +
  30% akustik + 15% kepadatan kata).
- **7.2 Render 9:16 + mutasi hash.** Tiga mode: `split_screen` (1080×960 utama +
  1080×960 filler via `vstack`, caption di garis tengah), `face_reframe` (crop
  mengikuti wajah via MediaPipe, fallback crop tengah), dan `blur_background`
  (16:9 + latar `gblur`). Caption `.ass` word-by-word dibakar dengan libass; bila
  build FFmpeg tanpa libass, caption dirender per-kata lewat Pillow lalu di-`overlay`.
  Setiap akun menerima varian unik: speed `1.005–1.015×`, `eq` mikro, crop 1–2%,
  `-map_metadata -1`, CRF acak 21–23.
- **7.3 Distribusi & viral trigger.** Upload via ADB (`uiautomator2`/`adb shell`) ke
  TikTok/Reels/Shorts dengan rotasi IP seluler (airplane-mode toggle) per sesi.
  Trigger human-like: search-to-watch (scroll FYP 2–3 video → Search → buka hasil),
  watch-time 150–220% (loop), save 60% · copy-link 40% · like 80% · komentar 12%,
  dan drip-feed jitter 3–12 menit (distribusi normal). Tanpa perangkat, sesi
  berjalan dalam mode simulasi agar metrik dashboard tetap bergerak.
- **7.4 Tracker & payout.** Cron tiap `CLIP_TRACKER_INTERVAL_SECONDS` (default 3 jam)
  menarik metrik dari `post_url` (Playwright → ADB → simulasi), menghitung
  `revenue = ⌊views/1000⌋ × cpm_rate_idr`, dan menandai `shadowbanned` + alert bila
  `views < 10` setelah 6 jam terbit.
- **7.5 Dashboard.** Halaman **Clipping Studio** (`/clipping`): form ingest, daftar
  sumber live (polling + SSE `clipping`), kartu klip dengan skor virality dan tombol
  render/setujui, dialog distribusi multi-akun, matriks distribusi + boost, panel
  aturan viral trigger, dan tab **Analytics & Payout** (ledger per platform, status
  distribusi, top klip).
- **7.6 Visibilitas progres.** Status sumber tidak sekadar "Antre": setiap baris
  menampilkan tahap pipeline (*Antre → Unduh → Transkripsi → Kurasi AI → Render →
  Selesai*), lama waktu di tahap itu, dan alasan bila mandek. Panel detail
  menampilkan stepper yang sama saat klip belum tersedia. Sumber dianggap **macet**
  bila status aktifnya tidak berubah ≥ 2 menit, atau seketika bila worker mati.
  Banner di atas halaman muncul saat worker tidak berjalan tapi ada job menunggu
  (menyebut jumlah antrean dan perintah untuk menjalankannya) atau saat dependensi
  opsional belum terpasang.

Dua sinyal dipakai agar "sedang diproses" bisa dibedakan dari "tidak akan pernah
jalan":

1. **Heartbeat worker.** `clipping/worker.py` menulis `clipping:worker:heartbeat`
   (TTL 120 s) tiap 15 detik berisi PID, host, mode dry-run, dan dependensi yang
   benar-benar tersedia (`yt-dlp`, `faster-whisper`, `librosa`, `ffmpeg`, `adb`).
   `GET /api/system/status` membaca key ini → `clipping.worker` bernilai
   `online` / `idle` / `offline`, plus `missingDependencies`.
2. **Kedalaman antrean.** Dihitung dari `lag` + `pending` consumer group, **bukan**
   `XLEN` (yang ikut menghitung entri yang sudah di-ACK sehingga antrean kosong
   tetap terlihat penuh).

> Job `clip:ingest` bersifat idempoten: `retry` hanya mengantrekan ulang sumber
> berstatus `failed`/`completed`, dan worker melewati job duplikat yang datang saat
> sumber sudah `completed` atau sedang diproses.

Konfigurasi ada di blok `CLIP_*` pada `.env.example`. Pasang dependensi opsional
dengan `bun run worker:setup:clip`, jalankan worker dengan `bun run worker:clip`
(atau `docker compose --profile clip up worker-clip`).

**Mode uji tanpa dependensi berat.** `CLIP_DRY_RUN=true` menjalankan seluruh
rantai (ingest → kurasi → render → approve → distribusi → tracker → analytics)
tanpa yt-dlp/ffmpeg/Whisper/ADB:

```bash
CLIP_DRY_RUN=true bun run worker:clip
# lalu dari dashboard: submit URL, atau
curl -X POST localhost:3001/api/clipping/sources \
  -H 'content-type: application/json' -d '{"url":"https://youtu.be/<id>"}'
```

Ingest menulis video *placeholder* + transkrip sintetis 120 detik, render
menghasilkan berkas penanda + sidecar `.ass`, dan distribusi memakai varian
file per akun dengan URL postingan placeholder. Metrik tracker disimulasikan
sehingga grafik dashboard ikut bergerak. Semua artefak berada di
`services/worker-ai/storage/clipping/` (di-*gitignore*).

**Dependensi minimum untuk unduhan sungguhan.** `yt-dlp` wajib ada untuk
mengambil video; `faster-whisper` hanya dibutuhkan untuk transkrip (caption),
dan `librosa` untuk sinyal energi akustik. Tanpa `yt-dlp`, worker langsung
menandai sumber `failed` dengan pesan yang menyebut cara memasangnya — bukan
gagal diam-diam. Cukup `yt-dlp` saja sudah bisa mengunduh + merender klip
(caption kosong):

```bash
services/worker-ai/.venv/bin/pip install yt-dlp
bun run worker:clip
```

Install yang lengkap (butuh torch, ~2 GB): `bun run worker:setup:clip`.

**Kegagalan selalu terlihat.** Job yang gagal masuk `clip:dead` **dan**
menandai baris DB terkait sebagai `failed` beserta pesan penyebabnya
(`downloading`/`analyzing` tidak pernah menggantung). Pesan error menyertakan
baris terakhir stderr yt-dlp (video privat, geo-block, 403, butuh login)
alih-alih pesan generik "gagal mengunduh".

**Performa & memori render.** Klip 75 detik dirender dalam **~21 detik**
(sebelumnya >12 menit) dengan puncak RAM worker 42 MB dan FFmpeg 204 MB. Empat
optimasi yang membuatnya, semuanya terukur:

| Optimasi | Sebelum | Sesudah |
| --- | --- | --- |
| Caption track | `overlay` berantai per state — kuadratik (10 state 15 s, 20 state 65 s, 40 state **241 s**) | `concat` demuxer, tanpa compositing (40 state **0,9 s**) |
| Sumber yang diproses | `filter_complex` membaca seluruh video 21 menit (485 MB RSS, 20 s) | potong `-c copy` dulu → filter hanya 75 detik (~15 s, RAM tetap) |
| Encoder | `libx264` software | `h264_videotoolbox` bila ada (CPU 20 s → 9 s) |
| Audio → Whisper | `ffmpeg -i video` (ikut membuka stream video AV1) | `-vn -acodec pcm_s16le -ar 16000 -ac 1` |

Tambahan:
- **Model Whisper dilepas sebelum FFmpeg.** `release_whisper()` dipanggil di
  `finally` (`del` + `gc.collect()` + `torch.cuda.empty_cache()` bila ada)
  sehingga ±500 MB RAM model tidak menumpuk saat render.
- **Batas thread & buffer.** `CLIP_FFMPEG_THREADS` (default 4) membatasi thread;
  `-max_muxing_queue_size 1024` mencegah "Too many packets buffered".
- **Artefak sementara dibersihkan** setelah render (ratusan PNG 1080×1920,
  segmen, track alpha) — hanya `.mp4` dan sidecar `.ass` yang disimpan.
- Semua pemanggilan FFmpeg punya timeout; render yang melewati batas gagal
  dengan pesan jelas alih-alih menggantung.

> Build FFmpeg Homebrew di macOS **tidak menyertakan `libass` maupun
> `drawtext`**, jadi caption tidak bisa dibakar lewat filter `subtitles`.
> Pipeline mendeteksi ini dan memakai jalur frame-sequence (Pillow → concat).
> Sidecar `.ass` selalu disimpan agar caption bisa di-burn ulang dengan build
> FFmpeg yang mendukung libass.

---

## 9. Sumber data

### 9.1 Media (10 portal)

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

### 9.2 Media sosial (opsional)

`services/worker-ai/scrapers/social_poller.py` memakai kontrak payload yang sama dengan
RSS (`media:raw`), jadi AI worker dan dashboard tidak perlu diubah.

| Platform | Metode | Kredensial | Catatan |
| --- | --- | --- | --- |
| X / Twitter | API v2 `search/recent` | `X_BEARER_TOKEN` | perlu akses API berbayar; query diatur `X_QUERY` |
| YouTube | RSS channel publik | `YOUTUBE_CHANNEL_IDS` | tanpa API key; hanya video terbaru, bukan komentar |
| TikTok / Instagram | belum diimplementasikan (ingest) | — | butuh API resmi/penyedia pihak ketiga |

### 9.3 Trending (X · TikTok · Google Trends)

`services/worker-ai/trends_poller.py` mengambil **tren**, bukan konten, lalu menulis
snapshot ke `social_trends`. Tiap platform punya jalur tanpa kredensial dan jalur
kredensial:

| Platform | Tanpa kredensial | Dengan kredensial | Variabel |
| --- | --- | --- | --- |
| Google Trends | ✅ halaman `/trending?geo=ID&hours=24` (140 tren) — fallback RSS 10 tren | — | `GOOGLE_TRENDS_GEO`, `GOOGLE_TRENDS_WINDOWS`, `GOOGLE_TRENDS_SOURCE` |
| TikTok | ✅ Discover feed (`/node/share/discover`): hashtag + sound | Creative Center (volume & periode resmi) | `TIKTOK_SESSION_COOKIE`, `TIKTOK_TRENDS_PERIOD` |
| X / Twitter | ⚠️ guest token publik: nama tren + peringkat, **tanpa volume** | API v2 (`/2/trends/by/woeid`) atau cookie login | `X_BEARER_TOKEN`, atau `X_AUTH_TOKEN` + `X_CT0` |

```bash
bun run worker:trends:probe                 # cek kredensial & isi tiap platform
bun run worker:trends -- --once             # ambil X + TikTok + Google sekali
bun run worker:trends -- --once --platform google
```

Catatan operasional:

- **Cara ambil cookie** (bukan login programatik): buka `x.com` / TikTok Ads di
  browser → DevTools → Application → Cookies → salin `auth_token` & `ct0` (X) atau
  `sessionid` (TikTok) ke `.env`. Token ini setara sesi login — perlakukan sebagai
  rahasia dan rotasi bila bocor.
- **Guest token X** memakai bearer publik klien web, bukan token developer; cukup untuk
  daftar tren, tapi bisa berubah sewaktu-waktu dan tidak memberi `tweet_volume`.
  Pakai API resmi bila butuh volume dan stabilitas.
- Snapshot dibatasi `TRENDS_CAPTURE_INTERVAL_SECONDS` (default 15 menit) per platform,
  retensi 14 hari, dan `--force` untuk memaksa snapshot baru.
- `rank`, label volume asli (`200+`, `157,4 jt tayangan`), sumber berita (Google), serta
  gambar sampul (TikTok/Google) ikut disimpan agar UI bisa menampilkan konteks.
- **Umur tren vs umur snapshot**: kolom `source_published_at` menyimpan waktu tren
  menurut platform (RSS `pubDate` Google, `as_of` X). Filter jendela dan label
  "… lalu" memakai kolom ini; `captured_at` hanya menandai kapan worker mengambil
  snapshot. TikTok tidak menyediakan waktu per tren, jadi memakai `captured_at`.
- **Satu snapshot per platform**: `/api/trending/social` hanya membaca snapshot
  terbaru tiap platform (`DISTINCT ON (platform) … max(captured_at)`), karena daftar
  tren bersifat menggantikan — bukan akumulatif. Tanpa ini peringkat dari snapshot
  lama bertabrakan dengan yang baru.
- **Sumber Google = halaman `/trending`, bukan RSS.** RSS resmi hanya memuat
  **10 tren tanpa parameter jendela**, sementara halaman `trends.google.com/trending`
  menyimpan 140 tren (24 jam) di blok `AF_initDataCallback` — lengkap dengan volume
  (`50.000`), waktu mulai, related queries, dan jumlah berita. `scrapers/trends/
  google_trending.py` mem-parse blok itu dengan tiga lapis pengaman:
  (1) `_looks_like_rows()` mendeteksi bentuk baris tanpa bergantung indeks tetap,
  (2) minimal 50% baris harus valid (kalau tidak → dianggap schema drift),
  (3) `capture_google()` jatuh ke RSS (`raw.source = "rss"`) dan UI menandai `RSS`
  pada item tersebut.
- **Jendela waktu**: `GOOGLE_TRENDS_WINDOWS=24` (default). Bisa `4,24,168` — tiap
  jendela = 1 request ±1,3 MB, jadi tambah jendela berarti tambah bandwidth. UI hanya
  menampilkan tab jendela yang datanya tersedia (`windows` di respons API).
- **Kadens & bandwidth (terukur)**: halaman Google 1,28 MB bila tanpa kompresi,
  tetapi server mengirim **gzip → hanya ±154 KB per request** (curl `--compressed`:
  149–158 KB). Dengan `TRENDS_INTERVAL_GOOGLE=300` itu ≈ **42 MB/hari**.
  `ETag`/`Last-Modified` tidak dikirim dan `Range` tidak dihormati (diuji: selalu
  200 tanpa `Content-Range`), jadi satu-satunya pengungkit nyata adalah frekuensi.
- **Adaptif (default `TRENDS_ADAPTIVE=true`)**: dashboard menandai
  `trends:interest:<platform>` (TTL 15 menit) di Redis setiap `/api/trending/social`
  dipanggil. Worker hanya scrape bila penanda itu ada; kalau sepi, cukup sekali sejam
  (`TRENDS_IDLE_INTERVAL_SECONDS=3600`) → ±3,7 MB/hari saat idle, ±42 MB/hari saat
  ada yang menonton. Siaran feed Google sendiri berganti tiap ±45–90 detik, jadi
  selisih kecil terhadap situs Google adalah konsekuensi frekuensi, bukan bug.
- **Snapshot bersifat menggantikan** (`replace`), bukan append: tabel hanya menyimpan
  daftar terbaru per (platform, jendela). Penggantian dibatalkan bila hasil baru
  < 50% snapshot sebelumnya, supaya scrape cacat tidak menghapus data bagus —
  kecuali pada fallback RSS yang memang lebih kecil dan sengaja menggantikan. Tidak ada parameter resmi untuk memilih jendela 24 jam/7 hari;
  pemilih 24 jam/7 hari hanya memfilter berdasarkan umur tren. Google juga
  menonaktifkan parameter `hl` untuk feed ini (selalu bahasa Inggris).
- **Urutan default = volume, bukan peringkat feed**: feed Google mengurutkan tren
  berdasarkan kebaruan, sehingga item ber-volume `200+` bisa berada di atas `2000+`.
  `social_trends.tweet_volume` menyimpan `approx_traffic` sebagai angka
  (`"2000+" → 2000`), dan `/api/trending/social` mengurutkan menurun dengan
  `sort=volume` (default). Pakai `?sort=rank` untuk urutan asli platform.
  Item yang platformnya tidak memberi volume (X via guest token) tetap urut peringkat
  dan tidak bercampur dengan blok tipe lain.

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
Tren dari X, TikTok, dan Google Trends disimpan di `social_trends` (`trend_type` =
`trend` / `hashtag` / `search` / `sound`) lalu digabung dengan hashtag turunan post
sosial oleh Modul 6 di `/api/trending/social` (filter `?platform=`).

---

## 10. Perintah

| Perintah | Fungsi |
| --- | --- |
| `bun run dev` | API (:3001) + dashboard (:5173) paralel |
| `bun run dev:api` / `dev:web` | salah satu layanan saja |
| `bun run build` | build `packages/types` + dashboard produksi (`tsc -b` & `vite build`) |
| `bun run typecheck` | typecheck API & web |
| `bun run db:generate` / `db:migrate` / `db:push` / `db:seed` | siklus skema |
| `bun run worker:setup` | buat venv + dependencies inti |
| `bun run worker:setup:ai` | opsional: torch + spaCy + model IndoBERT |
| `bun run worker:setup:clip` | opsional: yt-dlp, faster-whisper, librosa, pillow, playwright, uiautomator2 |
| `bun run worker:clip` | worker pipeline kliping (ingest · kurasi · render · distribusi · tracker) |
| `bun run dev:clip` | API + web + worker kliping |
| `bun run worker` | AI enrichment daemon |
| `bun run worker:poll` | RSS poller |
| `bun run worker:social` | poller X/YouTube |
| `bun run worker:trends` | poller trending X/TikTok/Google |
| `bun run worker:trends:probe` | cek kredensial + isi tiap platform trending |
| `bun run worker:cluster` | cron klasterisasi |
| `bun run worker:clean` | audit + rapikan detail berita di DB (dry-run) |
| `bun run worker:clean:apply` | tulis hasil perapian + hitung ulang sentimen/entitas/embedding |
| `bun run dev:worker` | semua worker sekaligus |
| `bun run dev:all` | API + web + semua worker |
| `bun run infra:up` / `infra:down` / `infra:logs` | Docker Compose |
| `bun run test` | unit test API (parser Boolean, LLM helper) |
| `bun run test:worker` | unit test NLP worker (Python `unittest`) |

---

## 11. Konfigurasi

| Variabel | Default | Fungsi |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/media_intel` | PostgreSQL + pgvector |
| `REDIS_URL` | `redis://localhost:6379` | Streams bus & pub/sub |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `ima-isa-2026` | kredensial login dashboard (**ganti sebelum publik**) |
| `AUTH_REQUIRED` | `true` | `false` = matikan gerbang login (hanya lokal) |
| `API_KEY` / `VITE_API_KEY` | kosong | shared secret untuk otomasi (`x-api-key`) |
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
| `X_TRENDS_MODE` | `auto` | `auto` (API→login→guest) \| `api` \| `login` \| `guest` |
| `X_AUTH_TOKEN` / `X_CT0` | kosong | cookie login x.com untuk tren berbobot volume |
| `GOOGLE_TRENDS_GEO` / `GOOGLE_TRENDS_REGION` | `ID` / `Indonesia` | wilayah Google Trends |
| `GOOGLE_TRENDS_SOURCE` | `page` | `page` (scrape `/trending`, 140 tren) \| `rss` (10 tren) |
| `GOOGLE_TRENDS_WINDOWS` | `24` | jendela scrape, mis. `4,24,168` (tiap jendela ±154 KB gzip) |
| `TRENDS_ADAPTIVE` | `true` | scrape hanya saat dashboard dibuka (penanda Redis) |
| `TRENDS_IDLE_INTERVAL_SECONDS` | `3600` | saat sepi, tetap segarkan tiap N detik |
| `TRENDS_INTERVAL_GOOGLE` / `_TIKTOK` / `_X` | `300` / `300` / `600` | jeda snapshot per platform |
| `TIKTOK_SESSION_COOKIE` | kosong | cookie Creative Center (volume tayangan) |
| `TRENDS_GOOGLE_LIMIT` | `200` | maksimum tren Google yang disimpan |
| `EXTRACT_FULLTEXT` / `FULLTEXT_LIMIT_PER_FEED` | `true` / `5` | pengambilan badan artikel saat ingest |
| `CLUSTER_WINDOW_HOURS` | `24` | jendela waktu kandidat klaster |
| `CLUSTER_DISTANCE_THRESHOLD` | `0` (auto) | cosine distance maksimum — 0.25 IndoBERT, 0.62 leksikal |
| `CLUSTER_MIN_ITEMS` | `5` | minimum artikel per klaster |
| `USE_TRANSFORMERS` / `USE_SPACY` | `false` di `.env.example` | mode ringan; set `true` untuk memakai IndoBERT/spaCy asli |
| `CLIP_WORK_DIR` | `storage/clipping` | direktori video sumber, klip render, dan varian mutasi |
| `CLIP_FILLER_DIR` | `clipping/assets/filler_library` | stok filler 9:16 untuk mode split-screen |
| `CLIP_MIN_SECONDS` / `CLIP_MAX_SECONDS` | `30` / `75` | rentang durasi klip untuk prompt LLM |
| `CLIP_MAX_PER_SOURCE` | `8` | jumlah klip maksimum per sumber |
| `CLIP_WHISPER_MODEL` | `small` | `tiny`/`base`/`small`/`medium`/`large-v3` |
| `CLIP_WHISPER_DEVICE` / `_COMPUTE` | `auto` / `int8` | akselerasi transkripsi |
| `CLIP_YTDLP_MAX_HEIGHT` | `1080` | batas resolusi unduhan |
| `CLIP_TRACKER_INTERVAL_SECONDS` | `10800` | cron tracker metrik (3 jam) |
| `CLIP_SHADOWBAN_VIEWS` / `_HOURS` | `10` / `6` | kriteria deteksi shadowban |
| `CLIP_DRY_RUN` | `false` | `true` = alur penuh tanpa ffmpeg/ADB/yt-dlp (placeholder + transkrip sintetis) |
| `CLIP_HW_ENCODE` | `auto` | `auto`=VideoToolbox/NVENC bila ada; `videotoolbox`, `nvenc`, atau `none` (paksa libx264) |
| `CLIP_FFMPEG_THREADS` | `4` | Batas thread FFmpeg agar RAM stabil saat render paralel |
| `CLIP_BOOST_MAX_SESSIONS` | `50` | batas sesi boost per permintaan |

---

## 12. Catatan operasional

- **Worker restart-safe**: pesan gagal dipindah ke `media:dead` lalu di-`XACK`, sehingga
  antrean tidak pernah macet. Worker kliping memakai pola yang sama dengan dead-letter
  stream `clip:dead`, dan setiap stream punya konsumen thread sendiri agar ingest
  tidak memblokir render/distribusi.
- **Caption FFmpeg**: build FFmpeg tanpa `libass` tidak punya filter `subtitles`.
  Worker mendeteksinya (`ffmpeg -filters`), lalu merender caption per kata dengan
  Pillow dan membakarnya via `overlay`. Bila Pillow juga tidak ada, berkas `.ass`
  tetap ditulis sebagai sidecar.
- **Klip melewati durasi sumber** ditolak sebelum FFmpeg dipanggil (validasi
  `ffprobe`), karena `trim=start=` di luar rentang membuat proses menggantung.
- **Redis opsional**: bila Redis mati, API tetap melayani REST (SSE live nonaktif dan
  statusnya tampil di sidebar/settings).
- **Seed idempoten**: eksternal ID demo bersifat deterministik; aman diulang.
- **Rentang waktu** dibatasi maksimum 90 hari per query untuk menjaga latensi agregasi.
- **Zona waktu**: bucket tren dan heatmap dihitung pada WIB (UTC+7).
- **Ganti kredensial DB tidak otomatis berlaku.** `POSTGRES_*` hanya dipakai saat volume
  Docker dibuat; role/password yang sudah ada tidak berubah. Untuk PostgreSQL host,
  buat role-nya dulu (`CREATE ROLE ... LOGIN PASSWORD ...` + grant ke database), ubah
  `DATABASE_URL`, lalu **restart proses API** — Bun memuat `.env` sekali saat start.
- **Badan artikel bersih**: `scrapers/extractor.py` membuang blok `<script>`/`<style>`
  **sebelum** tag lain di-strip, lalu menolak hasil ekstraksi yang masih berbau kode
  (JS/CSS). Bila Trafilatura gagal, fallback memilih kontainer dengan teks `<p>`
  terbanyak. Judul yang diulang, metadata redaksi (pola BBC/Detik), `ADVERTISEMENT`,
  link "Baca juga", promo, dan nama situs di ekor dibuang oleh
  `scrapers/body_cleaner.py` — dipakai saat ingest maupun saat perapian data lama.
- **Perapian data lama**: `bun run worker:clean` (dry-run) lalu
  `bun run worker:clean:apply`. Skrip `services/worker-ai/clean_bodies.py`
  mengklasifikasi setiap baris (`ok`/`noisy`/`thin`/`junk`/`empty`), mengambil ulang
  artikel yang bermasalah (URL mirror Google News didekode dulu lewat
  `scrapers/google_news.py`), menormalkan teks, dan dengan `--refresh-nlp`
  menghitung ulang sentimen/entitas/embedding. Berguna untuk audit:
  `--state thin,junk --limit 100 --report out.json --rewrite-url`. Unduhan dibatasi
  per domain (`--domain-interval`, `--per-domain`) dan domain yang membalas 202/403
  (Cloudflare/challenge) dilewati serta dilaporkan sebagai `unresolved`.

---

## 13. Smoke test

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
