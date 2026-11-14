import { sql } from 'drizzle-orm'
import type {
  ClipDistributionDTO,
  ClipDistributionStatus,
  ClipRenderMode,
  ClipRenderProgressDTO,
  ClipSourceDTO,
  ClipSourceDetailDTO,
  ClipSourceStatus,
  ClippingAnalyticsSummary,
  GeneratedClipDTO,
  HeatmapPointDTO,
  TranscriptWordDTO,
} from '@media-intel/types'
import { db } from '../../db'
import { iso, isoOrNull } from '../../lib/serialize'
import { getPublisher, publish, publishJob } from '../../lib/redis'
import {
  downloadName,
  isVideoPath,
  parseRange,
  resolveMediaPath,
  videoMimeType,
} from './media'
import type {
  BoostInput,
  ClipSourceQuery,
  DistributionQuery,
  DistributeInput,
  IngestInput,
  RenderInput,
} from './dto'

type Row = Record<string, unknown>

/** Redis Streams consumed by `services/worker-ai/clipping/*`. */
export const CLIP_STREAMS = {
  ingest: 'clip:ingest',
  render: 'clip:render',
  distribute: 'clip:distribute',
  boost: 'clip:boost',
  track: 'clip:track',
} as const

const SUPPORTED_PLATFORMS = ['youtube', 'tiktok', 'instagram', 'twitter', 'x'] as const

export function detectPlatform(url: string): string {
  const lower = url.toLowerCase()
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube'
  if (lower.includes('tiktok.com')) return 'tiktok'
  if (lower.includes('instagram.com')) return 'instagram'
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter'
  return 'other'
}

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { status: 400 })
}

function notFound(message: string): never {
  throw Object.assign(new Error(message), { status: 404 })
}

/**
 * Validasi URL sumber. Hanya http(s) publik dan platform yang didukung
 * `downloader` worker yang diterima, supaya worker tidak pernah menerima
 * `file://` atau host internal.
 */
export function normalizeSourceUrl(raw: string): { url: string; platform: string } {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    badRequest('URL tidak valid. Tempel tautan lengkap (https://…).')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    badRequest('Hanya URL http/https yang didukung.')
  }
  const platform = detectPlatform(parsed.toString())
  if (!SUPPORTED_PLATFORMS.includes(platform as (typeof SUPPORTED_PLATFORMS)[number])) {
    badRequest('Platform belum didukung. Gunakan YouTube, TikTok, Instagram, atau X.')
  }
  parsed.hash = ''
  return { url: parsed.toString(), platform }
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value)
}

function strOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function toSourceDTO(row: Row): ClipSourceDTO {
  const transcript = (row.transcript_json as TranscriptWordDTO[] | null) ?? []
  const heatmap = (row.heatmap_json as HeatmapPointDTO[] | null) ?? []
  const updatedAt = iso(row.updated_at as Date | string)
  return {
    id: num(row.id),
    url: String(row.url ?? ''),
    platform: String(row.platform ?? 'other'),
    title: strOrNull(row.title),
    durationSeconds: numOrNull(row.duration_seconds),
    status: String(row.status ?? 'pending') as ClipSourceStatus,
    errorMessage: strOrNull(row.error_message),
    hasTranscript: transcript.length > 0 || row.has_transcript === true,
    hasHeatmap: heatmap.length > 0 || row.has_heatmap === true,
    transcriptWordCount: num(row.transcript_word_count ?? transcript.length),
    clipCount: num(row.clip_count),
    createdAt: iso(row.created_at as Date | string),
    updatedAt,
    statusAgeSeconds: Math.max(0, Math.round((Date.now() - Date.parse(updatedAt)) / 1000)),
  }
}

