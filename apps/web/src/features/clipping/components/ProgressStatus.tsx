import { AlertTriangle, CircleCheck, CircleDashed, Loader2, WifiOff } from 'lucide-react'
import type { ClipSourceDTO, ClipSourceStatus, SystemStatus } from '@media-intel/types'
import { cn } from '@/lib/utils'
import { CLIP_SOURCE_STATUS_LABEL, formatDuration } from '@/lib/format'

/**
 * Urutan tahapan pipeline kliping. `failed` bukan tahap, jadi tidak masuk
 * daftar ini — kegagalan ditampilkan terpisah.
 */
const STEPS: Array<{ status: ClipSourceStatus; label: string; hint: string }> = [
  { status: 'pending', label: 'Antre', hint: 'Menunggu worker mengambil job' },
  { status: 'downloading', label: 'Unduh', hint: 'yt-dlp mengambil video' },
  { status: 'transcribing', label: 'Transkripsi', hint: 'Whisper membuat transkrip kata' },
  { status: 'analyzing', label: 'Kurasi AI', hint: 'Heatmap + energi + LLM memilih klip' },
  { status: 'rendering', label: 'Render', hint: 'FFmpeg merender 9:16' },
  { status: 'completed', label: 'Selesai', hint: 'Klip siap didistribusikan' },
]

const ACTIVE = new Set<ClipSourceStatus>([
  'pending',
  'downloading',
  'transcribing',
  'analyzing',
  'rendering',
])

const STEP_INDEX: Record<ClipSourceStatus, number> = {
  pending: 0,
  downloading: 1,
  transcribing: 2,
  analyzing: 3,
  rendering: 4,
  completed: 5,
  failed: 5,
}

export type ClippingHealth = NonNullable<SystemStatus['clipping']>

