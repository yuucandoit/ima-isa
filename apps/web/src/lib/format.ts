import type { AlertSeverity, SentimentLabel, SourcePlatform } from '@media-intel/types'

const compact = new Intl.NumberFormat('id-ID', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const integer = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Math.abs(value) >= 10_000 ? compact.format(value) : integer.format(value)
}

export function formatInt(value: number): string {
  return integer.format(Number.isFinite(value) ? value : 0)
}

export function formatPercent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '0%'
  return `${value.toFixed(digits)}%`
}

export function formatSigned(value: number, digits = 0): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}`
}

type DateInput = string | Date | number | null | undefined

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value ?? 0)
}

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Jakarta',
})

const timeFormatter = new Intl.DateTimeFormat('id-ID', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Jakarta',
  hour12: false,
})

const dateTimeFormatter = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Jakarta',
  hour12: false,
})

export function formatDate(iso: DateInput): string {
  return dateFormatter.format(toDate(iso))
}

export function formatTime(iso: DateInput): string {
  return timeFormatter.format(toDate(iso))
}

export function formatDateTime(iso: DateInput): string {
  return `${dateTimeFormatter.format(toDate(iso))} WIB`
}

export function formatRelative(iso: DateInput): string {
  const diffMs = toDate(iso).getTime() - Date.now()
  const minutes = Math.round(diffMs / 60_000)
  const formatter = new Intl.RelativeTimeFormat('id-ID', { numeric: 'auto' })
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  const days = Math.round(hours / 24)
  return formatter.format(days, 'day')
}

export function truncate(text: string, max = 140): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trimEnd()}…`
}

export function hostname(url: string | null): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export const SENTIMENT_LABEL: Record<SentimentLabel, string> = {
  POSITIVE: 'Positif',
  NEUTRAL: 'Netral',
  NEGATIVE: 'Negatif',
}

export const SENTIMENT_COLOR: Record<SentimentLabel, string> = {
  POSITIVE: 'hsl(var(--positive))',
  NEUTRAL: 'hsl(var(--neutral))',
  NEGATIVE: 'hsl(var(--negative))',
}

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  LOW: 'Rendah',
  MEDIUM: 'Sedang',
  HIGH: 'Tinggi',
  CRITICAL: 'Kritis',
}

export const PLATFORM_LABEL: Record<SourcePlatform, string> = {
  NEWS_MEDIA: 'Media Daring',
  TWITTER_X: 'X / Twitter',
  YOUTUBE: 'YouTube',
  TIKTOK: 'TikTok',
  GOOGLE_TRENDS: 'Google Trends',
}

export type RangePreset = '24h' | '7d' | '30d'

export const RANGE_LABEL: Record<RangePreset, string> = {
  '24h': '24 jam',
  '7d': '7 hari',
  '30d': '30 hari',
}

export function rangeFromPreset(preset: RangePreset): { from: string; to: string } {
  const to = new Date()
  const hours = preset === '24h' ? 24 : preset === '7d' ? 24 * 7 : 24 * 30
  const from = new Date(to.getTime() - hours * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

/* ── Clipping helpers ──────────────────────────────────────── */

export type RenderMode = 'split_screen' | 'face_reframe' | 'blur_background'

export const RENDER_MODE_LABEL: Record<RenderMode, string> = {
  split_screen: 'Split-screen',
  face_reframe: 'Face reframe',
  blur_background: 'Blur background',
}

export const RENDER_MODE_HINT: Record<RenderMode, string> = {
  split_screen: 'Video utama di atas + filler gameplay di bawah, caption di garis tengah',
  face_reframe: '9:16 penuh dengan crop mengikuti wajah',
  blur_background: 'Video 16:9 utuh dengan latar gaussian blur',
}

export const CLIP_SOURCE_STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu',
  downloading: 'Mengunduh',
  transcribing: 'Transkripsi',
  analyzing: 'Analisis AI',
  rendering: 'Rendering',
  completed: 'Selesai',
  failed: 'Gagal',
}

export const CLIP_DIST_STATUS_LABEL: Record<string, string> = {
  queued: 'Antre',
  uploading: 'Mengunggah',
  published: 'Terbit',
  boosting: 'Boosting',
  shadowbanned: 'Shadowban',
  failed: 'Gagal',
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

const idr = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
})

export function formatIdr(value: number): string {
  if (!Number.isFinite(value)) return 'Rp0'
  return idr.format(value)
}
