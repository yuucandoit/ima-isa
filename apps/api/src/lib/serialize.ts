import type {
  AlertDTO,
  ClusterDTO,
  KeywordDTO,
  MediaItemDTO,
  NamedEntityBag,
  SourceDTO,
  SourcePlatform,
  SentimentLabel,
} from '@media-intel/types'

export function iso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString()
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export function isoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export function bool(value: string | boolean | null | undefined): boolean {
  return value === true || value === 'true'
}

function normalizeEntities(value: unknown): NamedEntityBag {
  if (!value || typeof value !== 'object') return { persons: [], organizations: [], locations: [] }
  const bag = value as Partial<NamedEntityBag>
  return {
    persons: Array.isArray(bag.persons) ? bag.persons : [],
    organizations: Array.isArray(bag.organizations) ? bag.organizations : [],
    locations: Array.isArray(bag.locations) ? bag.locations : [],
    hashtags: Array.isArray(bag.hashtags) ? bag.hashtags : [],
  }
}

type MediaRowLike = {
  id: string
  sourceId?: string | null
  source_id?: string | null
  platform: string
  externalId?: string
  external_id?: string
  url: string
  author: string | null
  title: string
  rawContent?: string
  raw_content?: string
  cleanContent?: string
  clean_content?: string
  sentiment: string
  sentimentScore?: number
  sentiment_score?: number
  entities: unknown
  publishedAt?: Date | string
  published_at?: Date | string
  processedAt?: Date | string
  processed_at?: Date | string
  sourceName?: string | null
  sourceDomain?: string | null
  source_name?: string | null
  source_domain?: string | null
}

export function toMediaItemDTO(row: MediaRowLike): MediaItemDTO {
  const sourceId = row.sourceId ?? row.source_id ?? null
  return {
    id: row.id,
    sourceId,
    sourceName: row.sourceName ?? row.source_name ?? null,
    sourceDomain: row.sourceDomain ?? row.source_domain ?? null,
    platform: row.platform as SourcePlatform,
    externalId: row.externalId ?? row.external_id ?? row.id,
    url: row.url,
    author: row.author,
    title: row.title,
    rawContent: row.rawContent ?? row.raw_content ?? '',
    cleanContent: row.cleanContent ?? row.clean_content ?? '',
    sentiment: row.sentiment as SentimentLabel,
    sentimentScore: Number(row.sentimentScore ?? row.sentiment_score ?? 0),
    entities: normalizeEntities(row.entities),
    publishedAt: iso(row.publishedAt ?? row.published_at),
    processedAt: iso(row.processedAt ?? row.processed_at),
  }
}

export function toSourceDTO(row: {
  id: string
  name: string
  domain: string
  platform: string
  rssUrl: string | null
  isActive: string | boolean
  createdAt: Date | string
  totalItems?: number | string | null
}): SourceDTO {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    platform: row.platform as SourcePlatform,
    rssUrl: row.rssUrl,
    isActive: bool(row.isActive),
    createdAt: iso(row.createdAt),
    totalItems: row.totalItems === undefined ? undefined : Number(row.totalItems ?? 0),
  }
}

export function toKeywordDTO(row: {
  id: string
  label: string
  booleanQuery: string
  isActive: string | boolean
  createdAt: Date | string
  matches?: number | string | null
}): KeywordDTO {
  return {
    id: row.id,
    label: row.label,
    booleanQuery: row.booleanQuery,
    isActive: bool(row.isActive),
    createdAt: iso(row.createdAt),
    matches: row.matches === undefined ? undefined : Number(row.matches ?? 0),
  }
}

export function toAlertDTO(row: {
  id: string
  keywordId: string | null
  keywordLabel?: string | null
  title: string
  description: string
  severity: string
  metricsSnapshot: AlertDTO['metricsSnapshot']
  isResolved: string | boolean
  triggeredAt: Date | string
}): AlertDTO {
  return {
    id: row.id,
    keywordId: row.keywordId,
    keywordLabel: row.keywordLabel ?? null,
    title: row.title,
    description: row.description,
    severity: row.severity as AlertDTO['severity'],
    metricsSnapshot: row.metricsSnapshot ?? null,
    isResolved: bool(row.isResolved),
    triggeredAt: iso(row.triggeredAt),
  }
}

export function toClusterDTO(row: {
  id: string
  title: string
  summary: string | null
  dominantSentiment?: string | null
  dominant_sentiment?: string | null
  totalArticles?: number | string | null
  total_articles?: number | string | null
  firstSeenAt?: Date | string
  first_seen_at?: Date | string
  lastUpdated?: Date | string
  last_updated?: Date | string
  sourceCount?: number | string | null
  source_count?: number | string | null
  sources?: string[] | null
  sampleHeadlines?: string[] | null
  sample_headlines?: string[] | null
}): ClusterDTO {
  const sources = row.sources ?? []
  const sampleHeadlines = row.sampleHeadlines ?? row.sample_headlines ?? []
  const dominant = row.dominantSentiment ?? row.dominant_sentiment ?? null
  const total = row.totalArticles ?? row.total_articles ?? 0
  const firstSeen = row.firstSeenAt ?? row.first_seen_at
  const lastUpdated = row.lastUpdated ?? row.last_updated
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    dominantSentiment: dominant as SentimentLabel | null,
    totalArticles: Number(total),
    sourceCount: Number(row.sourceCount ?? row.source_count ?? sources.length),
    firstSeenAt: iso(firstSeen),
    lastUpdated: iso(lastUpdated),
    sources,
    sampleHeadlines,
  }
}
