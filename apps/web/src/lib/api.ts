import { treaty } from '@elysiajs/eden'
import type { App } from '@media-intel/api'
import type {
  AlertDTO,
  AlertSeverity,
  AnalyticsOverview,
  ClipDistributionDTO,
  ClipDistributionStatus,
  ClippingAnalyticsSummary,
  ClipRenderMode,
  ClipSourceDTO,
  ClipSourceDetailDTO,
  ClipSourceStatus,
  ClipTargetPlatform,
  ClusterDetail,
  ClusterDTO,
  FeedQuery,
  FigurePeriod,
  FigureTrendingResult,
  GeneratedClipDTO,
  KeywordDTO,
  LocationAnalyticsResult,
  MediaItemDTO,
  Paginated,
  SentimentLabel,
  SourceDTO,
  SocialTrendingResult,
  SourcePlatform,
  TrendSort,
  SummaryResult,
  SystemStatus,
  TrendingWindow,
} from '@media-intel/types'

export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
const API_KEY = import.meta.env.VITE_API_KEY ?? ''
const treatyBase = API_BASE || window.location.origin

export const client = treaty<App>(treatyBase, {
  // DTO kita mendefinisikan tanggal sebagai ISO string. Jangan biarkan Eden
  // mengubahnya menjadi objek Date, karena ada komponen yang merender nilai
  // apa adanya dan React menolak Date sebagai child.
  parseDate: false,
  ...(API_KEY ? { headers: { 'x-api-key': API_KEY } } : {}),
})

export class ApiRequestError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

async function unwrap<T>(request: Promise<unknown>): Promise<T> {
  const response = (await request) as {
    data?: unknown
    error?: unknown
    status?: number
  }
  if (response.error || response.data === null || response.data === undefined) {
    let message = 'Permintaan ke API gagal.'
    const error = response.error
    if (error && typeof error === 'object') {
      const candidate = error as {
        value?: { error?: string; message?: string }
        error?: string
        message?: string
      }
      message =
        candidate.value?.error ??
        candidate.value?.message ??
        candidate.error ??
        candidate.message ??
        message
    }
    throw new ApiRequestError(message, response.status ?? 0)
  }
  return response.data as T
}

export function sseUrl(topics: string): string {
  return `${API_BASE}/api/feeds/stream?topics=${encodeURIComponent(topics)}`
}

/**
 * URL absolut untuk berkas media yang di-stream API.
 *
 * `videoUrl` dari DTO berupa path relatif (`/api/clipping/clips/12/video`).
 * Bila dashboard di-serve dari origin berbeda (`VITE_API_URL`), path itu harus
 * ditempel ke origin API, bukan origin halaman.
 */
export function mediaUrl(
  path: string | null | undefined,
  options: { download?: boolean } = {},
): string | null {
  if (!path) return null
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  if (!options.download) return url
  return `${url}${url.includes('?') ? '&' : '?'}download=1`
}

/* ── Auth ──────────────────────────────────────────────────── */

export interface SessionInfo {
  authenticated: boolean
  username: string | null
  via: 'session' | 'api-key' | 'open' | null
  authRequired: boolean
}

/** Endpoint auth memakai `fetch` biasa: cookie httpOnly dikirim otomatis. */
async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api/auth${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) {
    throw new ApiRequestError(payload.error ?? 'Permintaan gagal.', response.status)
  }
  return payload
}

export function fetchSession(): Promise<SessionInfo> {
  return authRequest<SessionInfo>('/me')
}

