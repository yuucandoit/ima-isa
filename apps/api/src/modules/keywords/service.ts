import { sql } from 'drizzle-orm'
import type { KeywordDTO } from '@media-intel/types'
import { db } from '../../db'
import { booleanAstToSql, parseBooleanQuery } from '../../lib/boolean'
import { toKeywordDTO } from '../../lib/serialize'
import { resolveRange } from '../../lib/filters'

type Row = Record<string, unknown>

export async function listKeywords(withMatches = false): Promise<KeywordDTO[]> {
  const rows = await db.execute(sql`
    SELECT * FROM monitored_keywords ORDER BY created_at ASC
  `)
  const range = resolveRange({}, 7)

  return Promise.all(
    (rows as Row[]).map(async (row) => {
      let matches: number | undefined
      if (withMatches) {
        try {
          const ast = parseBooleanQuery(String(row.boolean_query))
          const result = await db.execute(sql`
            SELECT count(*)::int AS total FROM media_items
            WHERE published_at >= ${range.from.toISOString()}
              AND published_at <= ${range.to.toISOString()}
              AND ${booleanAstToSql(ast)}
          `)
          matches = Number(((result[0] ?? {}) as Row).total ?? 0)
        } catch {
          matches = 0
        }
      }
      return toKeywordDTO({
        id: row.id as string,
        label: row.label as string,
        booleanQuery: row.boolean_query as string,
        isActive: row.is_active as string,
        createdAt: row.created_at as Date,
        matches,
      })
    }),
  )
}

export async function getKeywordQuery(id: string): Promise<string | null> {
  const rows = await db.execute(sql`
    SELECT boolean_query FROM monitored_keywords
    WHERE id = ${id}::uuid AND is_active = 'true'
    LIMIT 1
  `)
  const row = (rows as Row[])[0]
  return row ? String(row.boolean_query) : null
}

export async function getKeywordRow(id: string): Promise<KeywordDTO | null> {
  const rows = await db.execute(sql`SELECT * FROM monitored_keywords WHERE id = ${id}::uuid LIMIT 1`)
  const row = (rows as Row[])[0]
  if (!row) return null
  return toKeywordDTO({
    id: row.id as string,
    label: row.label as string,
    booleanQuery: row.boolean_query as string,
    isActive: row.is_active as string,
    createdAt: row.created_at as Date,
  })
}

export async function createKeyword(input: {
  label: string
  booleanQuery: string
  isActive?: boolean
}): Promise<KeywordDTO> {
  const rows = await db.execute(sql`
    INSERT INTO monitored_keywords (label, boolean_query, is_active)
    VALUES (${input.label}, ${input.booleanQuery}, ${String(input.isActive ?? true)})
    RETURNING *
  `)
  const row = (rows as Row[])[0]!
  return toKeywordDTO({
    id: row.id as string,
    label: row.label as string,
    booleanQuery: row.boolean_query as string,
    isActive: row.is_active as string,
    createdAt: row.created_at as Date,
  })
}

export async function updateKeyword(
  id: string,
  input: { label?: string; booleanQuery?: string; isActive?: boolean },
): Promise<KeywordDTO | null> {
  const current = await getKeywordRow(id)
  if (!current) return null
  const rows = await db.execute(sql`
    UPDATE monitored_keywords SET
      label = ${input.label ?? current.label},
      boolean_query = ${input.booleanQuery ?? current.booleanQuery},
      is_active = ${String(input.isActive ?? current.isActive)}
    WHERE id = ${id}::uuid
    RETURNING *
  `)
  const row = (rows as Row[])[0]
  if (!row) return null
  return toKeywordDTO({
    id: row.id as string,
    label: row.label as string,
    booleanQuery: row.boolean_query as string,
    isActive: row.is_active as string,
    createdAt: row.created_at as Date,
  })
}

export async function deleteKeyword(id: string): Promise<boolean> {
  const rows = await db.execute(sql`
    DELETE FROM monitored_keywords WHERE id = ${id}::uuid RETURNING id
  `)
  return (rows as Row[]).length > 0
}
