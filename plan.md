Berikut adalah berkas cetak biru lengkap **`plan.md`** siap pakai untuk monorepo proyek **Indonesia Intelligence Media & Social Media Analysis Engine**:

```markdown
# Blueprint & Execution Plan: Indonesia Media & Social Intelligence Engine

Platform analisis intelijen media dan jejaring sosial terpadu untuk memantau dinamika isu nasional, pergerakan sentimen publik, ekstraksi entitas tokoh/organisasi, dan deteksi dini krisis (*spike detection*) di Indonesia secara *real-time*.

---

## 1. Arsitektur Sistem & Tech Stack

Platform mengadopsi pola arsitektur **Hybrid Event-Driven Monorepo** memanfaatkan native Bun Workspaces:


```

[ 10 Media Terpilih (RSS/Web) + Media Sosial ]
│
▼
[ Ingestion Engine (Python) ]  (RSS Poller + Trafilatura)
│ (Raw JSON payloads)
▼
[ Redis Streams / Queue ]
│
▼
[ AI & NLP Worker (Python) ]   (IndoBERT, Spacy NER, Ollama/LLM, pgvector)
│ (Enriched text, Sentiment, Entities, Embeddings)
▼
[ PostgreSQL 16 + pgvector ]
▲
│ (Drizzle ORM)
[ Core Backend (Bun + Elysia.js) ]
• REST API Gateway & Authentication
• SSE (Server-Sent Events) Gateway
• Anomaly & Crisis Alert Dispatcher
▲
│ (Elysia Eden Treaty - End-to-End Type Safety)
▼
[ Dashboard (Vite + React + shadcn/ui) ]
• Real-time Stream Feed
• Sentiment Trends & Share of Voice
• Topic Clustering & AI Executive Briefing

```

### Rincian Teknologi
* **Monorepo Engine:** Bun Workspaces.
* **Frontend Web:** Vite, React 19, TypeScript, Tailwind CSS, shadcn/ui, Recharts, Lucide React, TanStack Query.
* **Core API Gateway:** Bun runtime, Elysia.js, Elysia Eden Treaty, TypeBox.
* **Database & ORM:** PostgreSQL 16 (ekstensi `pgvector`), Drizzle ORM, Drizzle Kit.
* **Message Broker & In-Memory Store:** Redis 7 (Streams / PubSub).
* **Ingestion & AI Processing:** Python 3.11, Trafilatura (Clean web text extraction), Hugging Face Transformers (`indobenchmark/indobert-base-p1`), Spacy Bahasa Indonesia, Ollama / Local LLM (Executive summarization).
* **Containerization:** Docker Compose (PostgreSQL, Redis, Ollama).

---

## 2. Struktur Direktori Monorepo

```text
media-intel-platform/
├── apps/
│   ├── web/                              # Frontend Dashboard (Vite + React + shadcn/ui)
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── assets/
│   │   │   ├── components/
│   │   │   │   ├── ui/                   # shadcn/ui atomics (button, card, dialog, table, badge)
│   │   │   │   ├── charts/               # Recharts wrappers (SentimentTrend, ShareOfVoice, KeywordHeatmap)
│   │   │   │   ├── feeds/                # StreamList, ArticleCard, RealtimeIndicator
│   │   │   │   ├── layout/               # AppSidebar, Header, DashboardShell
│   │   │   │   └── shared/               # DateRangePicker, BooleanQueryInput, StatusBadge
│   │   │   ├── hooks/                    # useSSE, useAnalytics, useDebounce
│   │   │   ├── lib/
│   │   │   │   ├── api.ts                # Elysia Eden Treaty Client instance
│   │   │   │   └── utils.ts              # cn() utility helper
│   │   │   ├── pages/                    # Overview, MediaMonitoring, TopicClusters, CrisisAlerts, Settings
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── tailwind.config.js
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   │
│   └── api/                              # Core API Gateway (Bun + Elysia.js)
│       ├── src/
│       │   ├── db/
│       │   │   ├── index.ts              # Drizzle client instance
│       │   │   └── schema.ts             # Drizzle tables, enums, & relations
│       │   ├── modules/
│       │   │   ├── analytics/            # Endpoint agregasi tren, volume, sentimen
│       │   │   │   ├── controller.ts
│       │   │   │   └── service.ts
│       │   │   ├── feeds/                # Feed retrieval & SSE live stream
│       │   │   │   ├── controller.ts
│       │   │   │   └── service.ts
│       │   │   ├── clusters/             # Topic clustering & AI summary calls
│       │   │   ├── alerts/               # Deteksi spike & trigger webhook/Telegram
│       │   │   └── keywords/             # Manajemen kata kunci pantauan & Boolean parser
│       │   └── index.ts                  # Entry point Elysia & export App type untuk Eden Treaty
│       ├── package.json
│       └── tsconfig.json
│
├── services/
│   └── worker-ai/                        # Ingestion & AI Processing Service (Python 3.11)
│       ├── config.py                     # Environment variables & DB connection string
│       ├── scrapers/
│       │   ├── rss_poller.py             # Poller terjadwal untuk 10 portal berita Indonesia
│       │   ├── extractor.py              # Ekstraktor teks bersih via Trafilatura
│       │   └── social_poller.py          # Adapter crawler/API medsos (X/Twitter, YouTube)
│       ├── nlp/
│       │   ├── sentiment.py              # Pipeline klasifikasi IndoBERT (Pos/Neu/Neg)
│       │   ├── ner.py                    # Ekstraksi entitas (Person, Org, Location)
│       │   ├── embedder.py               # Pembuat embedding vektor kalimat (768 dimensi)
│       │   └── summarizer.py             # Integrasi LLM untuk executive briefing
│       ├── main.py                       # Redis Stream consumer daemon
│       ├── requirements.txt
│       └── Dockerfile
│
├── packages/
│   └── types/                            # Kontrak tipe data global TypeScript
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── docker-compose.yml                    # Postgres 16 (pgvector) & Redis 7
├── package.json                          # Root package.json (Bun workspaces configuration)
├── tsconfig.base.json
└── README.md