export function loginRequest(username: string, password: string): Promise<{
  authenticated: boolean
  username: string
  expiresInDays: number
}> {
  return authRequest('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function logoutRequest(): Promise<{ authenticated: boolean }> {
  return authRequest('/logout', { method: 'POST' })
}

/* ── Analytics ─────────────────────────────────────────────── */

export interface AnalyticsParams {
  from?: string
  to?: string
  keywordId?: string
  sourceId?: string
  platform?: SourcePlatform
  bucket?: 'hour' | 'day'
}

export function fetchOverview(params: AnalyticsParams): Promise<AnalyticsOverview> {
  return unwrap<AnalyticsOverview>(
    client.api.analytics.overview.get({ query: params }),
  )
}

export function fetchLocationAnalytics(
  params: Omit<AnalyticsParams, 'bucket'>,
): Promise<LocationAnalyticsResult> {
  return unwrap<LocationAnalyticsResult>(
    client.api.analytics.locations.get({ query: params }),
  )
}

/* ── Feeds ─────────────────────────────────────────────────── */

export function fetchFeeds(params: FeedQuery): Promise<Paginated<MediaItemDTO>> {
  return unwrap<Paginated<MediaItemDTO>>(client.api.feeds.get({ query: params }))
}

export function fetchFeed(id: string): Promise<MediaItemDTO> {
  return unwrap<MediaItemDTO>(client.api.feeds({ id }).get())
}

export function fetchFeedBreakdown(params: {
  from?: string
  to?: string
  sourceId?: string
  keywordId?: string
  search?: string
}): Promise<{ positive: number; neutral: number; negative: number }> {
  return unwrap(client.api.feeds.breakdown.get({ query: params }))
}

/* ── Clusters ──────────────────────────────────────────────── */

export function fetchClusters(params: { limit?: number; minArticles?: number } = {}): Promise<
  ClusterDTO[]
> {
  return unwrap<ClusterDTO[]>(client.api.clusters.get({ query: params }))
}

export function fetchCluster(id: string): Promise<ClusterDetail> {
  return unwrap<ClusterDetail>(client.api.clusters({ id }).get())
}

export function requestClusterSummary(id: string, refresh = false): Promise<SummaryResult> {
  return unwrap<SummaryResult>(
    client.api.clusters({ id }).summarize.post({ refresh }),
  )
}

export function rebuildClusters(body?: {
  windowHours?: number
  distanceThreshold?: number
  minItems?: number
}): Promise<{
  scanned: number
  clustersCreated: number
  clustersUpdated: number
  assignedToExisting: number
  skipped: number
  distanceThreshold: number
}> {
  return unwrap(client.api.clusters.rebuild.post(body ?? {}))
}

/* ── Trending & figures ────────────────────────────────────── */

export function fetchSocialTrending(params: {
  window?: TrendingWindow
  limit?: number
  platform?: 'TWITTER_X' | 'TIKTOK' | 'GOOGLE_TRENDS'
  sort?: TrendSort
  hours?: number
}): Promise<SocialTrendingResult> {
  return unwrap<SocialTrendingResult>(client.api.trending.social.get({ query: params }))
}

export function fetchFigureTrending(params: {
  period?: FigurePeriod
  limit?: number
  sourceId?: string
  platform?: SourcePlatform
}): Promise<FigureTrendingResult> {
  return unwrap<FigureTrendingResult>(
    client.api.trending.figures.get({ query: params }),
  )
}

/* ── Alerts ────────────────────────────────────────────────── */

export interface AlertParams {
  page?: number
  limit?: number
  severity?: AlertSeverity
  resolved?: boolean
  keywordId?: string
}

export function fetchAlerts(params: AlertParams = {}): Promise<Paginated<AlertDTO>> {
  return unwrap<Paginated<AlertDTO>>(
    client.api.alerts.get({
      query: {
        page: params.page,
        limit: params.limit,
        severity: params.severity,
        keywordId: params.keywordId,
        resolved: params.resolved === undefined ? undefined : String(params.resolved),
      },
    }),
  )
}

export function requestAlertScan(): Promise<{
  scanned: number
  triggered: number
  alerts: AlertDTO[]
}> {
  return unwrap(client.api.alerts.scan.post())
}

export function resolveAlert(id: string, isResolved: boolean): Promise<AlertDTO> {
  return unwrap<AlertDTO>(client.api.alerts({ id }).resolve.patch({ isResolved }))
}

export function fetchNotificationChannels(): Promise<{
  telegram: boolean
  webhook: boolean
}> {
  return unwrap(client.api.alerts.channels.get())
}

/* ── Keywords ──────────────────────────────────────────────── */

export function fetchKeywords(withMatches = true): Promise<KeywordDTO[]> {
  return unwrap<KeywordDTO[]>(
    client.api.keywords.get({ query: { withMatches: String(withMatches) } }),
  )
}

export function validateBooleanQuery(query: string): Promise<{
  ok: boolean
  error: string | null
  terms: string[]
}> {
  return unwrap(client.api.keywords.validate.post({ query }))
}

export function createKeyword(body: {
  label: string
  booleanQuery: string
  isActive?: boolean
}): Promise<KeywordDTO> {
  return unwrap<KeywordDTO>(client.api.keywords.post(body))
}

export function updateKeyword(
  id: string,
  body: { label?: string; booleanQuery?: string; isActive?: boolean },
): Promise<KeywordDTO> {
  return unwrap<KeywordDTO>(client.api.keywords({ id }).patch(body))
}

export function removeKeyword(id: string): Promise<{ success: boolean }> {
  return unwrap(client.api.keywords({ id }).delete())
}

/* ── Sources ───────────────────────────────────────────────── */

export function fetchSources(): Promise<SourceDTO[]> {
  return unwrap<SourceDTO[]>(client.api.sources.get())
}

export function toggleSource(id: string, isActive: boolean): Promise<SourceDTO> {
  return unwrap<SourceDTO>(client.api.sources({ id }).patch({ isActive }))
}

/* ── System & dev ──────────────────────────────────────────── */

export function fetchSystemStatus(): Promise<SystemStatus> {
  return unwrap<SystemStatus>(client.api.system.status.get())
}

export function seedDemoData(): Promise<{
  success: boolean
  message: string
  inserted: number
  duplicatesSkipped: number
  alertsTriggered: number
}> {
  return unwrap(
    client.api.dev.seed.post(undefined, {
      query: { generateAlerts: 'true' },
    } as never),
  )
}

export type { SentimentLabel, SourcePlatform }

/* ── Clipping ──────────────────────────────────────────────── */

export function fetchClipSources(params: {
  status?: ClipSourceStatus
  limit?: number
  offset?: number
} = {}): Promise<ClipSourceDTO[]> {
  return unwrap<ClipSourceDTO[]>(
    client.api.clipping.sources.get({ query: params }),
  )
}

export function fetchClipSource(id: number): Promise<ClipSourceDetailDTO> {
  return unwrap<ClipSourceDetailDTO>(client.api.clipping.sources({ id }).get())
}

export function ingestClipSource(body: {
  url: string
  maxClips?: number
  language?: string
  renderMode?: ClipRenderMode
}): Promise<ClipSourceDTO> {
  return unwrap<ClipSourceDTO>(client.api.clipping.sources.post(body))
}

export function retryClipSource(id: number): Promise<ClipSourceDTO> {
  return unwrap<ClipSourceDTO>(client.api.clipping.sources({ id }).retry.post())
}

export function deleteClipSource(id: number): Promise<{ success: boolean }> {
  return unwrap(client.api.clipping.sources({ id }).delete())
}

export function fetchClips(params: {
  sourceId?: number
  approvedOnly?: boolean
  limit?: number
} = {}): Promise<GeneratedClipDTO[]> {
  return unwrap<GeneratedClipDTO[]>(
    client.api.clipping.clips.get({
      query: {
        sourceId: params.sourceId,
        approvedOnly: params.approvedOnly ? 'true' : undefined,
        limit: params.limit,
      },
    }),
  )
}

export function patchClip(
  id: number,
  body: { titleHook?: string; renderMode?: ClipRenderMode; isApproved?: boolean },
): Promise<GeneratedClipDTO> {
  return unwrap<GeneratedClipDTO>(client.api.clipping.clips({ id }).patch(body))
}

export function renderClip(
  id: number,
  body: { renderMode?: ClipRenderMode; fillerAsset?: string } = {},
): Promise<{ clip: GeneratedClipDTO; queued: boolean }> {
  return unwrap(client.api.clipping.clips({ id }).render.post(body))
}

export function approveClip(id: number, isApproved: boolean): Promise<GeneratedClipDTO> {
  return unwrap<GeneratedClipDTO>(client.api.clipping.clips({ id }).approve.post({ isApproved }))
}

export function distributeClip(
  id: number,
  body: {
    accounts: Array<{
      targetPlatform: ClipTargetPlatform
      accountUsername: string
      deviceSerial?: string
      cpmRateIdr?: number
    }>
    enableViralTrigger?: boolean
    watchTimePct?: number
    dripWindowMinutes?: number
  },
): Promise<{ distributions: ClipDistributionDTO[]; queued: boolean }> {
  return unwrap(client.api.clipping.clips({ id }).distribute.post(body))
}

export function fetchDistributions(params: {
  status?: ClipDistributionStatus
  clipId?: number
  account?: string
  limit?: number
} = {}): Promise<ClipDistributionDTO[]> {
  return unwrap<ClipDistributionDTO[]>(
    client.api.clipping.distributions.get({ query: params }),
  )
}

export function boostDistribution(
  id: number,
  body: { sessions?: number; watchTimePct?: number; searchKeyword?: string } = {},
): Promise<{ distribution: ClipDistributionDTO; queued: boolean }> {
  return unwrap(client.api.clipping.distributions({ id }).boost.post(body))
}

export function requestTrack(distributionId?: number): Promise<{ queued: boolean }> {
  return unwrap(
    client.api.clipping.distributions.track.post(undefined, {
      query: distributionId ? { distributionId } : undefined,
    } as never),
  )
}

export function fetchClippingAnalytics(params: {
  from?: string
  to?: string
} = {}): Promise<ClippingAnalyticsSummary> {
  return unwrap<ClippingAnalyticsSummary>(
    client.api.clipping.analytics.summary.get({ query: params }),
  )
}