function toClipDTO(row: Row): GeneratedClipDTO {
  const start = num(row.start_time)
  const end = num(row.end_time)
  return {
    id: num(row.id),
    sourceId: num(row.source_id),
    sourceUrl: strOrNull(row.source_url),
    sourceTitle: strOrNull(row.source_title),
    titleHook: String(row.title_hook ?? ''),
    startTime: start,
    endTime: end,
    durationSeconds: Math.max(0, Number((end - start).toFixed(2))),
    viralityScore: num(row.virality_score),
    aiReasoning: strOrNull(row.ai_reasoning),
    renderMode: String(row.render_mode ?? 'split_screen') as ClipRenderMode,
    fillerAssetUsed: strOrNull(row.filler_asset_used),
    outputFilePath: strOrNull(row.output_file_path),
    videoUrl: mediaUrl('clip', num(row.id), row.output_file_path),
    fileHash: strOrNull(row.file_hash),
    isApproved: row.is_approved === true,
    createdAt: iso(row.created_at as Date | string),
    distributionCount: num(row.distribution_count),
    totalViews: num(row.total_views),
  }
}

function toDistributionDTO(row: Row): ClipDistributionDTO {
  return {
    id: num(row.id),
    clipId: num(row.clip_id),
    clipTitle: strOrNull(row.clip_title),
    targetPlatform: String(row.target_platform ?? ''),
    accountUsername: String(row.account_username ?? ''),
    deviceSerial: strOrNull(row.device_serial),
    mutatedFilePath: strOrNull(row.mutated_file_path),
    postUrl: strOrNull(row.post_url),
    status: String(row.status ?? 'queued') as ClipDistributionStatus,
    viewsCount: num(row.views_count),
    likesCount: num(row.likes_count),
    commentsCount: num(row.comments_count),
    sharesCount: num(row.shares_count),
    savesCount: num(row.saves_count),
    triggerCountApplied: num(row.trigger_count_applied),
    cpmRateIdr: num(row.cpm_rate_idr),
    estimatedRevenueIdr: num(row.estimated_revenue_idr),
    publishedAt: isoOrNull(row.published_at as Date | string | null),
    lastScrapedAt: isoOrNull(row.last_scraped_at as Date | string | null),
  }
}

/* ── Sources ───────────────────────────────────────────────── */

