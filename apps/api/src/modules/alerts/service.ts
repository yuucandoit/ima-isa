import { sql } from 'drizzle-orm'
import type { AlertDTO, AlertSeverity, Paginated } from '@media-intel/types'
import { db } from '../../db'
import { booleanAstToSql, parseBooleanQuery } from '../../lib/boolean'
import { env } from '../../lib/env'
import { dispatchAlertNotifications } from '../../lib/notify'
import { publish } from '../../lib/redis'
import { sseHub } from '../../lib/sse'
import { toAlertDTO } from '../../lib/serialize'

type Row = Record<string, unknown>

const RECENT_WINDOW_MINUTES = 30
const BASELINE_WINDOW_HOURS = 6

export interface SpikeScanResult {
  scanned: number
  triggered: number
  alerts: AlertDTO[]
}

interface KeywordRow {
  id: string
  label: string
  boolean_query: string
}

/**
 * Spike detector — the heart of the crisis engine.
 *
 * Trigger when, for an active keyword:
 *  - volume in the last 30 min > 2.5× the per-30-min baseline, or
 *  - negative share in the last 30 min >= 65%,
 * with at least 5 recent articles and a 30-minute cooldown per keyword.
 */
export async function scanForSpikes(): Promise<SpikeScanResult> {
  const now = new Date()
  const recentFrom = new Date(now.getTime() - RECENT_WINDOW_MINUTES * 60 * 1000)
  const baselineFrom = new Date(now.getTime() - BASELINE_WINDOW_HOURS * 60 * 60 * 1000)
  const baselineBuckets = (BASELINE_WINDOW_HOURS * 60) / RECENT_WINDOW_MINUTES

  const keywordRows = await db.execute(sql`
    SELECT id, label, boolean_query FROM monitored_keywords WHERE is_active = 'true' ORDER BY created_at ASC
  `)

  const triggered: AlertDTO[] = []

  for (const keyword of keywordRows as unknown as KeywordRow[]) {
    let ast
    try {
      ast = parseBooleanQuery(keyword.boolean_query)
    } catch {
      continue
    }
    const predicate = booleanAstToSql(ast)

    const [recentRows, baselineRows, cooldownRows] = await Promise.all([
      db.execute(sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE sentiment = 'NEGATIVE')::int AS negative,
          count(*) FILTER (WHERE sentiment = 'POSITIVE')::int AS positive
        FROM media_items
        WHERE published_at >= ${recentFrom.toISOString()}
          AND published_at <= ${now.toISOString()}
          AND ${predicate}
      `),
      db.execute(sql`
        SELECT count(*)::int AS total
        FROM media_items
        WHERE published_at >= ${baselineFrom.toISOString()}
          AND published_at < ${recentFrom.toISOString()}
          AND ${predicate}
      `),
      db.execute(sql`
        SELECT count(*)::int AS total
        FROM alerts
        WHERE keyword_id = ${keyword.id}::uuid
          AND triggered_at >= ${new Date(now.getTime() - 30 * 60 * 1000).toISOString()}
          AND is_resolved = 'false'
      `),
    ])

    if (Number(((cooldownRows[0] ?? {}) as Row).total ?? 0) > 0) continue

    const recent = (recentRows[0] ?? {}) as Row
    const recentTotal = Number(recent.total ?? 0)
    if (recentTotal < 5) continue

    const negative = Number(recent.negative ?? 0)
    const baselineTotal = Number(((baselineRows[0] ?? {}) as Row).total ?? 0)
    const baselinePerBucket = baselineTotal / baselineBuckets
    const ratio = baselinePerBucket > 0 ? recentTotal / baselinePerBucket : recentTotal
    const volumeIncreasePct =
      baselinePerBucket > 0
        ? Number((((recentTotal - baselinePerBucket) / baselinePerBucket) * 100).toFixed(1))
        : 100
    const negativeRatio = Number((negative / recentTotal).toFixed(3))

    const volumeSpike = ratio >= env.alertVolumeMultiplier
    const sentimentSpike = negativeRatio >= env.alertNegativeRatio
    if (!volumeSpike && !sentimentSpike) continue

    const severity: AlertSeverity =
      ratio >= 5 || negativeRatio >= 0.8 ? 'CRITICAL' : 'HIGH'

    const sampleRows = await db.execute(sql`
      SELECT title, sentiment FROM media_items
      WHERE published_at >= ${recentFrom.toISOString()}
        AND published_at <= ${now.toISOString()}
        AND ${predicate}
      ORDER BY
        CASE sentiment WHEN 'NEGATIVE' THEN 0 WHEN 'NEUTRAL' THEN 1 ELSE 2 END,
        published_at DESC
      LIMIT 4
    `)
    const sampleHeadlines = (sampleRows as Row[]).map((row) => String(row.title))

    const title = `Lonjakan isu: ${keyword.label}`
    const description = sentimentSpike && !volumeSpike
      ? `Sentimen negatif menembus ${(negativeRatio * 100).toFixed(0)}% dari ${recentTotal} artikel dalam 30 menit terakhir. Baseline volume ${baselinePerBucket.toFixed(1)} artikel/30 menit.`
      : `Volume pembicaraan melonjak ${volumeIncreasePct.toFixed(0)}% dalam 30 menit terakhir (${recentTotal} artikel vs baseline ${baselinePerBucket.toFixed(1)}). Rasio negatif ${(negativeRatio * 100).toFixed(0)}%.`

    const metricsSnapshot = {
      volumeIncreasePct,
      negativeRatio,
      sampleHeadlines,
      recentVolume: recentTotal,
      baselineVolume: Number(baselinePerBucket.toFixed(2)),
      keywordLabel: keyword.label,
    }

    const inserted = await db.execute(sql`
      INSERT INTO alerts (keyword_id, title, description, severity, metrics_snapshot, is_resolved)
      VALUES (
        ${keyword.id}::uuid, ${title}, ${description},
        ${severity}::alert_severity, ${JSON.stringify(metricsSnapshot)}::jsonb, 'false'
      )
      RETURNING *
    `)
    const row = (inserted as Row[])[0]
    if (!row) continue

    const alert = toAlertDTO({
      id: row.id as string,
      keywordId: row.keyword_id as string,
      keywordLabel: keyword.label,
      title: row.title as string,
      description: row.description as string,
      severity: row.severity as string,
      metricsSnapshot,
      isResolved: row.is_resolved as string,
      triggeredAt: row.triggered_at as Date,
    })

    triggered.push(alert)
    const event = {
      id: alert.id,
      title: alert.title,
      severity: alert.severity,
      description: alert.description,
      triggeredAt: alert.triggeredAt,
    }
    sseHub.broadcast('alert', event, 'alerts')
    sseHub.broadcast('alert', event, 'overview')
    await publish('alerts:new', event)
    await dispatchAlertNotifications({
      title: alert.title,
      description: alert.description,
      severity: alert.severity,
      triggeredAt: alert.triggeredAt,
    })
  }

  return { scanned: (keywordRows as Row[]).length, triggered: triggered.length, alerts: triggered }
}

export interface AlertListQuery {
  page?: number
  limit?: number
  severity?: AlertSeverity
  resolved?: boolean
  keywordId?: string
}

export async function listAlerts(query: AlertListQuery): Promise<Paginated<AlertDTO>> {
  const page = Math.max(1, Math.floor(query.page ?? 1))
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 20)))
  const offset = (page - 1) * limit

  const conditions = [sql`1 = 1`]
  if (query.severity) conditions.push(sql`a.severity = ${query.severity}::alert_severity`)
  if (query.resolved !== undefined) conditions.push(sql`a.is_resolved = ${String(query.resolved)}`)
  if (query.keywordId) conditions.push(sql`a.keyword_id = ${query.keywordId}::uuid`)
  const where = conditions.reduce((left, right) => sql`${left} AND ${right}`)

  const [rows, countRows] = await Promise.all([
    db.execute(sql`
      SELECT a.*, k.label AS keyword_label
      FROM alerts a
      LEFT JOIN monitored_keywords k ON k.id = a.keyword_id
      WHERE ${where}
      ORDER BY a.triggered_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT count(*)::int AS total FROM alerts a WHERE ${where}
    `),
  ])

  const total = Number(((countRows[0] ?? {}) as Row).total ?? 0)
  return {
    data: (rows as Row[]).map((row) =>
      toAlertDTO({
        id: row.id as string,
        keywordId: (row.keyword_id as string | null) ?? null,
        keywordLabel: (row.keyword_label as string | null) ?? null,
        title: row.title as string,
        description: row.description as string,
        severity: row.severity as string,
        metricsSnapshot: row.metrics_snapshot as AlertDTO['metricsSnapshot'],
        isResolved: row.is_resolved as string,
        triggeredAt: row.triggered_at as Date,
      }),
    ),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  }
}

export async function setAlertResolved(id: string, isResolved: boolean): Promise<AlertDTO | null> {
  const rows = await db.execute(sql`
    UPDATE alerts SET is_resolved = ${String(isResolved)}
    WHERE id = ${id}::uuid
    RETURNING *
  `)
  const row = (rows as Row[])[0]
  if (!row) return null
  return toAlertDTO({
    id: row.id as string,
    keywordId: (row.keyword_id as string | null) ?? null,
    title: row.title as string,
    description: row.description as string,
    severity: row.severity as string,
    metricsSnapshot: row.metrics_snapshot as AlertDTO['metricsSnapshot'],
    isResolved: row.is_resolved as string,
    triggeredAt: row.triggered_at as Date,
  })
}