/** Apakah sumber ini mandek (status tidak berubah terlalu lama)? */
export function isStalled(
  source: ClipSourceDTO,
  health: ClippingHealth | null,
  thresholdSeconds = 120,
): boolean {
  if (!ACTIVE.has(source.status)) return false
  if (!health) return false
  // Worker mati = pasti mandek, berapa pun usianya.
  if (health.worker === 'offline') return true
  if (health.worker === 'idle') return true
  return source.statusAgeSeconds >= thresholdSeconds
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} dtk`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} mnt`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} jam`
  return `${Math.floor(seconds / 86400)} hari`
}

/** Satu baris status + alasan yang bisa dibaca manusia. */
export function ProgressSummary({
  source,
  health,
  className,
}: {
  source: ClipSourceDTO
  health: ClippingHealth | null
  className?: string
}) {
  const stalled = isStalled(source, health)
  const step = STEPS[STEP_INDEX[source.status]]

  let tone = 'text-muted-foreground'
  let icon = <CircleDashed className="h-3 w-3" />
  let text = step?.hint ?? ''

  if (source.status === 'completed') {
    tone = 'text-positive'
    icon = <CircleCheck className="h-3 w-3" />
    text = `${source.clipCount} klip siap · ${formatDuration(source.durationSeconds ?? 0)}`
  } else if (source.status === 'failed') {
    tone = 'text-negative'
    icon = <AlertTriangle className="h-3 w-3" />
    text = source.errorMessage ?? 'Pipeline gagal tanpa pesan.'
  } else if (!health) {
    tone = 'text-muted-foreground'
    icon = <WifiOff className="h-3 w-3" />
    text = 'Status worker tidak tersedia (Redis mati).'
  } else if (stalled) {
    tone = 'text-warning'
    icon = <AlertTriangle className="h-3 w-3" />
    text =
      health.worker === 'offline'
        ? `Macet ${formatAge(source.statusAgeSeconds)} — worker kliping tidak berjalan.`
        : health.worker === 'idle'
          ? `Macet ${formatAge(source.statusAgeSeconds)} — worker tidak merespons.`
          : `Tidak ada kemajuan selama ${formatAge(source.statusAgeSeconds)}.`
  } else if (ACTIVE.has(source.status)) {
    tone = 'text-accent'
    icon = <Loader2 className="h-3 w-3 animate-spin" />
    text = `${step?.hint ?? 'Diproses'} · ${formatAge(source.statusAgeSeconds)}`
  }

  return (
    <p className={cn('flex items-center gap-1.5 text-[10px] leading-snug', tone, className)}>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0">{text}</span>
    </p>
  )
}

/** Stepper ringkas: titik per tahap + label tahap aktif. */
export function ProgressSteps({
  source,
  health,
}: {
  source: ClipSourceDTO
  health: ClippingHealth | null
}) {
  const current = STEP_INDEX[source.status]
  const stalled = isStalled(source, health)
  const failed = source.status === 'failed'

  return (
    <div className="space-y-2">
      <ol className="flex items-center gap-1" aria-label="Tahapan pipeline">
        {STEPS.map((step, index) => {
          const done = index < current || source.status === 'completed'
          const active = index === current && ACTIVE.has(source.status)
          return (
            <li key={step.status} className="flex flex-1 items-center gap-1">
              <span
                title={`${step.label} — ${step.hint}`}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition-colors',
                  failed && index >= current && 'bg-negative/60',
                  !failed && done && 'bg-positive/70',
                  !failed && active && !stalled && 'animate-pulse bg-accent',
                  !failed && active && stalled && 'bg-warning',
                  !failed && !done && !active && 'bg-border',
                )}
              />
            </li>
          )
        })}
      </ol>
      <ol className="flex items-center justify-between gap-1 font-mono text-[8px] uppercase tracking-wider">
        {STEPS.map((step, index) => {
          const done = index < current || source.status === 'completed'
          const active = index === current && ACTIVE.has(source.status)
          return (
            <li
              key={step.status}
              className={cn(
                'flex-1 text-center',
                failed && index === current && 'text-negative',
                !failed && done && 'text-positive/80',
                !failed && active && 'text-foreground',
                !failed && !done && !active && 'text-muted-foreground/40',
              )}
            >
              {step.label}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Banner global bila worker kliping mati tapi ada job menunggu. */
export function WorkerHealthBanner({ health }: { health: ClippingHealth | null }) {
  if (!health) return null

  const dead = health.worker !== 'online'
  const waiting = health.pending > 0
  if (!dead && health.missingDependencies.length === 0) return null
  if (!dead && !waiting) {
    // Worker hidup & antrean kosong: dependensi hilang masih relevan karena
    // akan menggagalkan ingest berikutnya.
    if (health.missingDependencies.length === 0) return null
  }

  return (
    <div
      className={cn(
        'mb-4 flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[11px] leading-snug',
        dead && waiting
          ? 'border-negative/40 bg-negative/5 text-negative'
          : 'border-warning/40 bg-warning/5 text-warning',
      )}
    >
      {dead && waiting ? (
        <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      ) : (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      <div className="min-w-0 space-y-1">
        {dead && waiting ? (
          <p>
            <strong className="font-semibold">Worker kliping tidak berjalan.</strong>{' '}
            {health.pending} job menunggu di antrean, jadi semua sumber akan tetap
            berstatus &ldquo;Antre&rdquo;. Jalankan{' '}
            <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10px]">
              bun run worker:clip
            </code>{' '}
            (atau{' '}
            <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10px]">
              CLIP_DRY_RUN=true bun run worker:clip
            </code>{' '}
            untuk uji alur).
          </p>
        ) : null}
        {dead && !waiting ? (
          <p>
            Heartbeat worker kliping belum terdeteksi
            {health.lastActiveSeconds !== null
              ? ` (terakhir ${formatAge(health.lastActiveSeconds)} lalu)`
              : ''}
            . Sumber baru akan tetap &ldquo;Antre&rdquo; sampai worker dijalankan.
          </p>
        ) : null}
        {health.missingDependencies.length > 0 ? (
          <p>
            Dependensi belum terpasang: {health.missingDependencies.join(', ')}
            {health.dryRun ? ' (diabaikan pada mode dry-run)' : ''}. Pasang dengan{' '}
            <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10px]">
              bun run worker:setup:clip
            </code>
            .
          </p>
        ) : null}
      </div>
    </div>
  )
}

export { STEPS, ACTIVE as ACTIVE_SOURCE_STATUSES, formatAge, CLIP_SOURCE_STATUS_LABEL }