export async function listSources(query: ClipSourceQuery = {}): Promise<ClipSourceDTO[]> {
  const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit ?? 25))))
  const offset = Math.max(0, Math.floor(Number(query.offset ?? 0)))
  const statusFilter = query.status ? sql`AND s.status = ${query.status}::clip_source_status` : sql``
  const platformFilter = query.platform ? sql`AND s.platform = ${query.platform}` : sql``

  const rows = await db.execute(sql`
    SELECT
      s.id, s.url, s.platform, s.title, s.duration_seconds, s.status, s.error_message,
      s.created_at, s.updated_at,
      (s.transcript_json IS NOT NULL) AS has_transcript,
      (s.heatmap_json IS NOT NULL) AS has_heatmap,
      COALESCE(jsonb_array_length(s.transcript_json), 0) AS transcript_word_count,
      (SELECT count(*)::int FROM generated_clips c WHERE c.source_id = s.id) AS clip_count
    FROM clip_sources s
    WHERE true ${statusFilter} ${platformFilter}
    ORDER BY s.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)
  return (rows as Row[]).map(toSourceDTO)
}

export async function getSourceDetail(id: number): Promise<ClipSourceDetailDTO | null> {
  const rows = await db.execute(sql`
    SELECT
      s.*,
      COALESCE(jsonb_array_length(s.transcript_json), 0) AS transcript_word_count,
      (SELECT count(*)::int FROM generated_clips c WHERE c.source_id = s.id) AS clip_count
    FROM clip_sources s
    WHERE s.id = ${id}
    LIMIT 1
  `)
  const row = (rows as Row[])[0]
  if (!row) return null

  const clips = await listClips({ sourceId: id })
  return {
    ...toSourceDTO(row),
    sourceVideoUrl: mediaUrl('source', num(id), row.raw_file_path),
    transcript: (row.transcript_json as TranscriptWordDTO[] | null) ?? [],
    heatmap: (row.heatmap_json as HeatmapPointDTO[] | null) ?? [],
    clips,
  }
}

/** URL streaming untuk `<video src>`; `null` bila berkas belum ada di disk. */
function mediaUrl(kind: 'source' | 'clip', id: number, rawPath: unknown): string | null {
  if (!rawPath) return null
  return resolveMediaPath(String(rawPath)) ? `/api/clipping/${kind === 'source' ? 'sources' : 'clips'}/${id}/video` : null
}

/**
 * Lokasi berkas video untuk satu klip.
 *
 * `output_file_path` menyimpan path absolut di server; untuk browser kita
 * sediakan `videoUrl` yang sudah melalui endpoint streaming (mendukung Range).
 */
export async function getClipMedia(
  id: number,
): Promise<{ path: string; title: string; id: number } | null> {
  const rows = await db.execute(sql`
    SELECT id, title_hook, output_file_path
    FROM generated_clips
    WHERE id = ${id}
    LIMIT 1
  `)
  const row = (rows as Row[])[0]
  if (!row?.output_file_path) return null
  const path = resolveMediaPath(String(row.output_file_path))
  if (!path) return null
  return { path, title: String(row.title_hook ?? ''), id: num(row.id) }
}

/** Lokasi video sumber (hasil unduhan yt-dlp). */
export async function getSourceMedia(
  id: number,
): Promise<{ path: string; title: string; id: number } | null> {
  const rows = await db.execute(sql`
    SELECT id, title, raw_file_path FROM clip_sources WHERE id = ${id} LIMIT 1
  `)
  const row = (rows as Row[])[0]
  if (!row?.raw_file_path) return null
  const path = resolveMediaPath(String(row.raw_file_path))
  if (!path) return null
  return { path, title: String(row.title ?? `source-${id}`), id: num(row.id) }
}

export async function ingestSource(input: IngestInput): Promise<ClipSourceDTO> {
  const { url, platform } = normalizeSourceUrl(input.url)

  // Idempotensi ringan: sumber yang masih diproses / selesai untuk URL sama
  // dikembalikan apa adanya agar klik ganda tidak menggandakan unduhan.
  const existing = await db.execute(sql`
    SELECT
      s.id, s.url, s.platform, s.title, s.duration_seconds, s.status, s.error_message,
      s.created_at, s.updated_at,
      (s.transcript_json IS NOT NULL) AS has_transcript,
      (s.heatmap_json IS NOT NULL) AS has_heatmap,
      COALESCE(jsonb_array_length(s.transcript_json), 0) AS transcript_word_count,
      (SELECT count(*)::int FROM generated_clips c WHERE c.source_id = s.id) AS clip_count
    FROM clip_sources s
    WHERE s.url = ${url}
      AND s.created_at > now() - interval '24 hours'
      AND s.status IN ('pending','downloading','transcribing','analyzing','rendering','completed')
    ORDER BY s.created_at DESC
    LIMIT 1
  `)
  const duplicate = (existing as Row[])[0]
  if (duplicate) return toSourceDTO(duplicate)

  const inserted = await db.execute(sql`
    INSERT INTO clip_sources (url, platform, status)
    VALUES (${url}, ${platform}, 'pending')
    RETURNING
      id, url, platform, title, duration_seconds, status, error_message,
      created_at, updated_at,
      false AS has_transcript, false AS has_heatmap,
      0 AS transcript_word_count, 0 AS clip_count
  `)
  const row = (inserted as Row[])[0]!
  const dto = toSourceDTO(row)

  await publishJob(CLIP_STREAMS.ingest, {
    sourceId: dto.id,
    url: dto.url,
    platform: dto.platform,
    maxClips: input.maxClips ?? 8,
    language: input.language ?? null,
    renderMode: input.renderMode ?? 'split_screen',
    requestedAt: new Date().toISOString(),
  })

  return dto
}

export async function retrySource(id: number): Promise<ClipSourceDTO> {
  // Retry hanya untuk sumber yang benar-benar gagal. Tanpa guard ini, klik
  // ganda pada tombol ulangi memasukkan beberapa job identik ke `clip:ingest`,
  // dan worker memproses/menimpa sumber yang sama berulang kali.
  const rows = await db.execute(sql`
    UPDATE clip_sources
    SET status = 'pending', error_message = NULL, updated_at = now()
    WHERE id = ${id}
      AND status IN ('failed', 'completed')
    RETURNING
      id, url, platform, title, duration_seconds, status, error_message,
      created_at, updated_at,
      (transcript_json IS NOT NULL) AS has_transcript,
      (heatmap_json IS NOT NULL) AS has_heatmap,
      COALESCE(jsonb_array_length(transcript_json), 0) AS transcript_word_count,
      (SELECT count(*)::int FROM generated_clips c WHERE c.source_id = clip_sources.id) AS clip_count
  `)
  const row = (rows as Row[])[0]
  if (!row) {
    // Sudah berjalan / tidak ada: kembalikan state terkini agar UI tidak error
    // dan tidak membuat job duplikat.
    const existing = await getSourceDetail(id)
    if (!existing) notFound('Sumber klip tidak ditemukan.')
    const { transcript: _t, heatmap: _h, clips: _c, ...dto } = existing
    return dto
  }
  await publishJob(CLIP_STREAMS.ingest, {
    sourceId: id,
    url: row.url,
    platform: row.platform,
    maxClips: 8,
    requestedAt: new Date().toISOString(),
  })
  return toSourceDTO(row)
}

export async function deleteSource(id: number): Promise<{ success: boolean }> {
  const rows = await db.execute(sql`DELETE FROM clip_sources WHERE id = ${id} RETURNING id`)
  if (!(rows as Row[])[0]) notFound('Sumber klip tidak ditemukan.')
  return { success: true }
}

/* ── Clips ─────────────────────────────────────────────────── */

const RENDER_PROGRESS_PREFIX = 'clip:render:progress:'

async function attachRenderProgress(
  items: Array<{ clip: GeneratedClipDTO; sourceStatus?: string | null }>,
): Promise<GeneratedClipDTO[]> {
  const client = getPublisher()
  if (!client || items.length === 0) return items.map((item) => item.clip)
  try {
    const keys = items.map(({ clip }) => `${RENDER_PROGRESS_PREFIX}${clip.id}`)
    const values = await client.mget(...keys)
    const staleKeys: string[] = []

    const enriched = items.map(({ clip, sourceStatus }, index) => {
      const raw = values[index]
      if (!raw) return clip
      try {
        const parsed = JSON.parse(raw) as Partial<ClipRenderProgressDTO>
        const hashChanged =
          parsed.baselineFileHash !== undefined &&
          Boolean(clip.fileHash) &&
          clip.fileHash !== parsed.baselineFileHash
        const sourceDone = sourceStatus === 'completed' || sourceStatus === 'failed'
        if (sourceDone || hashChanged) {
          staleKeys.push(keys[index]!)
          return clip
        }
        if (typeof parsed.progress === 'number' && typeof parsed.stage === 'string') {
          return {
            ...clip,
            renderProgress: {
              stage: parsed.stage,
              progress: parsed.progress,
              label: typeof parsed.label === 'string' ? parsed.label : 'Merender klip…',
              updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
              baselineFileHash: parsed.baselineFileHash ?? null,
            },
          }
        }
      } catch {
        /* abaikan payload korup */
      }
      return clip
    })

    if (staleKeys.length > 0) {
      client.del(...staleKeys).catch(() => {})
    }
    return enriched
  } catch {
    return items.map((item) => item.clip)
  }
}

export async function listClips(
  options: { sourceId?: number; approvedOnly?: boolean; limit?: number; offset?: number } = {},
): Promise<GeneratedClipDTO[]> {
  const limit = Math.min(200, Math.max(1, Math.floor(Number(options.limit ?? 100))))
  const offset = Math.max(0, Math.floor(Number(options.offset ?? 0)))
  const sourceFilter = options.sourceId ? sql`AND c.source_id = ${options.sourceId}` : sql``
  const approvedFilter = options.approvedOnly ? sql`AND c.is_approved = true` : sql``

  const rows = await db.execute(sql`
    SELECT
      c.*,
      s.url AS source_url,
      s.title AS source_title,
      s.status AS source_status,
      (SELECT count(*)::int FROM clip_distributions d WHERE d.clip_id = c.id) AS distribution_count,
      (SELECT COALESCE(sum(d.views_count), 0)::int FROM clip_distributions d WHERE d.clip_id = c.id) AS total_views
    FROM generated_clips c
    JOIN clip_sources s ON s.id = c.source_id
    WHERE true ${sourceFilter} ${approvedFilter}
    ORDER BY c.virality_score DESC, c.start_time ASC
    LIMIT ${limit} OFFSET ${offset}
  `)
  return attachRenderProgress(
    (rows as Row[]).map((row) => ({
      clip: toClipDTO(row),
      sourceStatus: strOrNull(row.source_status),
    })),
  )
}

export async function getClip(id: number): Promise<GeneratedClipDTO | null> {
  const rows = await db.execute(sql`
    SELECT
      c.*,
      s.url AS source_url,
      s.title AS source_title,
      s.status AS source_status,
      (SELECT count(*)::int FROM clip_distributions d WHERE d.clip_id = c.id) AS distribution_count,
      (SELECT COALESCE(sum(d.views_count), 0)::int FROM clip_distributions d WHERE d.clip_id = c.id) AS total_views
    FROM generated_clips c
    JOIN clip_sources s ON s.id = c.source_id
    WHERE c.id = ${id}
    LIMIT 1
  `)
  const row = (rows as Row[])[0]
  if (!row) return null
  const [enriched] = await attachRenderProgress([
    { clip: toClipDTO(row), sourceStatus: strOrNull(row.source_status) },
  ])
  return enriched ?? null
}

export async function patchClip(
  id: number,
  patch: {
    titleHook?: string
    startTime?: number
    endTime?: number
    renderMode?: ClipRenderMode
    isApproved?: boolean
  },
): Promise<GeneratedClipDTO> {
  const current = await getClip(id)
  if (!current) notFound('Klip tidak ditemukan.')

  const start = patch.startTime ?? current.startTime
  const end = patch.endTime ?? current.endTime
  if (end <= start) badRequest('`endTime` harus lebih besar dari `startTime`.')
  if (end - start > 180) badRequest('Durasi klip maksimum 180 detik.')

  const rows = await db.execute(sql`
    UPDATE generated_clips SET
      title_hook = ${patch.titleHook ?? current.titleHook},
      start_time = ${start},
      end_time = ${end},
      render_mode = ${(patch.renderMode ?? current.renderMode)}::clip_render_mode,
      is_approved = ${patch.isApproved ?? current.isApproved}
    WHERE id = ${id}
    RETURNING id
  `)
  if (!(rows as Row[])[0]) notFound('Klip tidak ditemukan.')
  return (await getClip(id))!
}

export async function deleteClip(id: number): Promise<{ success: boolean }> {
  const rows = await db.execute(sql`DELETE FROM generated_clips WHERE id = ${id} RETURNING id`)
  if (!(rows as Row[])[0]) notFound('Klip tidak ditemukan.')
  return { success: true }
}

/** Publish pekerjaan render dan tandai sumber kembali ke status `rendering`. */
export async function requestRender(
  id: number,
  input: RenderInput = {},
): Promise<{ clip: GeneratedClipDTO; queued: boolean }> {
  const clip = await getClip(id)
  if (!clip) notFound('Klip tidak ditemukan.')

  const start = input.startTime ?? clip.startTime
  const end = input.endTime ?? clip.endTime
  if (end <= start) badRequest('`endTime` harus lebih besar dari `startTime`.')

  const renderMode = input.renderMode ?? clip.renderMode
  await db.execute(sql`
    UPDATE generated_clips SET
      start_time = ${start},
      end_time = ${end},
      render_mode = ${renderMode}::clip_render_mode,
      filler_asset_used = ${input.fillerAsset ?? clip.fillerAssetUsed}
    WHERE id = ${id}
  `)
  await db.execute(sql`
    UPDATE clip_sources SET status = 'rendering', updated_at = now() WHERE id = ${clip.sourceId}
  `)

  const queued = await publishJob(CLIP_STREAMS.render, {
    clipId: id,
    sourceId: clip.sourceId,
    startTime: start,
    endTime: end,
    renderMode,
    fillerAsset: input.fillerAsset ?? null,
    requestedAt: new Date().toISOString(),
  })

  if (queued) {
    const initial = {
      stage: 'queued',
      progress: 4,
      label: 'Menunggu antrean worker…',
      updatedAt: Date.now(),
      baselineFileHash: clip.fileHash,
    }
    const client = getPublisher()
    client
      ?.set(`${RENDER_PROGRESS_PREFIX}${id}`, JSON.stringify(initial), 'EX', 240)
      .catch(() => {})
    void publish('clips:updated', {
      type: 'clip',
      clipId: id,
      sourceId: clip.sourceId,
      ...initial,
    })
  }

  return { clip: (await getClip(id))!, queued }
}

/* ── Distribution ──────────────────────────────────────────── */

export async function listDistributions(
  query: DistributionQuery = {},
): Promise<ClipDistributionDTO[]> {
  const limit = Math.min(200, Math.max(1, Math.floor(Number(query.limit ?? 100))))
  const offset = Math.max(0, Math.floor(Number(query.offset ?? 0)))
  const statusFilter = query.status ? sql`AND d.status = ${query.status}::clip_dist_status` : sql``
  const clipFilter = query.clipId ? sql`AND d.clip_id = ${query.clipId}` : sql``
  const accountFilter = query.account ? sql`AND d.account_username = ${query.account}` : sql``

  const rows = await db.execute(sql`
    SELECT d.*, c.title_hook AS clip_title
    FROM clip_distributions d
    JOIN generated_clips c ON c.id = d.clip_id
    WHERE true ${statusFilter} ${clipFilter} ${accountFilter}
    ORDER BY d.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `)
  return (rows as Row[]).map(toDistributionDTO)
}

export async function distributeClip(
  clipId: number,
  input: DistributeInput,
): Promise<{ distributions: ClipDistributionDTO[]; queued: boolean }> {
  const clip = await getClip(clipId)
  if (!clip) notFound('Klip tidak ditemukan.')
  if (!clip.outputFilePath) {
    badRequest('Render klip terlebih dahulu sebelum mendistribusikan.')
  }

  const seen = new Set<string>()
  const rows: ClipDistributionDTO[] = []
  for (const account of input.accounts) {
    const key = `${account.targetPlatform}:${account.accountUsername.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)

    const inserted = await db.execute(sql`
      INSERT INTO clip_distributions (
        clip_id, target_platform, account_username, device_serial, cpm_rate_idr, status
      ) VALUES (
        ${clipId},
        ${account.targetPlatform},
        ${account.accountUsername},
        ${account.deviceSerial ?? null},
        ${Math.round(Number(account.cpmRateIdr ?? 0))},
        'queued'
      )
      RETURNING *
    `)
    const row = (inserted as Row[])[0]!
    rows.push(toDistributionDTO({ ...row, clip_title: clip.titleHook }))
  }

  if (rows.length === 0) badRequest('Tidak ada akun target yang valid.')

  const queued = await publishJob(CLIP_STREAMS.distribute, {
    clipId,
    distributionIds: rows.map((row) => row.id),
    enableViralTrigger: input.enableViralTrigger ?? true,
    watchTimePct: input.watchTimePct ?? 180,
    dripWindowMinutes: input.dripWindowMinutes ?? 120,
    requestedAt: new Date().toISOString(),
  })

  return { distributions: rows, queued }
}