```

---

## 3. Skema Database (Drizzle ORM & PostgreSQL)

File skema diletakkan di `apps/api/src/db/schema.ts`:

```typescript
import { 
  pgTable, 
  uuid, 
  text, 
  timestamp, 
  varchar, 
  jsonb, 
  real, 
  pgEnum, 
  index, 
  uniqueIndex, 
  vector 
} from 'drizzle-orm/pg-core'

export const sourcePlatformEnum = pgEnum('source_platform', [
  'NEWS_MEDIA',
  'TWITTER_X',
  'YOUTUBE',
  'TIKTOK'
])

export const sentimentEnum = pgEnum('sentiment_label', [
  'POSITIVE',
  'NEUTRAL',
  'NEGATIVE'
])

export const alertSeverityEnum = pgEnum('alert_severity', [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
])

// 1. Master Sumber Media
export const sources = pgTable('sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  domain: varchar('domain', { length: 150 }).notNull().unique(),
  platform: sourcePlatformEnum('platform').notNull().default('NEWS_MEDIA'),
  rssUrl: text('rss_url'),
  isActive: text('is_active').default('true').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
})

// 2. Konten Artikel & Postingan Hasil Pemrosesan AI
export const mediaItems = pgTable('media_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'cascade' }),
  platform: sourcePlatformEnum('platform').notNull(),
  externalId: varchar('external_id', { length: 255 }).notNull(), // Hash unik / ID medsos
  url: text('url').notNull(),
  author: varchar('author', { length: 255 }),
  title: text('title').notNull(),
  rawContent: text('raw_content').notNull(),
  cleanContent: text('clean_content').notNull(),
  
  // Metrik AI
  sentiment: sentimentEnum('sentiment').notNull(),
  sentimentScore: real('sentiment_score').notNull(), // 0.00 - 1.00
  entities: jsonb('entities').$type<{
    persons: string[]
    organizations: string[]
    locations: string[]
  }>().default({ persons: [], organizations: [], locations: [] }),
  
  embedding: vector('embedding', { dimensions: 768 }),
  
  publishedAt: timestamp('published_at').notNull(),
  processedAt: timestamp('processed_at').defaultNow().notNull()
}, (table) => ({
  externalIdIdx: uniqueIndex('idx_media_external_id').on(table.externalId),
  publishedAtIdx: index('idx_media_published_at').on(table.publishedAt),
  sentimentIdx: index('idx_media_sentiment').on(table.sentiment)
}))

// 3. Klaster Isu / Topik
export const topicClusters = pgTable('topic_clusters', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  summary: text('summary'),
  dominantSentiment: sentimentEnum('dominant_sentiment'),
  totalArticles: real('total_articles').default(0),
  firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
  lastUpdated: timestamp('last_updated').defaultNow().notNull()
})

export const clusterItems = pgTable('cluster_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  clusterId: uuid('cluster_id').references(() => topicClusters.id, { onDelete: 'cascade' }),
  mediaItemId: uuid('media_item_id').references(() => mediaItems.id, { onDelete: 'cascade' })
}, (table) => ({
  clusterMediaIdx: uniqueIndex('idx_cluster_media').on(table.clusterId, table.mediaItemId)
}))

