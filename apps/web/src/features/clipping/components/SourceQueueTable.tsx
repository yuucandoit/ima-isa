import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Clapperboard,
  Clock,
  Download,
  Film,
  Loader2,
  RotateCcw,
  Scissors,
  Trash2,
} from 'lucide-react'
import type { ClipSourceDTO, ClipSourceStatus } from '@media-intel/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { formatDuration, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useClipSources, useDeleteSource, useRetrySource } from '@/hooks/useClipping'
import { isStalled, formatAge, type ClippingHealth } from './ProgressStatus'

/** Tahapan pipeline dalam urutan yang dilihat pengguna. */
const STEPS: Array<{ status: ClipSourceStatus; label: string }> = [
  { status: 'pending', label: 'Antre' },
  { status: 'downloading', label: 'Unduh' },
  { status: 'transcribing', label: 'Transkrip' },
  { status: 'analyzing', label: 'Kurasi AI' },
  { status: 'rendering', label: 'Render' },
  { status: 'completed', label: 'Selesai' },
]

const STEP_INDEX: Record<ClipSourceStatus, number> = {
  pending: 0,
  downloading: 1,
  transcribing: 2,
  analyzing: 3,
  rendering: 4,
  completed: 5,
  failed: 5,
}

const ACTIVE: ClipSourceStatus[] = [
  'pending',
  'downloading',
  'transcribing',
  'analyzing',
  'rendering',
]

export function isActiveStatus(status: ClipSourceStatus): boolean {
  return ACTIVE.includes(status)
}

/** Stepper inline untuk satu baris tabel. */
export function StepTrail({
  source,
  health,
}: {
  source: ClipSourceDTO
  health: ClippingHealth | null
}) {
  const current = STEP_INDEX[source.status]
  const stalled = isStalled(source, health)
  const failed = source.status === 'failed'
  const done = source.status === 'completed'

  return (
    <div className="flex items-center gap-1" aria-label="Tahapan proses">
      {STEPS.map((step, index) => {
        const stepDone = done || index < current
        const stepActive = index === current && isActiveStatus(source.status)
        return (
          <div key={step.status} className="flex flex-1 items-center gap-1">
            <span
              title={step.label}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                failed && index >= current && 'bg-negative/60',
                !failed && stepDone && 'bg-positive/70',
                !failed && stepActive && !stalled && 'animate-pulse bg-accent',
                !failed && stepActive && stalled && 'bg-warning',
                !failed && !stepDone && !stepActive && 'bg-border',
              )}
            />
          </div>
        )
      })}
    </div>
  )
}

