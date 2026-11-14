```markdown
# Master Blueprint: Automated AI Content Clipping, Distribution & Viral Trigger System (`ima-isa`)

## 1. System Overview & Architecture
Modul ini dirancang untuk terintegrasi langsung ke dalam ekosistem **IMA-ISA** menggunakan arsitektur *event-driven* yang memisahkan *API orchestration* (Bun + Elysia + Drizzle) dengan *heavy media & AI processing* (Python Worker + Redis/RabbitMQ).

### High-Level Data Flow
```text
[Vite + React Dashboard]
       │ (1) Submit URL + Render Config (Split-screen / Reframe)
       ▼
[Bun + Elysia API] ──► [PostgreSQL (Drizzle ORM)]
       │ (2) Publish Job (`clip.ingest`)
       ▼
[Redis / RabbitMQ Broker]
       │
       ├──► [Worker 1: Media Ingestor] ──► yt-dlp + Heatmap + faster-whisper
       │
       ├──► [Worker 2: AI Curator]     ──► Librosa RMS + LLM Virality Scoring
       │
       ├──► [Worker 3: Video Renderer] ──► FFmpeg (vstack / face-crop + ASS Captions + Hash Mutator)
       │
       └──► [Worker 4: Distributor & Tracker]
                  ├──► Dispatch to Device Farm (ADB / uiautomator2 / M2 Orchestrator)
                  ├──► Viral Trigger Engine (Human-like Retention & Search Simulation)
                  └──► Periodic Analytics Scraper (Playwright / ADB Metrics -> DB)

```

---

## 2. Monorepo Directory Structure

Penambahan struktur file pada repositori `ima-isa`:

```text
ima-isa/
├── apps/
│   ├── api/                                # Bun + Elysia Backend
│   │   └── src/
│   │       ├── db/
│   │       │   └── schema/
│   │       │       └── clipping.ts         # Drizzle PostgreSQL Schema
│   │       └── modules/
│   │           └── clipping/
│   │               ├── index.ts            # Elysia Controller & Routes
│   │               ├── service.ts          # Business Logic & Queue Publisher
│   │               └── dto.ts              # TypeBox Validation Schemas
│   └── web/                                # Vite + React + shadcn/ui
│       └── src/
│           └── features/
│               └── clipping/
│                   ├── components/
│                   │   ├── UrlIngestForm.tsx
│                   │   ├── ClipPreviewCard.tsx
│                   │   ├── DistributionMatrix.tsx
│                   │   └── ViralTriggerPanel.tsx
│                   └── pages/
│                       └── ClippingStudioPage.tsx
└── workers/
    └── python-worker/                      # Python Heavy-Lifting Service
        ├── assets/
        │   └── filler_library/             # Stok video gameplay/satisfying (9:16 / 1:1)
        └── src/
            └── clipping/
                ├── __init__.py
                ├── consumer.py             # Queue Consumer Entrypoint
                ├── ingestor.py             # yt-dlp + YouTube Heatmap + WhisperX
                ├── curator.py              # Librosa Acoustic Peak + LLM JSON Scorer
                ├── renderer.py             # FFmpeg vstack, Auto-Caption & Hash Mutator
                ├── distributor.py          # Bridge ke ADB / M2 Device Farm
                ├── viral_trigger.py        # Human-like Booster (Retention & Search Flow)
                └── tracker.py              # Scraper Views, Likes, Saves & Payout Calc

