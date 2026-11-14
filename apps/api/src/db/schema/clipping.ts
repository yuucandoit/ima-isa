import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import type { HeatmapPointDTO, TranscriptWordDTO } from '@media-intel/types'

/**
 * Skema modul clipping (lihat `clip.plan.md` §3).
 *
 * Berbeda dari tabel intelijen media yang memakai UUID, tabel kliping memakai
 * `serial` karena ID-nya juga dipakai sebagai nama file artefak render
 * (`clip_<id>.mp4`) dan lebih mudah dibaca di log worker Python.
 */

export const clipSourceStatusEnum = pgEnum('clip_source_status', [
  'pending',
  'downloading',
  'transcribing',
  'analyzing',
  'rendering',
  'completed',
  'failed',
])

export const clipRenderModeEnum = pgEnum('clip_render_mode', [
  'split_screen', // 50:50 atas (video utama) + bawah (filler gameplay)
  'face_reframe', // 9:16 penuh dengan face tracking
  'blur_background', // 16:9 di tengah + latar gaussian blur
])

export const clipDistributionStatusEnum = pgEnum('clip_dist_status', [
  'queued',
  'uploading',
  'published',
  'boosting',
  'shadowbanned',
  'failed',
])

/** 1. Sumber video mentah (YouTube, TikTok, Instagram, X). */
export const clipSources = pgTable(
  'clip_sources',
  {
    id: serial('id').primaryKey(),
    url: text('url').notNull(),
    platform: text('platform').notNull(), // 'youtube' | 'tiktok' | 'instagram'
    title: text('title'),
    durationSeconds: integer('duration_seconds'),
    rawFilePath: text('raw_file_path'),
    /** Word-level timestamps hasil faster-whisper. */
    transcriptJson: jsonb('transcript_json').$type<TranscriptWordDTO[]>(),
    /** Grafik "most replayed" YouTube (`yt-dlp --dump-json`). */
    heatmapJson: jsonb('heatmap_json').$type<HeatmapPointDTO[]>(),
    status: clipSourceStatusEnum('status').default('pending').notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_clip_sources_status').on(table.status),
    index('idx_clip_sources_created').on(table.createdAt),
  ],
)

/** 2. Hasil potongan klip AI + metadata render. */
export const generatedClips = pgTable(
  'generated_clips',
  {
    id: serial('id').primaryKey(),
    sourceId: integer('source_id')
      .references(() => clipSources.id, { onDelete: 'cascade' })
      .notNull(),
    titleHook: text('title_hook').notNull(),
    startTime: real('start_time').notNull(), // detik, mis. 142.5
    endTime: real('end_time').notNull(), // detik, mis. 198.0
    viralityScore: integer('virality_score').notNull(), // 1 - 100
    aiReasoning: text('ai_reasoning'),
    renderMode: clipRenderModeEnum('render_mode').default('split_screen').notNull(),
    fillerAssetUsed: text('filler_asset_used'),
    outputFilePath: text('output_file_path'),
    /** SHA-256 setelah mutasi anti-duplikat. */
    fileHash: text('file_hash'),
    isApproved: boolean('is_approved').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_generated_clips_source').on(table.sourceId),
    index('idx_generated_clips_score').on(table.viralityScore),
  ],
)

/** 3. Distribusi multi-akun, analytics & monetisasi. */
export const clipDistributions = pgTable(
  'clip_distributions',
  {
    id: serial('id').primaryKey(),
    clipId: integer('clip_id')
      .references(() => generatedClips.id, { onDelete: 'cascade' })
      .notNull(),
    targetPlatform: text('target_platform').notNull(), // 'tiktok' | 'reels' | 'shorts'
    accountUsername: text('account_username').notNull(),
    /** ADB device id (terhubung ke device farm). */
    deviceSerial: text('device_serial'),
    /** Varian file unik khusus akun ini. */
    mutatedFilePath: text('mutated_file_path'),
    postUrl: text('post_url'),
    status: clipDistributionStatusEnum('status').default('queued').notNull(),

    viewsCount: integer('views_count').default(0).notNull(),
    likesCount: integer('likes_count').default(0).notNull(),
    commentsCount: integer('comments_count').default(0).notNull(),
    sharesCount: integer('shares_count').default(0).notNull(),
    savesCount: integer('saves_count').default(0).notNull(),

    triggerCountApplied: integer('trigger_count_applied').default(0).notNull(),
    cpmRateIdr: integer('cpm_rate_idr').default(0).notNull(),
    estimatedRevenueIdr: integer('estimated_revenue_idr').default(0).notNull(),

    publishedAt: timestamp('published_at', { withTimezone: true }),
    lastScrapedAt: timestamp('last_scraped_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_clip_distributions_clip').on(table.clipId),
    index('idx_clip_distributions_status').on(table.status),
    index('idx_clip_distributions_account').on(table.accountUsername),
    index('idx_clip_distributions_published').on(table.publishedAt),
  ],
)

export const clipSourcesRelations = relations(clipSources, ({ many }) => ({
  clips: many(generatedClips),
}))

export const generatedClipsRelations = relations(generatedClips, ({ one, many }) => ({
  source: one(clipSources, {
    fields: [generatedClips.sourceId],
    references: [clipSources.id],
  }),
  distributions: many(clipDistributions),
}))

export const clipDistributionsRelations = relations(clipDistributions, ({ one }) => ({
  clip: one(generatedClips, {
    fields: [clipDistributions.clipId],
    references: [generatedClips.id],
  }),
}))

export type ClipSourceRow = typeof clipSources.$inferSelect
export type GeneratedClipRow = typeof generatedClips.$inferSelect
export type ClipDistributionRow = typeof clipDistributions.$inferSelect
