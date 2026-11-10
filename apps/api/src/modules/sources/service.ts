import { sql } from 'drizzle-orm'
import type { SourceDTO } from '@media-intel/types'
import { db } from '../../db'
import { toSourceDTO } from '../../lib/serialize'

type Row = Record<string, unknown>

export async function listSources(): Promise<SourceDTO[]> {
  const rows = await db.execute(sql`
    SELECT
      s.id,
      s.name,
      s.domain,
      s.platform,
      s.rss_url,
      s.is_active,
      s.created_at,
      (
        SELECT count(*)::int FROM media_items mi WHERE mi.source_id = s.id
      ) AS total_items
    FROM sources s
    ORDER BY s.name ASC
  `)
  return (rows as Row[]).map((row) =>
    toSourceDTO({
      id: row.id as string,
      name: row.name as string,
      domain: row.domain as string,
      platform: row.platform as string,
      rssUrl: (row.rss_url as string | null) ?? null,
      isActive: row.is_active as string,
      createdAt: row.created_at as Date,
      totalItems: row.total_items as number,
    }),
  )
}

export async function setSourceActive(id: string, isActive: boolean): Promise<SourceDTO | null> {
  const rows = await db.execute(sql`
    UPDATE sources SET is_active = ${String(isActive)}
    WHERE id = ${id}::uuid
    RETURNING *
  `)
  const row = (rows as Row[])[0]
  if (!row) return null
  return toSourceDTO({
    id: row.id as string,
    name: row.name as string,
    domain: row.domain as string,
    platform: row.platform as string,
    rssUrl: (row.rss_url as string | null) ?? null,
    isActive: row.is_active as string,
    createdAt: row.created_at as Date,
  })
}
