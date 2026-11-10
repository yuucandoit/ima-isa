import { sql, type SQL } from 'drizzle-orm'
import type { SourcePlatform, SentimentLabel } from '@media-intel/types'
import { booleanAstToSql, parseBooleanQuery } from './boolean'

export interface RangeInput {
  from?: string
  to?: string
}

export interface ResolvedRange {
  from: Date
  to: Date
}

const DEFAULT_RANGE_DAYS = 7
const MAX_RANGE_DAYS = 90

export function resolveRange(input: RangeInput, defaultDays = DEFAULT_RANGE_DAYS): ResolvedRange {
  const to = input.to ? new Date(input.to) : new Date()
  const from = input.from
    ? new Date(input.from)
    : new Date(to.getTime() - defaultDays * 24 * 60 * 60 * 1000)

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw Object.assign(new Error('Format tanggal tidak valid. Gunakan ISO 8601.'), { status: 400 })
  }
  if (from > to) {
    throw Object.assign(new Error('Rentang waktu terbalik: `from` harus sebelum `to`.'), {
      status: 400,
    })
  }
  const maxMs = MAX_RANGE_DAYS * 24 * 60 * 60 * 1000
  if (to.getTime() - from.getTime() > maxMs) {
    throw Object.assign(new Error(`Rentang waktu maksimum ${MAX_RANGE_DAYS} hari.`), {
      status: 400,
    })
  }
  return { from, to }
}

export interface MediaFilterInput extends RangeInput {
  sourceId?: string
  platform?: SourcePlatform
  sentiment?: SentimentLabel
  keywordId?: string
  keywordQuery?: string
  search?: string
}

/**
 * Compile filter input into a Drizzle predicate scoped to the `media_items mi`
 * alias so it can be shared by analytics, feeds and the spike scanner.
 */
export function buildMediaFilter(input: MediaFilterInput, range?: ResolvedRange): SQL {
  const resolved = range ?? resolveRange(input, DEFAULT_RANGE_DAYS)
  const conditions: SQL[] = [
    sql`media_items.published_at >= ${resolved.from.toISOString()}`,
    sql`media_items.published_at <= ${resolved.to.toISOString()}`,
  ]

  if (input.sourceId) conditions.push(sql`media_items.source_id = ${input.sourceId}::uuid`)
  if (input.platform) {
    conditions.push(sql`media_items.platform = ${input.platform}::source_platform`)
  }
  if (input.sentiment) {
    conditions.push(sql`media_items.sentiment = ${input.sentiment}::sentiment_label`)
  }

  if (input.search?.trim()) {
    const pattern = `%${input.search.trim().replace(/([\\%_])/g, '\\$1')}%`
    conditions.push(
      sql`(media_items.title ILIKE ${pattern} OR media_items.clean_content ILIKE ${pattern})`,
    )
  }

  const booleanQuery = input.keywordQuery?.trim()
  if (booleanQuery) {
    conditions.push(booleanAstToSql(parseBooleanQuery(booleanQuery)))
  }

  return conditions.reduce((left, right) => sql`${left} AND ${right}`)
}
