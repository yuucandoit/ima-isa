import { sql } from 'drizzle-orm'
import type {
  FigurePeriod,
  FigureTrendItem,
  FigureTrendingResult,
  SocialTrendItem,
  SocialTrendingResult,
  TrendingWindow,
} from '@media-intel/types'
import { db } from '../../db'
import { iso } from '../../lib/serialize'

type Row = Record<string, unknown>

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

export interface SocialTrendingQuery {
  window?: TrendingWindow
  limit?: number
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
  const limit = Math.min(50, Math.max(1, query.limit ?? 20))
  const now = new Date()
  const from = new Date(now.getTime() - SOCIAL_WINDOWS[window])
  const previousFrom = new Date(from.getTime() - SOCIAL_WINDOWS[window])

  const [trendRows, hashtagRows, previousRows] = await Promise.all([
    db.execute(sql`
      SELECT DISTINCT ON (lower(name))
        name, rank, tweet_volume, url, captured_at, platform
      FROM social_trends
      WHERE captured_at >= ${from.toISOString()}
      ORDER BY lower(name), captured_at DESC
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
  let xTrends = 0
  let hashtags = 0

  for (const row of trendRows as Row[]) {
    const name = String(row.name)
    const key = normaliseKey(name)
    const volume = Number(row.tweet_volume ?? 0)
    items.set(key, {
      name,
      type: 'x_trend',
      platform: String(row.platform) as SocialTrendItem['platform'],
      rank: row.rank === null || row.rank === undefined ? null : Number(row.rank),
      volume,
      deltaPct: null,
      negativeRatio: 0,
      sourceCount: 0,
      url: (row.url as string | null) ?? null,
      lastSeenAt: row.captured_at ? iso(row.captured_at as string) : null,
    })
    xTrends += 1
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
        deltaPct,
        negativeRatio,
        sourceCount: Number(row.source_count ?? 0),
        url: `https://x.com/search?q=${encodeURIComponent(`#${display.replace(/^#/, '')}`)}`,
        lastSeenAt: row.last_seen ? iso(row.last_seen as string) : null,
      })
      hashtags += 1
    }
  }

  const sorted = [...items.values()]
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'x_trend' ? -1 : 1
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank
      return b.volume - a.volume
    })
    .slice(0, limit)

  const capturedAt = (trendRows as Row[]).reduce<string | null>((latest, row) => {
    if (!row.captured_at) return latest
    const value = iso(row.captured_at as string)
    return !latest || value > latest ? value : latest
  }, null)

  return {
    window,
    from: iso(from),
    to: iso(now),
    capturedAt,
    items: sorted,
    sources: { xTrends, hashtags },
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
