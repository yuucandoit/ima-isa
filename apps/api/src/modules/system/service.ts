import { sql } from 'drizzle-orm'
import type { SystemStatus } from '@media-intel/types'
import { db, checkDatabase } from '../../db'
import { env } from '../../lib/env'
import { llmStatus, llmSummary } from '../../lib/llm'
import { getPublisher, getRedisStatus } from '../../lib/redis'

type Row = Record<string, unknown>

/** Stream yang dikonsumsi `services/worker-ai/clipping/worker.py`. */
const CLIP_STREAMS = [
  'clip:ingest',
  'clip:render',
  'clip:distribute',
  'clip:boost',
  'clip:track',
] as const

/** Prefix key heartbeat yang ditulis `clipping/worker.py` (satu per PID). */
export const CLIP_HEARTBEAT_KEY = 'clipping:worker:heartbeat'

/** Heartbeat lebih tua dari ini → worker dianggap mati. */
const CLIP_HEARTBEAT_STALE_SECONDS = 60

interface ClipHeartbeat {
  at: string
  pid: number
  host: string
  dryRun: boolean
  whisper: boolean
  ytdlp: boolean
  librosa: boolean
  ffmpeg: boolean
  adb: boolean
}

function parseHeartbeat(raw: string | null): ClipHeartbeat | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ClipHeartbeat
    return typeof parsed.at === 'string' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Ringkas kesehatan pipeline kliping.
 *
 * Tiga sinyal yang dipakai:
 *  1. **Job menunggu** — `lag` + `pending` dari consumer group. `XLEN` TIDAK
 *     dipakai karena menghitung entri yang sudah di-ACK, sehingga antrean
 *     kosong tetap terlihat penuh selamanya.
 *  2. **Heartbeat worker** — worker menulis JSON tiap 15 detik berisi
 *     dependensi yang benar-benar tersedia.
 *  3. **Antrean tanpa consumer** (group belum ada) — semua entri dianggap
 *     menunggu.
 *
 * Tanpa ini dashboard hanya menampilkan `pending` selamanya dan pengguna
 * tidak tahu apakah job sedang diproses atau worker-nya mati.
 */
async function readClippingHealth(
  client: NonNullable<ReturnType<typeof getPublisher>>,
): Promise<SystemStatus['clipping']> {
  const queues: Record<string, number> = {}
  let pending = 0

  for (const stream of CLIP_STREAMS) {
    try {
      const groups = (await client
        .xinfo('GROUPS', stream)
        .catch(() => [] as unknown[])) as Array<Record<string, unknown>>
      const group = groups[0]
      if (!group) {
        // Belum ada consumer group: semua entri masih menunggu.
        const length = Number(await client.xlen(stream)) || 0
        queues[stream] = length
        pending += length
        continue
      }
      // `lag` = entri belum terkirim ke consumer mana pun.
      // `pending` = sudah terkirim tapi belum di-ACK (sedang dikerjakan).
      const lag = Number(group.lag ?? 0) || 0
      const inflight = Number(group.pending ?? 0) || 0
      const waiting = Math.max(0, lag)
      queues[stream] = waiting
      pending += waiting + inflight
    } catch {
      queues[stream] = 0
    }
  }

  const heartbeatAgeSeconds = await readHeartbeatAge(client)

  const worker: 'online' | 'idle' | 'offline' =
    heartbeatAgeSeconds === null
      ? 'offline'
      : heartbeatAgeSeconds <= CLIP_HEARTBEAT_STALE_SECONDS
        ? 'online'
        : 'idle'

  const missingDependencies = await readMissingDependencies(client)

  return {
    queues,
    pending,
    worker,
    lastActiveSeconds: heartbeatAgeSeconds,
    dryRun: await readDryRun(client),
    missingDependencies,
  }
}

/** Baca semua heartbeat instance worker dan kembalikan umur yang paling segar. */
async function readHeartbeatAge(
  client: NonNullable<ReturnType<typeof getPublisher>>,
): Promise<number | null> {
  try {
    const keys = await scanKeys(client, `${CLIP_HEARTBEAT_KEY}:*`)
    if (keys.length === 0) return null
    const values = await client.mget(...keys)
    let freshest: number | null = null
    for (const raw of values) {
      const heartbeat = parseHeartbeat(raw)
      if (!heartbeat) continue
      const age = Math.max(0, Math.round((Date.now() - Date.parse(heartbeat.at)) / 1000))
      if (freshest === null || age < freshest) freshest = age
    }
    return freshest
  } catch {
    return null
  }
}

async function readLatestHeartbeat(
  client: NonNullable<ReturnType<typeof getPublisher>>,
): Promise<ClipHeartbeat | null> {
  try {
    const keys = await scanKeys(client, `${CLIP_HEARTBEAT_KEY}:*`)
    if (keys.length === 0) return null
    const values = await client.mget(...keys)
    let best: { heartbeat: ClipHeartbeat; at: number } | null = null
    for (const raw of values) {
      const heartbeat = parseHeartbeat(raw)
      if (!heartbeat) continue
      const at = Date.parse(heartbeat.at)
      if (!best || at > best.at) best = { heartbeat, at }
    }
    return best?.heartbeat ?? null
  } catch {
    return null
  }
}

async function readDryRun(
  client: NonNullable<ReturnType<typeof getPublisher>>,
): Promise<boolean> {
  const heartbeat = await readLatestHeartbeat(client)
  return heartbeat?.dryRun ?? false
}

/** Dependensi yang hilang menurut heartbeat terbaru. */
async function readMissingDependencies(
  client: NonNullable<ReturnType<typeof getPublisher>>,
): Promise<string[]> {
  const heartbeat = await readLatestHeartbeat(client)
  if (!heartbeat) return []
  const missing: string[] = []
  if (!heartbeat.ytdlp && !heartbeat.dryRun) missing.push('yt-dlp')
  if (!heartbeat.whisper && !heartbeat.dryRun) missing.push('faster-whisper')
  if (!heartbeat.librosa) missing.push('librosa')
  if (!heartbeat.ffmpeg && !heartbeat.dryRun) missing.push('ffmpeg')
  if (!heartbeat.adb && !heartbeat.dryRun) missing.push('adb')
  return missing
}

/** `SCAN` kecil; hindari `KEYS` yang memblokir Redis di dataset besar. */
async function scanKeys(
  client: NonNullable<ReturnType<typeof getPublisher>>,
  pattern: string,
): Promise<string[]> {
  const keys: string[] = []
  let cursor = '0'
  do {
    const [next, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
    cursor = next
    keys.push(...(batch as string[]))
    if (keys.length > 500) break
  } while (cursor !== '0')
  return keys
}

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

  const clipping =
    publisher && redis.status === 'ok' ? await readClippingHealth(publisher) : null

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
    clipping,
    counts,
    versions: {
      api: '0.1.0',
      model: llm.model || '—',
      provider: llm.provider === 'none' ? 'disabled' : llm.provider,
    },
  }
}
