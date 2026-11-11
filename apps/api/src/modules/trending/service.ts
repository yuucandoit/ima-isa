import { sql } from 'drizzle-orm'
import type {
  FigurePeriod,
  FigureTrendItem,
  FigureTrendingResult,
  SocialTrendItem,
  SocialTrendingResult,
  SocialTrendingSourceCount,
  TrendType,
  TrendingWindow,
} from '@media-intel/types'
import { db } from '../../db'
import { iso } from '../../lib/serialize'
import { type TrendSort, sortTrendItems } from './sort'

type Row = Record<string, unknown>

/** Batas atas `limit` untuk endpoint trending (dipakai service & controller). */
export const MAX_TRENDING_LIMIT = 200

const SOCIAL_WINDOWS: Record<TrendingWindow, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

const FIGURE_PERIODS: Record<FigurePeriod, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  yearly: 365,
}

function normaliseKey(value: string): string {
  return value.replace(/^#/, '').trim().toLowerCase()
}

const PLATFORM_LABEL: Record<string, string> = {
  NEWS_MEDIA: 'Media Daring',
  TWITTER_X: 'X / Twitter',
  YOUTUBE: 'YouTube',
  TIKTOK: 'TikTok',
  GOOGLE_TRENDS: 'Google Trends',
}

/** Kolom `social_trends.trend_type` → tipe item DTO. */
function trendTypeOf(row: Row): TrendType {
  const stored = String(row.trend_type ?? 'trend')
  if (stored === 'hashtag') return 'hashtag'
  if (stored === 'search') return 'google_search'
  if (stored === 'sound') return 'tiktok_sound'
  return String(row.platform) === 'GOOGLE_TRENDS' ? 'google_search' : 'x_trend'
}

export interface SocialTrendingQuery {
  window?: TrendingWindow
  limit?: number
  /** Filter satu platform, mis. GOOGLE_TRENDS. */
  platform?: string
  /** `volume` (default) atau `rank` (urutan asli feed platform). */
  sort?: TrendSort
  /** Jendela waktu Google Trends: 4 | 24 | 48 | 168 jam (default 24). */
  hours?: number
}

/**
 * Gabungan dua sumber:
 *  1. X Trends API (`social_trends`, diisi `social_poller.py` bila token ada).
 *  2. Hashtag turunan dari post sosial yang sudah di-ingest (`media_items.entities.hashtags`).
 */
export async function getSocialTrending(
  query: SocialTrendingQuery = {},
): Promise<SocialTrendingResult> {
  const window: TrendingWindow = query.window ?? '24h'
  const hours = [4, 24, 48, 168].includes(Number(query.hours)) ? Number(query.hours) : 24
  // Google mengembalikan 140+ tren; batas atas disamakan dengan controller (200).
  const limit = Math.min(MAX_TRENDING_LIMIT, Math.max(1, query.limit ?? 20))
  const now = new Date()
  const from = new Date(now.getTime() - SOCIAL_WINDOWS[window])
  const previousFrom = new Date(from.getTime() - SOCIAL_WINDOWS[window])

  const [trendRows, hashtagRows, previousRows] = await Promise.all([
    db.execute(sql`
      WITH latest AS (
        -- Satu snapshot terbaru per (platform, jendela waktu): daftar tren
        -- bersifat menggantikan, bukan akumulatif.
        SELECT platform, window_hours, max(captured_at) AS captured_at
        FROM social_trends
        WHERE captured_at >= ${previousFrom.toISOString()}
        GROUP BY platform, window_hours
      )
      SELECT t.platform, t.name, t.rank, t.tweet_volume, t.volume_label, t.trend_type,
             t.source_name, t.image_url, t.url, t.captured_at, t.source_published_at,
             t.region, t.window_hours, t.related_queries, t.news_count,
             t.raw ->> 'source' AS data_source
      FROM social_trends t
      JOIN latest l
        ON l.platform = t.platform
       AND l.window_hours IS NOT DISTINCT FROM t.window_hours
       AND l.captured_at = t.captured_at
      WHERE t.captured_at >= ${from.toISOString()}
        -- Google punya beberapa jendela; platform lain tidak berjendela.
        AND (t.platform <> 'GOOGLE_TRENDS' OR t.window_hours = ${hours})
    `),
    db.execute(sql`
      SELECT
        tag AS name,
        count(*)::int AS mentions,
        count(*) FILTER (WHERE mi.sentiment = 'NEGATIVE')::int AS negative,
        count(DISTINCT mi.source_id)::int AS source_count,
        max(mi.published_at) AS last_seen,
        array_agg(DISTINCT mi.platform) AS platforms
      FROM media_items mi
      CROSS JOIN LATERAL jsonb_array_elements_text(
        COALESCE(mi.entities -> 'hashtags', '[]'::jsonb)
      ) AS t(tag)
      WHERE mi.published_at >= ${from.toISOString()}
        AND mi.published_at <= ${now.toISOString()}
        AND mi.platform <> 'NEWS_MEDIA'
      GROUP BY tag
      ORDER BY mentions DESC
      LIMIT ${limit * 2}
    `),
    db.execute(sql`
      SELECT tag AS name, count(*)::int AS mentions
      FROM media_items mi
      CROSS JOIN LATERAL jsonb_array_elements_text(
        COALESCE(mi.entities -> 'hashtags', '[]'::jsonb)
      ) AS t(tag)
      WHERE mi.published_at >= ${previousFrom.toISOString()}
        AND mi.published_at < ${from.toISOString()}
        AND mi.platform <> 'NEWS_MEDIA'
      GROUP BY tag
    `),
  ])

  const previousMap = new Map<string, number>()
  for (const row of previousRows as Row[]) {
    previousMap.set(normaliseKey(String(row.name)), Number(row.mentions ?? 0))
  }

  const items = new Map<string, SocialTrendItem>()
  const counts = { xTrends: 0, googleTrends: 0, tiktokTrends: 0, hashtags: 0 }
  const windows = new Map<number, { total: number; capturedAt: string | null }>()
  const perPlatform = new Map<
    string,
    { total: number; rank: number | null; capturedAt: string | null; region: string | null }
  >()

  for (const row of trendRows as Row[]) {
    const name = String(row.name)
    const platform = String(row.platform)
    const key = `${platform}:${normaliseKey(name)}`
    const volume = Number(row.tweet_volume ?? 0)
    const rank = row.rank === null || row.rank === undefined ? null : Number(row.rank)
    const capturedAt = row.captured_at ? iso(row.captured_at as string) : null
    // Waktu tren menurut platform; fallback ke waktu snapshot bila tidak ada.
    const publishedAt = row.source_published_at
      ? iso(row.source_published_at as string)
      : capturedAt

    items.set(key, {
      name,
      type: trendTypeOf(row),
      platform: platform as SocialTrendItem['platform'],
      rank,
      volume,
      volumeLabel: (row.volume_label as string | null) ?? null,
      deltaPct: null,
      negativeRatio: 0,
      sourceCount: 0,
      url: (row.url as string | null) ?? null,
      imageUrl: (row.image_url as string | null) ?? null,
      sourceName: (row.source_name as string | null) ?? null,
      publishedAt,
      lastSeenAt: capturedAt,
      windowHours: row.window_hours === null || row.window_hours === undefined ? null : Number(row.window_hours),
      relatedQueries: ((row.related_queries as string[] | null) ?? []).slice(0, 8),
      newsCount: row.news_count === null || row.news_count === undefined ? null : Number(row.news_count),
      dataSource: (row.data_source as string | null) ?? null,
    })

    // Hitung ikut sumber agregat: X trends, Google Trends, TikTok.
    if (platform === 'TWITTER_X') counts.xTrends += 1
    else if (platform === 'GOOGLE_TRENDS') counts.googleTrends += 1
    else if (platform === 'TIKTOK') counts.tiktokTrends += 1

    if (row.window_hours !== null && row.window_hours !== undefined) {
      const hoursValue = Number(row.window_hours)
      const windowBucket = windows.get(hoursValue) ?? { total: 0, capturedAt: null }
      windowBucket.total += 1
      if (capturedAt && (!windowBucket.capturedAt || capturedAt > windowBucket.capturedAt)) {
        windowBucket.capturedAt = capturedAt
      }
      windows.set(hoursValue, windowBucket)
    }

    const bucket = perPlatform.get(platform) ?? { total: 0, rank: null, capturedAt: null, region: null }
    bucket.region = (row.region as string | null) ?? bucket.region
    bucket.total += 1
    if (rank !== null && (bucket.rank === null || rank < bucket.rank)) bucket.rank = rank
    if (capturedAt && (!bucket.capturedAt || capturedAt > bucket.capturedAt)) bucket.capturedAt = capturedAt
    perPlatform.set(platform, bucket)
  }

  for (const row of hashtagRows as Row[]) {
    const display = String(row.name)
    const key = normaliseKey(display)
    const mentions = Number(row.mentions ?? 0)
    const previous = previousMap.get(key) ?? 0
    const platforms = (row.platforms as string[] | null) ?? []
    const platform = (platforms[0] as SocialTrendItem['platform']) ?? 'TWITTER_X'
    const existing = items.get(key)

    const deltaPct =
      previous > 0 ? Number((((mentions - previous) / previous) * 100).toFixed(1)) : null
    const negativeRatio =
      mentions > 0
        ? Number((((Number(row.negative ?? 0)) / mentions) * 100).toFixed(1))
        : 0

    if (existing) {
      existing.volume = Math.max(existing.volume, mentions)
      existing.negativeRatio = negativeRatio
      existing.sourceCount = Number(row.source_count ?? 0)
      existing.lastSeenAt = row.last_seen ? iso(row.last_seen as string) : existing.lastSeenAt
      if (existing.deltaPct === null) existing.deltaPct = deltaPct
    } else {
      // `tag` disimpan tanpa '#', tampilkan sebagai hashtag.
      items.set(key, {
        name: display.startsWith('#') ? display : `#${display}`,
        type: 'hashtag',
        platform,
        rank: null,
        volume: mentions,
        volumeLabel: `${mentions} sebutan`,
        deltaPct,
        negativeRatio,
        sourceCount: Number(row.source_count ?? 0),
        url: `https://x.com/search?q=${encodeURIComponent(`#${display.replace(/^#/, '')}`)}`,
        imageUrl: null,
        sourceName: null,
        publishedAt: row.last_seen ? iso(row.last_seen as string) : null,
        lastSeenAt: row.last_seen ? iso(row.last_seen as string) : null,
        windowHours: null,
        relatedQueries: [],
        newsCount: null,
        dataSource: null,
      })
      counts.hashtags += 1
    }
  }

  const filtered = query.platform
    ? [...items.values()].filter((item) => item.platform === query.platform)
    : [...items.values()]

  const sorted = sortTrendItems(filtered, query.sort ?? 'volume').slice(0, limit)

  const capturedAt = (trendRows as Row[]).reduce<string | null>((latest, row) => {
    if (!row.captured_at) return latest
    const value = iso(row.captured_at as string)
    return !latest || value > latest ? value : latest
  }, null)

  const breakdown: SocialTrendingSourceCount[] = [...perPlatform.entries()]
    .map(([platform, bucket]) => ({
      platform: platform as SocialTrendingSourceCount['platform'],
      label: PLATFORM_LABEL[platform] ?? platform,
      total: bucket.total,
      rank: bucket.rank,
      region: bucket.region,
      capturedAt: bucket.capturedAt,
    }))
    .sort((a, b) => b.total - a.total)

  return {
    window,
    from: iso(from),
    to: iso(now),
    capturedAt,
    items: sorted,
    sources: counts,
    breakdown,
    // Jendela Google yang benar-benar tersedia (dipakai UI untuk memilih tab).
    windows: [...windows.entries()]
      .map(([hoursValue, bucket]) => ({
        hours: hoursValue,
        total: bucket.total,
        capturedAt: bucket.capturedAt,
      }))
      .sort((a, b) => a.hours - b.hours),
  }
}

export interface FigureTrendingQuery {
  period?: FigurePeriod
  limit?: number
  sourceId?: string
  platform?: string
}

/** Gabungkan varian nama yang merupakan prefix satu sama lain. */
function mergeNameVariants(items: FigureTrendItem[]): FigureTrendItem[] {
  const merged: FigureTrendItem[] = []

  for (const item of [...items].sort((a, b) => b.mentions - a.mentions)) {
    const key = item.name.toLowerCase().trim()
    const target = merged.find((candidate) => {
      const existing = candidate.name.toLowerCase().trim()
      return (
        existing === key ||
        existing.startsWith(`${key} `) ||
        key.startsWith(`${existing} `)
      )
    })

    if (!target) {
      merged.push({ ...item, sources: [...item.sources], sampleHeadlines: [...item.sampleHeadlines] })
      continue
    }

    const targetNegative = (target.negativeRatio / 100) * target.mentions
    const itemNegative = (item.negativeRatio / 100) * item.mentions
    const totalMentions = target.mentions + item.mentions
    if (item.name.length > target.name.length) target.name = item.name
    target.mentions = totalMentions
    target.previousMentions += item.previousMentions
    target.negativeRatio =
      totalMentions > 0 ? Number((((targetNegative + itemNegative) / totalMentions) * 100).toFixed(1)) : 0
    target.sourceCount = Math.max(target.sourceCount, item.sourceCount)
    target.deltaPct =
      target.previousMentions > 0
        ? Number(
            (((target.mentions - target.previousMentions) / target.previousMentions) * 100).toFixed(1),
          )
        : null
    target.sources = [...new Set([...target.sources, ...item.sources])].slice(0, 5)
    target.sampleHeadlines = [...new Set([...target.sampleHeadlines, ...item.sampleHeadlines])].slice(0, 3)
    if (item.lastSeenAt && (!target.lastSeenAt || item.lastSeenAt > target.lastSeenAt)) {
      target.lastSeenAt = item.lastSeenAt
    }
  }

  return merged.sort((a, b) => b.mentions - a.mentions)
}

/** Tokoh (persons) paling banyak disebut, dengan pembanding periode sebelumnya. */
export async function getFigureTrending(
  query: FigureTrendingQuery = {},
): Promise<FigureTrendingResult> {
  const period: FigurePeriod = query.period ?? 'weekly'
  const days = FIGURE_PERIODS[period] ?? 7
  const limit = Math.min(100, Math.max(1, query.limit ?? 20))
  const now = new Date()
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const previousFrom = new Date(from.getTime() - days * 24 * 60 * 60 * 1000)

  const conditions = [
    sql`mi.published_at >= ${previousFrom.toISOString()}`,
    sql`mi.published_at <= ${now.toISOString()}`,
  ]
  if (query.sourceId) conditions.push(sql`mi.source_id = ${query.sourceId}::uuid`)
  if (query.platform) {
    conditions.push(sql`mi.platform = ${query.platform}::source_platform`)
  }
  const where = conditions.reduce((left, right) => sql`${left} AND ${right}`)

  const rows = await db.execute(sql`
    SELECT
      p.name AS name,
      count(*) FILTER (WHERE mi.published_at >= ${from.toISOString()})::int AS mentions,
      count(*) FILTER (WHERE mi.published_at < ${from.toISOString()})::int AS previous,
      count(*) FILTER (
        WHERE mi.published_at >= ${from.toISOString()} AND mi.sentiment = 'NEGATIVE'
      )::int AS negative,
      count(DISTINCT mi.source_id)
        FILTER (WHERE mi.published_at >= ${from.toISOString()})::int AS source_count,
      max(mi.published_at)
        FILTER (WHERE mi.published_at >= ${from.toISOString()}) AS last_seen,
      array_agg(DISTINCT s.name) FILTER (
        WHERE mi.published_at >= ${from.toISOString()} AND s.name IS NOT NULL
      ) AS sources,
      (
        array_agg(mi.title ORDER BY mi.published_at DESC) FILTER (
          WHERE mi.published_at >= ${from.toISOString()}
        )
      )[1:3] AS headlines
    FROM media_items mi
    LEFT JOIN sources s ON s.id = mi.source_id
    CROSS JOIN LATERAL jsonb_array_elements_text(
      COALESCE(mi.entities -> 'persons', '[]'::jsonb)
    ) AS p(name)
    WHERE ${where}
    GROUP BY p.name
    HAVING count(*) FILTER (WHERE mi.published_at >= ${from.toISOString()}) > 0
    ORDER BY mentions DESC, name ASC
    LIMIT ${limit}
  `)

  const items: FigureTrendItem[] = (rows as Row[]).map((row) => {
    const mentions = Number(row.mentions ?? 0)
    const previous = Number(row.previous ?? 0)
    const negative = Number(row.negative ?? 0)
    return {
      name: String(row.name),
      mentions,
      previousMentions: previous,
      deltaPct:
        previous > 0
          ? Number((((mentions - previous) / previous) * 100).toFixed(1))
          : null,
      negativeRatio:
        mentions > 0 ? Number(((negative / mentions) * 100).toFixed(1)) : 0,
      sourceCount: Number(row.source_count ?? 0),
      sources: ((row.sources as string[] | null) ?? []).filter(Boolean).slice(0, 5),
      sampleHeadlines: ((row.headlines as string[] | null) ?? []).filter(Boolean),
      lastSeenAt: row.last_seen ? iso(row.last_seen as string) : null,
    }
  })

  return {
    period,
    from: iso(from),
    to: iso(now),
    items: mergeNameVariants(items).slice(0, limit),
  }
}