// 4. Kata Kunci Pantauan & Boolean Rules
export const monitoredKeywords = pgTable('monitored_keywords', {
  id: uuid('id').defaultRandom().primaryKey(),
  label: varchar('label', { length: 100 }).notNull(),
  booleanQuery: text('boolean_query').notNull(),
  isActive: text('is_active').default('true').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
})

// 5. Peringatan Krisis & Lonjakan Isu
export const alerts = pgTable('alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  keywordId: uuid('keyword_id').references(() => monitoredKeywords.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description').notNull(),
  severity: alertSeverityEnum('severity').notNull().default('MEDIUM'),
  metricsSnapshot: jsonb('metrics_snapshot').$type<{
    volumeIncreasePct: number
    negativeRatio: number
    sampleHeadlines: string[]
  }>(),
  isResolved: text('is_resolved').default('false').notNull(),
  triggeredAt: timestamp('triggered_at').defaultNow().notNull()
})

```

---

## 4. Matriks Sumber Media Online Indonesia

Fokus ingestion pada **10 portal utama** berbobot tinggi untuk menjaga akurasi dan efisiensi server:

| No | Portal Media | Kategori / Karakteristik | Metode Ingestion Utama |
| --- | --- | --- | --- |
| 1 | **Kompas.com** | Otoritatif, bahasa baku formal, agenda setter nasional | RSS Feed + Trafilatura scraper |
| 2 | **Tempo.co** | Kritis, kebijakan publik, investigasi awal | RSS Feed + Trafilatura scraper |
| 3 | **CNN Indonesia** | Berita nasional cepat, geopolitik, independen | RSS Feed + Trafilatura scraper |
| 4 | **Detik.com** | Volume tinggi, *breaking news*, deteksi *spike* | RSS Feed + Trafilatura scraper |
| 5 | **Tribunnews.com** | Jaringan regional/daerah terluas di Indonesia | RSS Feed Kanal Nasional/Utama |
| 6 | **Kumparan.com** | Gaya penulisan modern, pembaca usia produktif | API publik / Webhook extractor |
| 7 | **Tirto.id** | *Explanatory journalism*, data-driven, periksa fakta | RSS Feed + Trafilatura scraper |
| 8 | **BBC News Indonesia** | Presisi tinggi, netral, analisis mendalam | RSS Feed Resmi |
| 9 | **Bisnis.com** | Regulasi industri, korporasi, makroekonomi | RSS Feed Bisnis / Industri |
| 10 | **CNBC Indonesia** | Pasar modal, perbankan, energi, dan fiskal | RSS Feed Pasar & Finansial |

---

## 5. Fitur & Acceptance Criteria (Gherkin Format)

### Modul 1: Ingestion & Text Normalization

* **Fitur 1.1: Deduplikasi Konten Lintas Platform**
* **Given** artikel baru masuk dari RSS poller.
* **When** nilai hash gabungan `SHA256(domain + clean_title)` sudah ada pada kolom `external_id` di tabel `media_items`.
* **Then** worker harus mengabaikan payload tersebut tanpa membuat row baru dan tanpa meneruskannya ke antrean AI.


* **Fitur 1.2: Normalisasi Bahasa Gaul & Slang Indonesia**
* **Given** teks postingan media sosial berisi singkatan atau slang lokal (*misal: "bgt", "baper", "dgn", "bumn zonk"*).
* **When** fungsi normalisasi teks dijalankan sebelum inferensi NLP.
* **Then** kata-kata slang dipetakan ke leksikon formal tanpa merusak struktur sintaksis kalimat.



### Modul 2: AI Enrichment (Sentiment, NER, & Semantic Clustering)

* **Fitur 2.1: Klasifikasi Sentimen 3-Kelas**
* **Given** artikel berita atau postingan teks bahasa Indonesia yang sudah dibersihkan.
* **When** model IndoBERT memproses teks.
* **Then** sistem menyimpan status sentimen `POSITIVE`, `NEUTRAL`, atau `NEGATIVE` dengan *confidence score* bernilai antara `0.00` sampai `1.00`.


* **Fitur 2.2: Semantic Topic Clustering**
* **Given** minimal 5 artikel dari portal berbeda terbit dalam jendela waktu 4 jam.
* **When** kalkulasi *cosine distance* antar-vektor embedding pada `pgvector` bernilai $< 0.25$.
* **Then** artikel-artikel tersebut dikelompokkan ke dalam satu entri `topic_clusters` yang sama.



### Modul 3: Live Dashboard & Interaksi Pengguna (Vite + shadcn/ui)

* **Fitur 3.1: Server-Sent Events (SSE) Live Feed**
* **Given** dashboard pemantauan aktif pada browser analis.
* **When** artikel baru berhasil disimpan ke database oleh worker AI.
* **Then** item berita baru disisipkan secara mulus ke posisi teratas tabel feed tanpa me-refresh halaman atau mereset posisi scroll layar pengguna.


* **Fitur 3.2: Visualisasi Share of Voice & Filtering Cepat**
* **Given** analis memilih rentang waktu tertentu atau mengubah filter kata kunci.
* **When** query filter dieksekusi.
* **Then** chart *Share of Voice* dan *Sentiment Breakdown* ter-render ulang dalam waktu $< 600\text{ ms}$.



### Modul 4: Krisis & Spike Alert Engine

* **Fitur 4.1: Deteksi Anomali Lonjakan Isu**
* **Given** baseline volume sebutan suatu isu adalah $N$ artikel/postingan per jam.
* **When** volume pembicaraan melonjak $> 2.5 \times N$ dalam 30 menit ATAU sentimen negatif menembus $> 65\%$.
* **Then** sistem otomatis membuat entri baru pada tabel `alerts` dengan tingkat keparahan `HIGH` atau `CRITICAL`.


* **Fitur 4.2: Notifikasi Instan ke Telegram/Webhook**
* **Given** entri `alerts` bertingkat `HIGH` atau `CRITICAL` terbentuk.
* **When** trigger notifikasi aktif.
* **Then** ringkasan peringatan (isu pemicu, persentase lonjakan, dan tautan langsung) terkirim ke Telegram/Slack dalam waktu $< 10\text{ detik}$.



### Modul 5: AI Executive Briefing (Ollama / Local LLM)

* **Fitur 5.1: Pembuatan Ringkasan Klaster Otomatis**
* **Given** analis membuka detail salah satu `topic_clusters` yang memiliki $\ge 5$ artikel.
* **When** tombol "Generate Summary" ditekan.
* **Then** LLM mengembalikan ringkasan terstruktur (latar belakang, eskalasi, respon pihak terkait, dan sitasi portal rujukan) dalam waktu $< 5\text{ detik}$.



---

## 6. Rencana Eksekusi & Tahapan Sprint (Roadmap)

### Sprint 1: Setup Workspace & Data Pipeline Fondasi (Minggu 1-2)

1. Inisialisasi monorepo Bun Workspaces (`apps/web`, `apps/api`, `services/worker-ai`, `packages/types`).
2. Konfigurasi `docker-compose.yml` untuk PostgreSQL 16 (ekstensi `pgvector`) dan Redis 7.
3. Setup Drizzle ORM dan migrasi skema tabel dasar di `apps/api`.
4. Bangun RSS Poller (Python) untuk 10 media berita Indonesia pilihan dan hubungkan ke antrean Redis Streams.

### Sprint 2: AI Pipeline & Core Backend API (Minggu 3-4)

1. Integrasi model klasifikasi IndoBERT dan Spacy NER pada `services/worker-ai`.
2. Implementasi pembuatan embedding vektor dan penyimpanan ke PostgreSQL via Drizzle.
3. Bangun routing API di Elysia.js (`/analytics`, `/feeds`, `/keywords`, `/alerts`).
4. Implementasi endpoint Server-Sent Events (SSE) di Elysia untuk streaming artikel *real-time*.

### Sprint 3: Frontend Dashboard & Real-Time Monitoring (Minggu 5-6)

1. Inisialisasi proyek Vite + React + Tailwind CSS di `apps/web`.
2. Instalasi komponen dasar shadcn/ui (`Button`, `Card`, `Table`, `Badge`, `Dialog`, `Select`).
3. Setup Eden Treaty client untuk koneksi type-safe penuh ke backend Elysia.
4. Implementasi komponen visualisasi chart Recharts (*Sentiment Trend*, *Share of Voice*, *Entity Graph*).
5. Pasang SSE hook untuk konsumsi live feed berita.

### Sprint 4: Topic Clustering, Executive Summary & Alerting (Minggu 7-8)

1. Bangun cron worker klasterisasi isu berbasis kemiripan vektor *pgvector*.
2. Integrasi model LLM (Ollama) untuk fitur ringkasan eksekutif klaster berita (*Executive Briefing*).
3. Bangun modul deteksi lonjakan anomali (*spike detection*) dan integrasi pengiriman alert ke Telegram Bot / Webhook.
4. Uji performa *end-to-end* beban scraping dan responsivitas dashboard.

```

```