import { sql } from 'drizzle-orm'
import type {
  AnalyticsOverview,
  EntityCount,
  LocationAnalyticsResult,
  LocationPoint,
  HeatmapCell,
  PlatformVolumeItem,
  SentimentPoint,
  ShareOfVoiceItem,
  SourcePlatform,
} from '@media-intel/types'
import { db } from '../../db'
import { buildMediaFilter, resolveRange } from '../../lib/filters'
import { resolveLocation } from '../../lib/geo'
import { iso } from '../../lib/serialize'
import type { AnalyticsQuery } from '@media-intel/types'

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000

function formatBucket(date: Date, bucket: 'hour' | 'day'): string {
  const shifted = new Date(date.getTime() + WIB_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  if (bucket === 'hour') {
    const hour = String(shifted.getUTCHours()).padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:00`
  }
  return `${year}-${month}-${day}`
}

function floorToBucket(date: Date, bucket: 'hour' | 'day'): Date {
  const shifted = new Date(date.getTime() + WIB_OFFSET_MS)
  if (bucket === 'hour') {
    shifted.setUTCMinutes(0, 0, 0)
  } else {
    shifted.setUTCHours(0, 0, 0, 0)
  }
  return new Date(shifted.getTime() - WIB_OFFSET_MS)
}

function bucketSeries(from: Date, to: Date, bucket: 'hour' | 'day'): string[] {
  const stepMs = bucket === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000
  const keys: string[] = []
  const start = floorToBucket(from, bucket).getTime()
  const end = floorToBucket(to, bucket).getTime()
  for (let cursor = start; cursor <= end; cursor += stepMs) {
    keys.push(formatBucket(new Date(cursor), bucket))
  }
  return keys
}

type Row = Record<string, unknown>

export async function getLocationAnalytics(
  query: AnalyticsQuery,
): Promise<LocationAnalyticsResult> {
  const range = resolveRange(query, 7)
  const filter = buildMediaFilter(query, range)

  const rows = await db.execute(sql`
    SELECT
      loc AS name,
      count(*)::int AS total,
      count(*) FILTER (WHERE media_items.sentiment = 'NEGATIVE')::int AS negative,
      count(DISTINCT media_items.source_id)::int AS source_count,
      array_agg(DISTINCT s.name) AS sources,
      (
        array_agg(media_items.title ORDER BY media_items.published_at DESC)
      )[1:3] AS headlines
    FROM media_items
    LEFT JOIN sources s ON s.id = media_items.source_id
    CROSS JOIN LATERAL jsonb_array_elements_text(
      COALESCE(media_items.entities -> 'locations', '[]'::jsonb)
    ) AS t(loc)
    WHERE ${filter}
    GROUP BY loc
    ORDER BY total DESC
  `)

  const mapped = new Map<string, LocationPoint>()
  const unmapped = new Map<string, number>()
  let totalMentions = 0
  let mappedMentions = 0

  for (const row of rows as Row[]) {
    const rawName = String(row.name ?? '').trim()
    if (!rawName) continue
    const total = Number(row.total ?? 0)
    totalMentions += total

    const geo = resolveLocation(rawName)
    if (!geo) {
      unmapped.set(rawName, (unmapped.get(rawName) ?? 0) + total)
      continue
    }

    mappedMentions += total
    const key = geo.name
    const current = mapped.get(key)
    const sources = ((row.sources as string[] | null) ?? []).filter(Boolean)
    const headlines = ((row.headlines as string[] | null) ?? []).filter(Boolean)
    const negative = Number(row.negative ?? 0)

    if (current) {
      current.total += total
      current.negative += negative
      current.negativeRatio =
        current.total > 0 ? Number(((current.negative / current.total) * 100).toFixed(1)) : 0
      current.sourceCount = Math.max(current.sourceCount, Number(row.source_count ?? 0))
      current.sources = [...new Set([...current.sources, ...sources])].slice(0, 5)
      current.sampleHeadlines = [
        ...new Set([...current.sampleHeadlines, ...headlines]),
      ].slice(0, 3)
    } else {
      mapped.set(key, {
        name: key,
        latitude: geo.lat,
        longitude: geo.lon,
        total,
        negative,
        negativeRatio: total > 0 ? Number(((negative / total) * 100).toFixed(1)) : 0,
        sourceCount: Number(row.source_count ?? 0),
        sources: sources.slice(0, 5),
        sampleHeadlines: headlines.slice(0, 3),
      })
    }
  }

  return {
    points: [...mapped.values()].sort((a, b) => b.total - a.total).slice(0, 60),
    unmapped: [...unmapped.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10),
    totalMentions,
    mappedMentions,
    range: { from: iso(range.from), to: iso(range.to) },
  }
}

export async function getOverview(query: AnalyticsQuery): Promise<AnalyticsOverview> {
  const range = resolveRange(query, 7)
  const filter = buildMediaFilter(query, range)
  const bucket: 'hour' | 'day' =
    query.bucket ?? (range.to.getTime() - range.from.getTime() <= 48 * 60 * 60 * 1000 ? 'hour' : 'day')

  const durationMs = range.to.getTime() - range.from.getTime()
  const previousRange = {
    from: new Date(range.from.getTime() - durationMs),
    to: new Date(range.from.getTime()),
  }
  const previousFilter = buildMediaFilter(query, previousRange)

  const [statsRows, previousRows, alertRows, clusterRows, trendRows, sovRows, platformRows] =
    await Promise.all([
      db.execute(sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE sentiment = 'POSITIVE')::int AS positive,
          count(*) FILTER (WHERE sentiment = 'NEUTRAL')::int AS neutral,
          count(*) FILTER (WHERE sentiment = 'NEGATIVE')::int AS negative,
          count(DISTINCT source_id)::int AS active_sources
        FROM media_items
        WHERE ${filter}
      `),
      db.execute(sql`
        SELECT count(*)::int AS total FROM media_items WHERE ${previousFilter}
      `),
      db.execute(sql`
        SELECT
          count(*) FILTER (WHERE is_resolved = 'false')::int AS active,
          count(*) FILTER (WHERE is_resolved = 'false' AND severity = 'CRITICAL')::int AS critical
        FROM alerts
      `),
      db.execute(sql`
        SELECT count(*)::int AS total FROM topic_clusters WHERE last_updated >= ${range.from.toISOString()}
      `),
      db.execute(sql`
        SELECT
          to_char(date_trunc(${sql.raw(`'${bucket}'`)}, published_at), ${bucket === 'hour' ? 'YYYY-MM-DD HH24:00' : 'YYYY-MM-DD'}) AS bucket,
          count(*) FILTER (WHERE sentiment = 'POSITIVE')::int AS positive,
          count(*) FILTER (WHERE sentiment = 'NEUTRAL')::int AS neutral,
          count(*) FILTER (WHERE sentiment = 'NEGATIVE')::int AS negative,
          count(*)::int AS total
        FROM media_items
        WHERE ${filter}
        GROUP BY 1
        ORDER BY 1
      `),
      db.execute(sql`
        SELECT
          s.id AS source_id,
          COALESCE(s.name, 'Tanpa sumber') AS source_name,
          COALESCE(s.domain, '-') AS domain,
          count(*)::int AS total,
          count(*) FILTER (WHERE sentiment = 'NEGATIVE')::int AS negative,
          count(*) FILTER (WHERE sentiment = 'POSITIVE')::int AS positive
        FROM media_items
        LEFT JOIN sources s ON s.id = media_items.source_id
        WHERE ${filter}
        GROUP BY s.id, s.name, s.domain
        ORDER BY total DESC
        LIMIT 12
      `),
      db.execute(sql`
        SELECT platform, count(*)::int AS total,
          count(*) FILTER (WHERE sentiment = 'NEGATIVE')::int AS negative
        FROM media_items
        WHERE ${filter}
        GROUP BY platform
        ORDER BY total DESC
      `),
    ])

  const stats = (statsRows[0] ?? {}) as Row
  const total = Number(stats.total ?? 0)
  const negative = Number(stats.negative ?? 0)
  const positive = Number(stats.positive ?? 0)
  const neutral = Number(stats.neutral ?? 0)
  const previousTotal = Number(((previousRows[0] ?? {}) as Row).total ?? 0)
  const alertStats = (alertRows[0] ?? {}) as Row

  const trendMap = new Map<string, SentimentPoint>()
  for (const key of bucketSeries(range.from, range.to, bucket)) {
    trendMap.set(key, { bucket: key, label: key, positive: 0, neutral: 0, negative: 0, total: 0 })
  }
  for (const row of trendRows as Row[]) {
    const point: SentimentPoint = {
      bucket: String(row.bucket),
      label: String(row.bucket),
      positive: Number(row.positive ?? 0),
      neutral: Number(row.neutral ?? 0),
      negative: Number(row.negative ?? 0),
      total: Number(row.total ?? 0),
    }
    trendMap.set(point.bucket, point)
  }

  const shareOfVoice: ShareOfVoiceItem[] = (sovRows as Row[]).map((row) => {
    const sourceTotal = Number(row.total ?? 0)
    const sourceNegative = Number(row.negative ?? 0)
    const sourcePositive = Number(row.positive ?? 0)
    return {
      sourceId: (row.source_id as string | null) ?? null,
      sourceName: String(row.source_name),
      domain: String(row.domain),
      total: sourceTotal,
      negative: sourceNegative,
      sharePct: total > 0 ? Number(((sourceTotal / total) * 100).toFixed(2)) : 0,
      sentimentIndex:
        sourceTotal > 0
          ? Number((((sourcePositive - sourceNegative) / sourceTotal) * 100).toFixed(2))
          : 0,
    }
  })

  const platformVolume: PlatformVolumeItem[] = (platformRows as Row[]).map((row) => ({
    platform: String(row.platform) as SourcePlatform,
    total: Number(row.total ?? 0),
    negative: Number(row.negative ?? 0),
  }))

  const entityGroups: Array<{ type: EntityCount['type']; key: string }> = [
    { type: 'person', key: 'persons' },
    { type: 'organization', key: 'organizations' },
    { type: 'location', key: 'locations' },
  ]

  const entityResults = await Promise.all(
    entityGroups.map((group) =>
      db.execute(sql`
        SELECT value AS name, count(*)::int AS count
        FROM media_items, jsonb_array_elements_text(entities -> ${group.key}) AS value
        WHERE ${filter} AND length(value) > 1
        GROUP BY value
        ORDER BY count DESC
        LIMIT 6
      `),
    ),
  )

  const entityMap = new Map<string, EntityCount>()
  entityResults.forEach((rows, index) => {
    const group = entityGroups[index]!
    for (const row of rows as Row[]) {
      const name = String(row.name)
      const key = `${group.type}:${name.toLowerCase()}`
      const current = entityMap.get(key)
      const count = Number(row.count ?? 0)
      if (current) current.count += count
      else entityMap.set(key, { type: group.type, name, count })
    }
  })
  const topEntities = [...entityMap.values()].sort((a, b) => b.count - a.count).slice(0, 12)

  const heatmapRows = await db.execute(sql`
    SELECT
      extract(dow FROM published_at)::int AS day,
      extract(hour FROM published_at)::int AS hour,
      count(*)::int AS total
    FROM media_items
    WHERE ${filter}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `)
  const activityHeatmap: HeatmapCell[] = (heatmapRows as Row[]).map((row) => ({
    day: Number(row.day ?? 0),
    hour: Number(row.hour ?? 0),
    total: Number(row.total ?? 0),
  }))

  return {
    stats: {
      totalItems: total,
      negativeItems: negative,
      positiveItems: positive,
      neutralItems: neutral,
      negativeRatio: total > 0 ? Number(((negative / total) * 100).toFixed(2)) : 0,
      positiveRatio: total > 0 ? Number(((positive / total) * 100).toFixed(2)) : 0,
      neutralRatio: total > 0 ? Number(((neutral / total) * 100).toFixed(2)) : 0,
      activeSources: Number(stats.active_sources ?? 0),
      activeClusters: Number(((clusterRows[0] ?? {}) as Row).total ?? 0),
      activeAlerts: Number(alertStats.active ?? 0),
      criticalAlerts: Number(alertStats.critical ?? 0),
      volumeChangePct:
        previousTotal > 0
          ? Number((((total - previousTotal) / previousTotal) * 100).toFixed(2))
          : total > 0
            ? 100
            : 0,
      baselineVolume: previousTotal,
      currentVolume: total,
    },
    sentimentTrend: [...trendMap.values()],
    shareOfVoice,
    platformVolume,
    topEntities,
    activityHeatmap,
    range: { from: iso(range.from), to: iso(range.to), bucket },
  }
}
