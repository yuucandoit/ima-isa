import { sql } from 'drizzle-orm'
import type { ClusterDTO, ClusterDetail, MediaItemDTO } from '@media-intel/types'
import { db } from '../../db'
import { getPublisher } from '../../lib/redis'
import { generateClusterSummary } from '../../lib/summarizer'
import { toClusterDTO, toMediaItemDTO } from '../../lib/serialize'
import { sseHub } from '../../lib/sse'

type Row = Record<string, unknown>

const CLUSTER_SELECT = sql`
  SELECT
    c.*,
    (
      SELECT count(DISTINCT mi.source_id)
      FROM cluster_items ci JOIN media_items mi ON mi.id = ci.media_item_id
      WHERE ci.cluster_id = c.id
    )::int AS source_count,
    COALESCE((
      SELECT json_agg(DISTINCT s.name)
      FROM cluster_items ci
      JOIN media_items mi ON mi.id = ci.media_item_id
      LEFT JOIN sources s ON s.id = mi.source_id
      WHERE ci.cluster_id = c.id
    ), '[]'::json) AS sources,
    COALESCE((
      SELECT json_agg(t.title)
      FROM (
        SELECT mi.title
        FROM cluster_items ci JOIN media_items mi ON mi.id = ci.media_item_id
        WHERE ci.cluster_id = c.id
        ORDER BY mi.published_at DESC
        LIMIT 3
      ) t
    ), '[]'::json) AS sample_headlines
  FROM topic_clusters c
`

export async function listClusters(limit = 20, minArticles = 5): Promise<ClusterDTO[]> {
  const rows = await db.execute(sql`
    ${CLUSTER_SELECT}
    WHERE c.total_articles >= ${minArticles}
    ORDER BY c.last_updated DESC
    LIMIT ${limit}
  `)
  return (rows as Row[]).map((row) => toClusterDTO(row as never))
}

export async function getCluster(id: string): Promise<ClusterDTO | null> {
  const rows = await db.execute(sql`
    ${CLUSTER_SELECT}
    WHERE c.id = ${id}::uuid
    LIMIT 1
  `)
  const row = (rows as Row[])[0]
  return row ? toClusterDTO(row as never) : null
}

export async function getClusterArticles(id: string, limit = 50): Promise<MediaItemDTO[]> {
  const rows = await db.execute(sql`
    SELECT mi.*, s.name AS source_name, s.domain AS source_domain
    FROM cluster_items ci
    JOIN media_items mi ON mi.id = ci.media_item_id
    LEFT JOIN sources s ON s.id = mi.source_id
    WHERE ci.cluster_id = ${id}::uuid
    ORDER BY mi.published_at DESC
    LIMIT ${limit}
  `)
  return (rows as Row[]).map((row) => toMediaItemDTO(row as never))
}

export async function getClusterDetail(id: string): Promise<ClusterDetail | null> {
  const cluster = await getCluster(id)
  if (!cluster) return null
  const articles = await getClusterArticles(id)
  return { cluster, articles }
}

export async function summarizeCluster(
  id: string,
  refresh = false,
): Promise<{
  summary: string
  model: string
  provider: string
  generatedAt: string
  cached: boolean
} | null> {
  const detail = await getClusterDetail(id)
  if (!detail) return null

  if (detail.cluster.summary && !refresh) {
    return {
      summary: detail.cluster.summary,
      model: 'cached',
      provider: 'cached',
      generatedAt: detail.cluster.lastUpdated,
      cached: true,
    }
  }

  if (detail.articles.length < 5) {
    throw Object.assign(new Error('Klaster membutuhkan minimal 5 artikel untuk diringkas.'), {
      status: 422,
    })
  }

  const result = await generateClusterSummary(detail.cluster, detail.articles)
  await db.execute(sql`
    UPDATE topic_clusters SET summary = ${result.summary}, last_updated = now()
    WHERE id = ${id}::uuid
  `)

  const payload = {
    clusterId: id,
    title: detail.cluster.title,
    model: result.model,
    provider: result.provider,
    fallback: result.fallback,
    generatedAt: new Date().toISOString(),
  }
  sseHub.broadcast('cluster', payload, 'clusters')
  await getPublisher()?.publish('clusters:updated', JSON.stringify(payload)).catch(() => 0)

  return {
    summary: result.summary,
    model: result.model,
    provider: result.provider,
    generatedAt: payload.generatedAt,
    cached: false,
  }
}

/** Enqueue a clustering job consumed by `services/worker-ai/cluster_worker.py`. */
export async function queueRecluster(): Promise<boolean> {
  const publisher = getPublisher()
  if (!publisher) return false
  try {
    await publisher.xadd('cluster:jobs', '*', 'action', 'recluster')
    return true
  } catch {
    return false
  }
}
