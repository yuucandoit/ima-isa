import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  jsonb,
  real,
  integer,
  pgEnum,
  index,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import type { NamedEntityBag } from '@media-intel/types'

export const sourcePlatformEnum = pgEnum('source_platform', [
  'NEWS_MEDIA',
  'TWITTER_X',
  'YOUTUBE',
  'TIKTOK',
  'GOOGLE_TRENDS',
])

export const sentimentEnum = pgEnum('sentiment_label', ['POSITIVE', 'NEUTRAL', 'NEGATIVE'])

export const alertSeverityEnum = pgEnum('alert_severity', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])

/** Master sumber media (10 portal berita + kanal sosial). */
export const sources = pgTable('sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  domain: varchar('domain', { length: 150 }).notNull().unique(),
  platform: sourcePlatformEnum('platform').notNull().default('NEWS_MEDIA'),
  rssUrl: text('rss_url'),
  isActive: text('is_active').default('true').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/** Konten artikel & postingan yang sudah diperkaya AI. */
export const mediaItems = pgTable(
  'media_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'cascade' }),
    platform: sourcePlatformEnum('platform').notNull(),
    /** SHA256(domain + clean_title) untuk deduplikasi lintas siklus polling. */
    externalId: varchar('external_id', { length: 255 }).notNull(),
    url: text('url').notNull(),
    author: varchar('author', { length: 255 }),
    title: text('title').notNull(),
    rawContent: text('raw_content').notNull(),
    cleanContent: text('clean_content').notNull(),

    sentiment: sentimentEnum('sentiment').notNull(),
    sentimentScore: real('sentiment_score').notNull(),
    entities: jsonb('entities')
      .$type<NamedEntityBag>()
      .default({ persons: [], organizations: [], locations: [] })
      .notNull(),

    embedding: vector('embedding', { dimensions: 768 }),

    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_media_external_id').on(table.externalId),
    index('idx_media_published_at').on(table.publishedAt),
    index('idx_media_sentiment').on(table.sentiment),
    index('idx_media_source').on(table.sourceId),
    index('idx_media_platform').on(table.platform),
    index('idx_media_embedding_hnsw').using('hnsw', table.embedding.op('vector_cosine_ops')),
  ],
)

/** Klaster isu/topik hasil semantic clustering. */
export const topicClusters = pgTable(
  'topic_clusters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title').notNull(),
    summary: text('summary'),
    dominantSentiment: sentimentEnum('dominant_sentiment'),
    totalArticles: real('total_articles').default(0).notNull(),
    /** Rata-rata embedding anggota klaster, dipakai untuk penugasan inkremental. */
    centroid: vector('centroid', { dimensions: 768 }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_clusters_last_updated').on(table.lastUpdated)],
)

export const clusterItems = pgTable(
  'cluster_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clusterId: uuid('cluster_id')
      .references(() => topicClusters.id, { onDelete: 'cascade' })
      .notNull(),
    mediaItemId: uuid('media_item_id')
      .references(() => mediaItems.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_cluster_media').on(table.clusterId, table.mediaItemId),
    index('idx_cluster_items_media').on(table.mediaItemId),
  ],
)

/** Kata kunci pantauan dengan sintaks Boolean (AND/OR/NOT, tanda kutip, kurung). */
export const monitoredKeywords = pgTable('monitored_keywords', {
  id: uuid('id').defaultRandom().primaryKey(),
  label: varchar('label', { length: 100 }).notNull(),
  booleanQuery: text('boolean_query').notNull(),
  isActive: text('is_active').default('true').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/** Tren dari X/Twitter, TikTok, dan Google Trends (snapshot berkala). */
export const socialTrends = pgTable(
  'social_trends',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    platform: sourcePlatformEnum('platform').notNull().default('TWITTER_X'),
    region: varchar('region', { length: 100 }).notNull().default('Indonesia'),
    woeid: integer('woeid'),
    name: text('name').notNull(),
    rank: integer('rank'),
    tweetVolume: integer('tweet_volume'),
    /** Label volume asli dari platform, mis. "1000+" atau "157.4M tayangan". */
    volumeLabel: varchar('volume_label', { length: 80 }),
    /** `trend` | `hashtag` | `search` | `sound`. */
    trendType: varchar('trend_type', { length: 20 }).notNull().default('trend'),
    /** Jendela waktu Google Trends (4/24/48/168 jam); null untuk platform lain. */
    windowHours: integer('window_hours'),
    /** Query terkait yang dilaporkan platform. */
    relatedQueries: jsonb('related_queries').$type<string[]>(),
    /** Jumlah artikel berita yang ditautkan Google Trends. */
    newsCount: integer('news_count'),
    sourceName: varchar('source_name', { length: 160 }),
    imageUrl: text('image_url'),
    url: text('url'),
    raw: jsonb('raw'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_social_trends_captured').on(table.capturedAt),
    index('idx_social_trends_platform').on(table.platform),
    index('idx_social_trends_name').on(table.name),
    index('idx_social_trends_captured_platform').on(table.platform, table.capturedAt),
    index('idx_social_trends_type').on(table.trendType),
    index('idx_social_trends_window').on(table.platform, table.windowHours, table.capturedAt),
  ],
)

/** Peringatan krisis / lonjakan isu. */
export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    keywordId: uuid('keyword_id').references(() => monitoredKeywords.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull(),
    severity: alertSeverityEnum('severity').notNull().default('MEDIUM'),
    metricsSnapshot: jsonb('metrics_snapshot').$type<{
      volumeIncreasePct: number
      negativeRatio: number
      sampleHeadlines: string[]
      recentVolume?: number
      baselineVolume?: number
      keywordLabel?: string
    }>(),
    isResolved: text('is_resolved').default('false').notNull(),
    triggeredAt: timestamp('triggered_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_alerts_triggered_at').on(table.triggeredAt),
    index('idx_alerts_severity').on(table.severity),
    index('idx_alerts_resolved').on(table.isResolved),
  ],
)

export const sourcesRelations = relations(sources, ({ many }) => ({
  mediaItems: many(mediaItems),
}))

export const mediaItemsRelations = relations(mediaItems, ({ one, many }) => ({
  source: one(sources, { fields: [mediaItems.sourceId], references: [sources.id] }),
  clusterItems: many(clusterItems),
}))

export const topicClustersRelations = relations(topicClusters, ({ many }) => ({
  items: many(clusterItems),
}))

export const clusterItemsRelations = relations(clusterItems, ({ one }) => ({
  cluster: one(topicClusters, {
    fields: [clusterItems.clusterId],
    references: [topicClusters.id],
  }),
  mediaItem: one(mediaItems, {
    fields: [clusterItems.mediaItemId],
    references: [mediaItems.id],
  }),
}))

export const monitoredKeywordsRelations = relations(monitoredKeywords, ({ many }) => ({
  alerts: many(alerts),
}))

export const alertsRelations = relations(alerts, ({ one }) => ({
  keyword: one(monitoredKeywords, {
    fields: [alerts.keywordId],
    references: [monitoredKeywords.id],
  }),
}))

export type SourceRow = typeof sources.$inferSelect
export type MediaItemRow = typeof mediaItems.$inferSelect
export type TopicClusterRow = typeof topicClusters.$inferSelect
export type AlertRow = typeof alerts.$inferSelect
export type KeywordRow = typeof monitoredKeywords.$inferSelect