function StatusCell({
  source,
  health,
}: {
  source: ClipSourceDTO
  health: ClippingHealth | null
}) {
  const stalled = isStalled(source, health)
  const failed = source.status === 'failed'
  const done = source.status === 'completed'

  if (failed) {
    return (
      <div className="space-y-1">
        <Badge variant="negative" className="text-[9px]">
          <AlertTriangle className="h-2.5 w-2.5" /> Gagal
        </Badge>
        <p className="line-clamp-2 max-w-[38ch] text-[10px] leading-snug text-negative/90">
          {source.errorMessage ?? 'Pipeline gagal tanpa pesan.'}
        </p>
      </div>
    )
  }

  if (done) {
    return (
      <div className="space-y-1">
        <Badge variant="positive" className="text-[9px]">
          Selesai
        </Badge>
        <p className="font-mono text-[10px] text-muted-foreground">
          {source.clipCount} klip · {formatDuration(source.durationSeconds ?? 0)}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <Badge variant={stalled ? 'warning' : 'outline'} className="text-[9px]">
        {stalled ? (
          <AlertTriangle className="h-2.5 w-2.5" />
        ) : (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        )}
        {STEPS[STEP_INDEX[source.status]]?.label ?? source.status}
      </Badge>
      <p className="font-mono text-[10px] text-muted-foreground">
        {stalled ? `macet ${formatAge(source.statusAgeSeconds)}` : `${formatAge(source.statusAgeSeconds)} berjalan`}
      </p>
    </div>
  )
}

function SourceTableRow({
  source,
  health,
}: {
  source: ClipSourceDTO
  health: ClippingHealth | null
}) {
  const retry = useRetrySource()
  const remove = useDeleteSource()
  const retryable = source.status === 'failed' || source.status === 'completed'

  return (
    <tr className="group border-b border-border/40 transition-colors last:border-0 hover:bg-secondary/20">
      <td className="py-2.5 pl-3 pr-2">
        <span className="font-mono text-[10px] text-muted-foreground/70">#{source.id}</span>
      </td>
      <td className="max-w-0 py-2.5 pr-3">
        <Link
          to={`/clipping/${source.id}`}
          className="block min-w-0 hover:underline"
        >
          <p className="line-clamp-1 text-[12px] font-medium text-foreground/90">
            {source.title || source.url}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground/70">
            <span className="rounded border border-border/60 px-1 py-px uppercase">
              {source.platform}
            </span>
            <span>{formatRelative(source.createdAt)}</span>
            {source.durationSeconds ? <span>· {formatDuration(source.durationSeconds)}</span> : null}
            {source.transcriptWordCount > 0 ? (
              <span>· {source.transcriptWordCount} kata</span>
            ) : null}
          </p>
        </Link>
      </td>
      <td className="w-[34%] py-2.5 pr-3">
        {source.status === 'failed' ? (
          <p className="line-clamp-2 max-w-[40ch] text-[10px] leading-snug text-negative/90">
            {source.errorMessage ?? 'Pipeline gagal.'}
          </p>
        ) : (
          <div className="space-y-1.5">
            <StepTrail source={source} health={health} />
            <p className="font-mono text-[9px] text-muted-foreground/70">
              {source.status === 'completed'
                ? `${source.clipCount} klip siap`
                : isActiveStatus(source.status)
                  ? `${STEPS[STEP_INDEX[source.status]]?.label} · ${formatAge(source.statusAgeSeconds)}`
                  : '—'}
            </p>
          </div>
        )}
      </td>
      <td className="w-[110px] py-2.5 pr-2">
        <StatusCell source={source} health={health} />
      </td>
      <td className="w-[92px] py-2.5 pr-3">
        <div className="flex items-center justify-end gap-1">
          <Button
            asChild
            size="icon-sm"
            variant="ghost"
            title="Buka detail"
          >
            <Link to={`/clipping/${source.id}`}>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
          {retryable ? (
            <Button
              size="icon-sm"
              variant="ghost"
              title="Ulangi ingest"
              onClick={() => retry.mutate(source.id)}
              disabled={retry.isPending}
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              variant="ghost"
              disabled
              title="Sedang diproses — tunggu selesai"
            >
              <RotateCcw className="h-3 w-3 opacity-30" />
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            title="Hapus sumber"
            onClick={() => remove.mutate(source.id)}
            disabled={remove.isPending}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </td>
    </tr>
  )
}

/** Tabel antrean: satu baris per URL yang di-submit, beserta tahapannya. */
export function SourceQueueTable({
  health,
  emptyHint,
}: {
  health: ClippingHealth | null
  emptyHint?: string
}) {
  const sources = useClipSources()

  if (sources.isLoading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (sources.isError) {
    return (
      <div className="p-3">
        <ErrorState
          message={(sources.error as Error)?.message}
          onRetry={() => sources.refetch()}
        />
      </div>
    )
  }

  const data = sources.data ?? []
  if (data.length === 0) {
    return (
      <EmptyState
        icon={Clapperboard}
        title="Antrean kosong"
        description={
          emptyHint ??
          'Tempel tautan video di atas. Setiap URL akan tampil di sini dengan tahapan prosesnya.'
        }
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border/60 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
            <th className="py-2 pl-3 pr-2 font-normal">ID</th>
            <th className="py-2 pr-3 font-normal">Sumber</th>
            <th className="py-2 pr-3 font-normal">Tahapan</th>
            <th className="py-2 pr-2 font-normal">Status</th>
            <th className="py-2 pr-3 text-right font-normal">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {data.map((source) => (
            <SourceTableRow key={source.id} source={source} health={health} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Ringkasan angka antrean. */
export function QueueSummary({ health }: { health: ClippingHealth | null }) {
  const sources = useClipSources()
  const data = sources.data ?? []
  const active = data.filter((item) => isActiveStatus(item.status)).length
  const completed = data.filter((item) => item.status === 'completed').length
  const failed = data.filter((item) => item.status === 'failed').length
  const clips = data.reduce((total, item) => total + item.clipCount, 0)

  const items = [
    { label: 'Diproses', value: active, icon: Loader2, tone: 'text-accent' },
    { label: 'Selesai', value: completed, icon: Scissors, tone: 'text-positive' },
    { label: 'Gagal', value: failed, icon: AlertTriangle, tone: 'text-negative' },
    { label: 'Klip', value: clips, icon: Film, tone: 'text-foreground' },
  ] as const

  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-2 rounded border border-border/50 bg-secondary/20 px-2.5 py-1.5"
        >
          <item.icon className={cn('h-3 w-3 shrink-0', item.tone)} />
          <div className="min-w-0">
            <p className="font-mono text-[13px] leading-none tabular-nums text-foreground">
              {item.value}
            </p>
            <p className="mt-0.5 truncate text-[9px] uppercase tracking-wider text-muted-foreground/70">
              {item.label}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

export { Card, CardContent, Clock, Download }
