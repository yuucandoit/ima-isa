import { sql } from 'drizzle-orm'
import type { SystemStatus } from '@media-intel/types'
import { db, checkDatabase } from '../../db'
import { env } from '../../lib/env'
import { llmStatus, llmSummary } from '../../lib/llm'
import { getPublisher, getRedisStatus } from '../../lib/redis'

type Row = Record<string, unknown>

export async function getSystemStatus(): Promise<SystemStatus> {
  const databaseOk = await checkDatabase()
  const redis = getRedisStatus()
  const llmState = await llmStatus()
  const llm = llmSummary()

  let counts: SystemStatus['counts'] = {
    sources: 0,
    mediaItems: 0,
    clusters: 0,
    alerts: 0,
    keywords: 0,
  }
  let lastProcessedAt: string | null = null

  if (databaseOk) {
    const rows = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM sources) AS sources,
        (SELECT count(*)::int FROM media_items) AS media_items,
        (SELECT count(*)::int FROM topic_clusters) AS clusters,
        (SELECT count(*)::int FROM alerts) AS alerts,
        (SELECT count(*)::int FROM monitored_keywords) AS keywords,
        (SELECT max(processed_at) FROM media_items) AS last_processed
    `)
    const row = (rows[0] ?? {}) as Row
    counts = {
      sources: Number(row.sources ?? 0),
      mediaItems: Number(row.media_items ?? 0),
      clusters: Number(row.clusters ?? 0),
      alerts: Number(row.alerts ?? 0),
      keywords: Number(row.keywords ?? 0),
    }
    lastProcessedAt = row.last_processed
      ? new Date(row.last_processed as string).toISOString()
      : null
  }

  let backlog = 0
  const publisher = getPublisher()
  if (publisher && redis.status === 'ok') {
    try {
      backlog = await publisher.xlen('media:raw')
    } catch {
      backlog = 0
    }
  }

  return {
    api: 'ok',
    database: databaseOk ? 'ok' : 'error',
    redis: redis.status,
    llm: llmState,
    llmProvider: llm.provider === 'none' ? 'disabled' : llm.provider,
    worker: {
      lastProcessedAt,
      backlog,
      consumerGroup: env.workerGroup,
    },
    counts,
    versions: {
      api: '0.1.0',
      model: llm.model || '—',
      provider: llm.provider === 'none' ? 'disabled' : llm.provider,
    },
  }
}
