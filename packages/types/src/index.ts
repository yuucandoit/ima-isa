/**
 * Shared contract between the Elysia API, the dashboard and the Python worker.
 * Keep every DTO JSON-safe (dates are ISO strings) so it can be consumed by an
 * Eden Treaty client without surprises.
 */

export const SOURCE_PLATFORMS = [
  'NEWS_MEDIA',
  'TWITTER_X',
  'YOUTUBE',
  'TIKTOK',
  'GOOGLE_TRENDS',
] as const
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number]

export const SENTIMENT_LABELS = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'] as const
export type SentimentLabel = (typeof SENTIMENT_LABELS)[number]

export const ALERT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number]

export interface NamedEntityBag {
  persons: string[]
  organizations: string[]
  locations: string[]
  hashtags?: string[]
}

export interface SourceDTO {
  id: string
  name: string
  domain: string
  platform: SourcePlatform
  rssUrl: string | null
  isActive: boolean
  createdAt: string
  totalItems?: number
}

export interface MediaItemDTO {
  id: string
  sourceId: string | null
  sourceName: string | null
  sourceDomain: string | null
  platform: SourcePlatform
  externalId: string
  url: string
  author: string | null
  title: string
  rawContent: string
  cleanContent: string
  sentiment: SentimentLabel
  sentimentScore: number
  entities: NamedEntityBag
  publishedAt: string
  processedAt: string
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface Paginated<T> {
  data: T[]
  meta: PaginationMeta
}

export interface OverviewStats {
  totalItems: number
  negativeItems: number
  positiveItems: number
  neutralItems: number
  negativeRatio: number
  positiveRatio: number
  neutralRatio: number
  activeSources: number
  activeClusters: number
  activeAlerts: number
  criticalAlerts: number
  volumeChangePct: number
  baselineVolume: number
  currentVolume: number
}

export interface SentimentPoint {
  bucket: string
  label: string
  positive: number
  neutral: number
  negative: number
  total: number
}

export interface ShareOfVoiceItem {
  sourceId: string | null
  sourceName: string
  domain: string
  total: number
  negative: number
  sharePct: number
  sentimentIndex: number
}

export interface PlatformVolumeItem {
  platform: SourcePlatform
  total: number
  negative: number
}

export interface EntityCount {
  type: 'person' | 'organization' | 'location'
  name: string
  count: number
}

export interface HeatmapCell {
  day: number
  hour: number
  total: number
}

export interface LocationPoint {
  name: string
  latitude: number
  longitude: number
  total: number
  negative: number
  negativeRatio: number
  sourceCount: number
  sources: string[]
  sampleHeadlines: string[]
}

export interface UnmappedLocation {
  name: string
  total: number
}

export interface LocationAnalyticsResult {
  points: LocationPoint[]
  unmapped: UnmappedLocation[]
  totalMentions: number
  mappedMentions: number
  range: { from: string; to: string }
}

export interface AnalyticsOverview {
  stats: OverviewStats
  sentimentTrend: SentimentPoint[]
  shareOfVoice: ShareOfVoiceItem[]
  platformVolume: PlatformVolumeItem[]
  topEntities: EntityCount[]
  activityHeatmap: HeatmapCell[]
  range: { from: string; to: string; bucket: 'hour' | 'day' }
}

export interface KeywordDTO {
  id: string
  label: string
  booleanQuery: string
  isActive: boolean
  createdAt: string
  matches?: number
}

export interface ClusterDTO {
  id: string
  title: string
  summary: string | null
  dominantSentiment: SentimentLabel | null
  totalArticles: number
  sourceCount: number
  firstSeenAt: string
  lastUpdated: string
  sources: string[]
  sampleHeadlines: string[]
}

export interface ClusterDetail {
  cluster: ClusterDTO
  articles: MediaItemDTO[]
}

export interface MetricsSnapshot {
  volumeIncreasePct: number
  negativeRatio: number
  sampleHeadlines: string[]
  recentVolume?: number
  baselineVolume?: number
  keywordLabel?: string
}

export interface AlertDTO {
  id: string
  keywordId: string | null
  keywordLabel: string | null
  title: string
  description: string
  severity: AlertSeverity
  metricsSnapshot: MetricsSnapshot | null
  isResolved: boolean
  triggeredAt: string
}

export interface ClusteringRunResult {
  scanned: number
  assignedToExisting: number
  clustersCreated: number
  clustersUpdated: number
  skipped: number
  distanceThreshold?: number
  updatedAt?: string
}

export interface SystemStatus {
  api: 'ok'
  database: 'ok' | 'error'
  redis: 'ok' | 'error' | 'disabled'
  llm: 'ok' | 'error' | 'disabled'
  llmProvider: 'openai' | 'ollama' | 'disabled'
  worker: {
    lastProcessedAt: string | null
    backlog: number
    consumerGroup: string
  }
  counts: {
    sources: number
    mediaItems: number
    clusters: number
    alerts: number
    keywords: number
  }
  versions: {
    api: string
    model: string
    provider: string
  }
}

export interface SummaryResult {
  clusterId: string
  summary: string
  model: string
  provider?: string
  generatedAt: string
  cached: boolean
}

export interface ApiError {
  error: string
  code?: string
  details?: unknown
}

export interface FeedQuery {
  page?: number
  limit?: number
  search?: string
  sentiment?: SentimentLabel
  platform?: SourcePlatform
  sourceId?: string
  keywordId?: string
  /** Internal: resolved Boolean query for `keywordId`. */
  keywordQuery?: string
  from?: string
  to?: string
}

export interface AnalyticsQuery {
  from?: string
  to?: string
  keywordId?: string
  /** Internal: resolved Boolean query for `keywordId`. */
  keywordQuery?: string
  sourceId?: string
  platform?: SourcePlatform
  bucket?: 'hour' | 'day'
}

export interface SseMediaEvent {
  id: string
  title: string
  url: string
  sourceName: string
  sourceDomain: string
  platform: SourcePlatform
  sentiment: SentimentLabel
  sentimentScore: number
  publishedAt: string
}

export interface SseAlertEvent {
  id: string
  title: string
  severity: AlertSeverity
  description: string
  triggeredAt: string
}

export type TrendingWindow = '24h' | '7d'
export type FigurePeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'

/** Jenis tren: X trend, hashtag sosial, Google search, atau sound TikTok. */
export type TrendType = 'x_trend' | 'hashtag' | 'google_search' | 'tiktok_sound'

/** `volume` = besaran yang dilaporkan platform, `rank` = urutan asli feed. */
export type TrendSort = 'volume' | 'rank'

export interface SocialTrendItem {
  name: string
  type: TrendType
  platform: SourcePlatform
  rank: number | null
  volume: number
  /** Label volume asli dari platform, mis. "1000+" atau "157,4 jt tayangan". */
  volumeLabel: string | null
  deltaPct: number | null
  negativeRatio: number
  sourceCount: number
  url: string | null
  imageUrl: string | null
  sourceName: string | null
  /** Kapan tren itu muncul/diperbarui menurut platform (bukan waktu polling). */
  publishedAt: string | null
  lastSeenAt: string | null
  /** Jendela waktu Google Trends (4/24/48/168 jam); null untuk platform lain. */
  windowHours: number | null
  /** Query terkait dari Google Trends ("bsu", "cek bsu", …). */
  relatedQueries: string[]
  /** Jumlah artikel berita yang ditautkan Google. */
  newsCount: number | null
  /** `trending_page` (scrape) atau `rss` (cadangan). */
  dataSource: string | null
}

/** Ringkasan per platform untuk header panel trending. */
export interface SocialTrendingSourceCount {
  platform: SourcePlatform
  label: string
  total: number
  rank: number | null
  /** Wilayah sumber tren: "Indonesia", "ID", atau WOEID. */
  region: string | null
  capturedAt: string | null
}

export interface SocialTrendingResult {
  window: TrendingWindow
  from: string
  to: string
  capturedAt: string | null
  items: SocialTrendItem[]
  sources: {
    xTrends: number
    googleTrends: number
    tiktokTrends: number
    hashtags: number
  }
  breakdown: SocialTrendingSourceCount[]
  /** Jendela waktu Google Trends yang tersedia di database. */
  windows: Array<{ hours: number; total: number; capturedAt: string | null }>
}

export interface FigureTrendItem {
  name: string
  mentions: number
  previousMentions: number
  deltaPct: number | null
  negativeRatio: number
  sourceCount: number
  sources: string[]
  sampleHeadlines: string[]
  lastSeenAt: string | null
}

export interface FigureTrendingResult {
  period: FigurePeriod
  from: string
  to: string
  items: FigureTrendItem[]
}

export const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
}

export const SENTIMENT_ORDER: Record<SentimentLabel, number> = {
  NEGATIVE: -1,
  NEUTRAL: 0,
  POSITIVE: 1,
}