```

---

## 3. Database Schema (Drizzle ORM / PostgreSQL)

File: `apps/api/src/db/schema/clipping.ts`

```typescript
import {
  pgTable,
  serial,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const sourceStatusEnum = pgEnum('clip_source_status', [
  'pending',
  'downloading',
  'transcribing',
  'analyzing',
  'rendering',
  'completed',
  'failed',
]);

export const renderModeEnum = pgEnum('clip_render_mode', [
  'split_screen',   // 50:50 Atas (Video Utama) + Bawah (Filler Gameplay)
  'face_reframe',   // 9:16 Full Screen dengan MediaPipe Face Tracking
  'blur_background' // Original 16:9 di tengah dengan Gaussian Blur background
]);

export const distributionStatusEnum = pgEnum('clip_dist_status', [
  'queued',
  'uploading',
  'published',
  'boosting',
  'shadowbanned',
  'failed',
]);

// 1. Tabel Sumber Video Mentah (YouTube, TikTok, X, IG)
export const clipSources = pgTable('clip_sources', {
  id: serial('id').primaryKey(),
  url: text('url').notNull(),
  platform: text('platform').notNull(), // 'youtube' | 'tiktok' | 'instagram'
  title: text('title'),
  durationSeconds: integer('duration_seconds'),
  rawFilePath: text('raw_file_path'),
  transcriptJson: jsonb('transcript_json'), // Word-level timestamps dari Whisper
  heatmapJson: jsonb('heatmap_json'),       // Most Replayed graph data (jika ada)
  status: sourceStatusEnum('status').default('pending').notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 2. Tabel Hasil Potongan Klip AI
export const generatedClips = pgTable('generated_clips', {
  id: serial('id').primaryKey(),
  sourceId: integer('source_id')
    .references(() => clipSources.id, { onDelete: 'cascade' })
    .notNull(),
  titleHook: text('title_hook').notNull(),
  startTime: real('start_time').notNull(), // dalam detik (e.g., 142.5)
  endTime: real('end_time').notNull(),     // dalam detik (e.g., 198.0)
  viralityScore: integer('virality_score').notNull(), // 1 - 100
  aiReasoning: text('ai_reasoning'),
  renderMode: renderModeEnum('render_mode').default('split_screen').notNull(),
  fillerAssetUsed: text('filler_asset_used'),
  outputFilePath: text('output_file_path'),
  fileHash: text('file_hash'), // SHA-256 setelah mutasi anti-duplikat
  isApproved: boolean('is_approved').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 3. Tabel Distribusi Multi-Akun, Analytics & Monetisasi
export const clipDistributions = pgTable('clip_distributions', {
  id: serial('id').primaryKey(),
  clipId: integer('clip_id')
    .references(() => generatedClips.id, { onDelete: 'cascade' })
    .notNull(),
  targetPlatform: text('target_platform').notNull(), // 'tiktok' | 'reels' | 'shorts'
  accountUsername: text('account_username').notNull(),
  deviceSerial: text('device_serial'), // ADB Device ID (terhubung ke farm M2)
  mutatedFilePath: text('mutated_file_path'), // File unik khusus akun ini
  postUrl: text('post_url'),
  status: distributionStatusEnum('status').default('queued').notNull(),
  
  // Analytics Metrics (Updated berkala oleh Tracker Worker)
  viewsCount: integer('views_count').default(0).notNull(),
  likesCount: integer('likes_count').default(0).notNull(),
  commentsCount: integer('comments_count').default(0).notNull(),
  sharesCount: integer('shares_count').default(0).notNull(),
  savesCount: integer('saves_count').default(0).notNull(),
  
  // Viral Trigger & Monetization Tracking
  triggerCountApplied: integer('trigger_count_applied').default(0).notNull(),
  cpmRateIdr: integer('cpm_rate_idr').default(0).notNull(), // Rate per 1.000 views
  estimatedRevenueIdr: integer('estimated_revenue_idr').default(0).notNull(),
  
  publishedAt: timestamp('published_at'),
  lastScrapedAt: timestamp('last_scraped_at'),
});

```

---

## 4. Technical Pipeline Specification (Python Worker)

### Fase A: Ingestion & Multi-Modal Viral Detection (`ingestor.py` & `curator.py`)

AI menentukan momen terbaik melalui kombinasi **3 sinyal objektif**:

1. **YouTube Heatmap Extraction:** Menggunakan `yt-dlp --dump-json` untuk mengambil array `heatmap` (bagian yang paling sering di-*replay* penonton asli).
2. **Acoustic Peak Detection (`librosa`):** Menghitung nilai *Root Mean Square* (RMS) energy per 2 detik untuk mendeteksi lonjakan emosi (tawa, perdebatan, nada tinggi, atau jeda dramatis).
3. **LLM Semantic & Hook Scoring:** Menggabungkan transkrip *word-level* (`faster-whisper`) + penanda puncak audio ke LLM dengan *Structured JSON Output*:
* **Kriteria Wajib:** Kalimat pembuka < 3 detik harus berupa pertanyaan, pernyataan kontroversial, atau *pattern interrupt*.
* **Completeness:** Potongan wajib ditutup dengan kalimat selesai/kesimpulan (durasi ideal: 30–75 detik).



### Fase B: Video Rendering & Anti-Duplicate Hash Mutation (`renderer.py`)

1. **Split-Screen Mode (`ffmpeg vstack`):**
* Video utama di-scale ke `1080x960` (bagian atas).
* Mengambil potongan acak dengan durasi identik dari `assets/filler_library/` (video *gameplay/satisfying* tanpa audio), di-scale/crop ke `1080x960` (bagian bawah).
* Digabung vertikal menjadi `1080x1920` dengan *burned-in dynamic subtitles* (`.ass` format, *word-by-word highlight*) tepat di garis tengah (`Y = 960`).


2. **Per-Account Hash Mutation (Anti-Shadowban):**
* Setiap kali 1 klip dijadwalkan ke $N$ akun berbeda, worker menghasilkan $N$ varian file dengan parameter acak mikro:
* *Speed multiplier*: `1.005x` hingga `1.015x`
* *Color eq*: `brightness=0.01`, `contrast=1.02`
* *Micro-crop*: `1-2%` dari tepi frame
* *Metadata strip*: `-map_metadata -1` + re-encode CRF acak (`21`–`23`).





### Fase C: Human-Like Viral Trigger Engine (`viral_trigger.py`)

Untuk mendorong video melewati *batch testing* awal (200–500 views) tanpa terdeteksi sebagai *bot farm*:

1. **No Closed-Loop Mass Following:** Hindari saling *follow* antar akun internal secara serentak.
2. **Traffic Source Simulation (Search-to-Watch):**
* Worker menginstruksikan perangkat di ADB farm untuk membuka TikTok/Reels -> *scroll* FYP 2–3 video -> buka tab **Search** -> ketik *username* atau *keyword* spesifik -> buka video dari hasil pencarian.


3. **Retention & Loop Weighting:**
* Akun *booster* diprogram menonton **150% – 220% durasi video** (1x penuh + *loop*), menekan **Save/Bookmark** (probabilitas 60%), **Copy Link** (probabilitas 40%), dan **Like** di akhir video (probabilitas 80%).


4. **Drip-Feed Jitter & Network Isolation:**
* Jeda antar interaksi diacak menggunakan distribusi normal (misal 1 interaksi setiap 3–12 menit dalam 2 jam pertama).
* Wajib menggunakan rotasi IP seluler (4G/5G *airplane mode toggle* via ADB) antar sesi akun.



### Fase D: Analytics Tracker & Monetization Calculator (`tracker.py`)

* *Cronjob* berjalan setiap **3 jam** untuk menarik metrik terbaru dari setiap `post_url` di tabel `clip_distributions`.
* Menghitung pendapatan otomatis berdasarkan skema B2B/CPM Campaign:

$$\text{Estimated Revenue} = \left\lfloor \frac{\text{Views Count}}{1000} \right\rfloor \times \text{CPM Rate}$$


* Mendeteksi anomali *shadowban* secara otomatis (jika `views_count < 10` setelah 6 jam *published*, status otomatis berubah menjadi `shadowbanned` untuk evaluasi akun/proxy).

---

## 5. API Endpoints Specification (Bun + Elysia)

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/v1/clipping/sources` | Submit URL video sumber, memicu job `clip.ingest` ke Python Worker. |
| `GET` | `/api/v1/clipping/sources/:id` | Mendapatkan status proses, transkrip, dan daftar `generated_clips`. |
| `POST` | `/api/v1/clipping/clips/:id/render` | Memilih mode render (`split_screen` / `face_reframe`) & merender klip. |
| `POST` | `/api/v1/clipping/clips/:id/distribute` | Menjadwalkan distribusi ke daftar akun target + konfigurasi *viral trigger*. |
| `POST` | `/api/v1/clipping/distributions/:id/boost` | Memicu *manual drip-feed boost* pada postingan tertentu yang mulai naik. |
| `GET` | `/api/v1/clipping/analytics/summary` | Agregasi total *views*, rata-rata retensi, dan estimasi *payout* CPM. |

---

## 6. Implementation Roadmap (Phased Rollout)


### Sprint 1: Core Clipping & Split-Screen Engine

* [ ] Migrasi skema Drizzle (`clipping.ts`) ke PostgreSQL `ima-isa`.
* [ ] Setup `ingestor.py` (`yt-dlp` + `faster-whisper`) dan `curator.py` (LLM JSON scoring).
* [ ] Implementasi `renderer.py` dengan dukungan *Split-Screen* (`vstack`) + *auto-caption* `.ass` + *Hash Mutator*.
* [ ] Pembuatan UI dasar di Vite/React untuk input link dan preview hasil potongan klip.

### Sprint 2: Multi-Account Distribution & ADB Bridge

* [ ] Integrasi worker `distributor.py` dengan orkestrator ADB / `uiautomator2` untuk auto-upload ke TikTok & Instagram Reels.
* [ ] Implementasi rotasi IP seluler otomatis sebelum sesi upload/interaksi.

### Sprint 3: Viral Trigger & Analytics Payout Dashboard

* [ ] Implementasi skrip `viral_trigger.py` dengan alur *Search-to-Watch* dan *180% Watch-Time Loop*.
* [ ] Pembuatan `tracker.py` untuk scraping metrik *views/saves* berkala.
* [ ] Penambahan halaman *Analytics & Monetization Ledger* di dashboard frontend untuk memantau performa tiap klip dan kalkulasi CPM.

```

```