export async function boostDistribution(
  id: number,
  input: BoostInput = {},
): Promise<{ distribution: ClipDistributionDTO; queued: boolean }> {
  const rows = await db.execute(sql`
    SELECT d.*, c.title_hook AS clip_title
    FROM clip_distributions d
    JOIN generated_clips c ON c.id = d.clip_id
    WHERE d.id = ${id}
    LIMIT 1
  `)
  const row = (rows as Row[])[0]
  if (!row) notFound('Distribusi tidak ditemukan.')
  if (!row.post_url) badRequest('Postingan belum memiliki URL; boost hanya untuk post terbit.')
  if (row.status === 'shadowbanned') {
    badRequest('Postingan terindikasi shadowban; boost dihentikan untuk evaluasi akun.')
  }

  const sessions = Math.round(Number(input.sessions ?? 10))
  await db.execute(sql`
    UPDATE clip_distributions
    SET status = 'boosting', trigger_count_applied = trigger_count_applied + ${sessions}
    WHERE id = ${id}
  `)

  const queued = await publishJob(CLIP_STREAMS.boost, {
    distributionId: id,
    postUrl: row.post_url,
    accountUsername: row.account_username,
    targetPlatform: row.target_platform,
    deviceSerial: row.device_serial,
    sessions,
    watchTimePct: input.watchTimePct ?? 180,
    searchKeyword: input.searchKeyword ?? null,
    requestedAt: new Date().toISOString(),
  })

  return { distribution: (await getDistribution(id))!, queued }
}

