import { sql } from 'drizzle-orm'
import type { FeedQuery, MediaItemDTO, Paginated } from '@media-intel/types'
import { db } from '../../db'
import { buildMediaFilter, resolveRange } from '../../lib/filters'
import { toMediaItemDTO } from '../../lib/serialize'

type Row = Record<string, unknown>

export async function listFeeds(query: FeedQuery): Promise<Paginated<MediaItemDTO>> {
  const page = Math.max(1, Math.floor(query.page ?? 1))
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 20)))
  const offset = (page - 1) * limit
  const range = resolveRange(query, 7)
  const filter = buildMediaFilter(query, range)

  const [rows, countRows] = await Promise.all([
    db.execute(sql`
      SELECT
        media_items.*,
        s.name AS source_name,
        s.domain AS source_domain
      FROM media_items
      LEFT JOIN sources s ON s.id = media_items.source_id
      WHERE ${filter}
      ORDER BY media_items.published_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT count(*)::int AS total
      FROM media_items
      LEFT JOIN sources s ON s.id = media_items.source_id
      WHERE ${filter}
    `),
  ])

  const total = Number(((countRows[0] ?? {}) as Row).total ?? 0)
  return {
    data: (rows as Row[]).map((row) => toMediaItemDTO(row as never)),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  }
}

export async function getFeedById(id: string): Promise<MediaItemDTO | null> {
  const rows = await db.execute(sql`
    SELECT media_items.*, s.name AS source_name, s.domain AS source_domain
    FROM media_items
    LEFT JOIN sources s ON s.id = media_items.source_id
    WHERE media_items.id = ${id}::uuid
    LIMIT 1
  `)
  const row = (rows as Row[])[0]
  return row ? toMediaItemDTO(row as never) : null
}

export interface FeedStats {
  positive: number
  neutral: number
  negative: number
}

export async function getFeedBreakdown(query: FeedQuery): Promise<FeedStats> {
  const range = resolveRange(query, 7)
  const filter = buildMediaFilter(query, range)
  const rows = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE sentiment = 'POSITIVE')::int AS positive,
      count(*) FILTER (WHERE sentiment = 'NEUTRAL')::int AS neutral,
      count(*) FILTER (WHERE sentiment = 'NEGATIVE')::int AS negative
    FROM media_items
    WHERE ${filter}
  `)
  const row = (rows[0] ?? {}) as Row
  return {
    positive: Number(row.positive ?? 0),
    neutral: Number(row.neutral ?? 0),
    negative: Number(row.negative ?? 0),
  }
}