export async function getDistribution(id: number): Promise<ClipDistributionDTO | null> {
  const rows = await db.execute(sql`
    SELECT d.*, c.title_hook AS clip_title
    FROM clip_distributions d
    JOIN generated_clips c ON c.id = d.clip_id
    WHERE d.id = ${id}
    LIMIT 1
  `)
  const row = (rows as Row[])[0]
  return row ? toDistributionDTO(row) : null
}

export async function retryDistribution(
  id: number,
): Promise<{ distribution: ClipDistributionDTO; queued: boolean }> {
  const distribution = await getDistribution(id)
  if (!distribution) notFound('Distribusi tidak ditemukan.')
  if (distribution.status !== 'failed') {
    badRequest('Hanya distribusi berstatus `failed` yang bisa diulang.')
  }
  await db.execute(sql`UPDATE clip_distributions SET status = 'queued' WHERE id = ${id}`)
  const queued = await publishJob(CLIP_STREAMS.distribute, {
    clipId: distribution.clipId,
    distributionIds: [id],
    enableViralTrigger: true,
    watchTimePct: 180,
    dripWindowMinutes: 120,
    requestedAt: new Date().toISOString(),
  })
  return { distribution: (await getDistribution(id))!, queued }
}

/** Picu scrape metrik sekarang (biasanya cron worker tiap 3 jam). */
export async function requestTracking(
  distributionId?: number,
): Promise<{ queued: boolean }> {
  const queued = await publishJob(CLIP_STREAMS.track, {
    distributionId: distributionId ?? null,
    requestedAt: new Date().toISOString(),
  })
  return { queued }
}

/* ── Analytics ─────────────────────────────────────────────── */

export async function getAnalyticsSummary(range: {
  from?: string
  to?: string
}): Promise<ClippingAnalyticsSummary> {
  const to = range.to ? new Date(range.to) : new Date()
  const from = range.from
    ? new Date(range.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    badRequest('Format tanggal tidak valid. Gunakan ISO 8601.')
  }

  const fromIso = from.toISOString()
  const toIso = to.toISOString()

  const [totalsRows, statusRows, platformRows, topRows] = await Promise.all([
    db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM clip_sources WHERE created_at BETWEEN ${fromIso} AND ${toIso}) AS sources,
        (SELECT count(*)::int FROM generated_clips WHERE created_at BETWEEN ${fromIso} AND ${toIso}) AS clips,
        (SELECT count(*)::int FROM generated_clips WHERE is_approved AND created_at BETWEEN ${fromIso} AND ${toIso}) AS approved_clips,
        (SELECT count(*)::int FROM clip_distributions WHERE COALESCE(published_at, now()) BETWEEN ${fromIso} AND ${toIso}) AS distributions,
        (SELECT COALESCE(sum(views_count), 0)::bigint FROM clip_distributions) AS views,
        (SELECT COALESCE(sum(likes_count), 0)::bigint FROM clip_distributions) AS likes,
        (SELECT COALESCE(sum(comments_count), 0)::bigint FROM clip_distributions) AS comments,
        (SELECT COALESCE(sum(shares_count), 0)::bigint FROM clip_distributions) AS shares,
        (SELECT COALESCE(sum(saves_count), 0)::bigint FROM clip_distributions) AS saves,
        (SELECT COALESCE(sum(trigger_count_applied), 0)::int FROM clip_distributions) AS triggers,
        (SELECT COALESCE(sum(estimated_revenue_idr), 0)::bigint FROM clip_distributions) AS revenue,
        (SELECT COALESCE(avg(virality_score), 0)::float FROM generated_clips WHERE created_at BETWEEN ${fromIso} AND ${toIso}) AS avg_score
    `),
    db.execute(sql`
      SELECT status, count(*)::int AS total
      FROM clip_distributions
      GROUP BY status
      ORDER BY total DESC
    `),
    db.execute(sql`
      SELECT
        target_platform AS platform,
        count(*)::int AS total,
        COALESCE(sum(views_count), 0)::bigint AS views,
        COALESCE(sum(estimated_revenue_idr), 0)::bigint AS revenue,
        COALESCE(avg(views_count), 0)::float AS average_views
      FROM clip_distributions
      GROUP BY target_platform
      ORDER BY views DESC
    `),
    db.execute(sql`
      SELECT
        c.id AS clip_id,
        c.title_hook,
        c.virality_score,
        COALESCE(sum(d.views_count), 0)::bigint AS views,
        COALESCE(sum(d.likes_count), 0)::bigint AS likes,
        COALESCE(sum(d.saves_count), 0)::bigint AS saves,
        COALESCE(sum(d.estimated_revenue_idr), 0)::bigint AS revenue
      FROM generated_clips c
      LEFT JOIN clip_distributions d ON d.clip_id = c.id
      GROUP BY c.id, c.title_hook, c.virality_score
      HAVING COALESCE(sum(d.views_count), 0) > 0
      ORDER BY views DESC
      LIMIT 10
    `),
  ])

  const totals = (totalsRows as Row[])[0] ?? {}
  return {
    totals: {
      sources: num(totals.sources),
      clips: num(totals.clips),
      approvedClips: num(totals.approved_clips),
      distributions: num(totals.distributions),
      views: num(totals.views),
      likes: num(totals.likes),
      comments: num(totals.comments),
      shares: num(totals.shares),
      saves: num(totals.saves),
      triggers: num(totals.triggers),
      estimatedRevenueIdr: num(totals.revenue),
      averageViralityScore: Number(num(totals.avg_score).toFixed(1)),
    },
    byStatus: (statusRows as Row[]).map((row) => ({
      status: String(row.status) as ClipDistributionStatus,
      total: num(row.total),
    })),
    byPlatform: (platformRows as Row[]).map((row) => ({
      platform: String(row.platform ?? ''),
      total: num(row.total),
      views: num(row.views),
      revenueIdr: num(row.revenue),
      averageViews: Math.round(num(row.average_views)),
    })),
    topClips: (topRows as Row[]).map((row) => ({
      clipId: num(row.clip_id),
      titleHook: String(row.title_hook ?? ''),
      views: num(row.views),
      likes: num(row.likes),
      saves: num(row.saves),
      viralityScore: num(row.virality_score),
      revenueIdr: num(row.revenue),
    })),
    window: { from: fromIso, to: toIso },
  }
}
