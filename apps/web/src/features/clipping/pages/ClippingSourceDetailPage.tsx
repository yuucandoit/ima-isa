import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  Download,
  ExternalLink,
  Film,
  Loader2,
  Play,
  RotateCcw,
  Scissors,
  Sparkles,
  X,
} from 'lucide-react'
import type { ClipRenderMode, ClipSourceStatus, GeneratedClipDTO } from '@media-intel/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { LiveIndicator } from '@/components/shared/LiveIndicator'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { mediaUrl } from '@/lib/api'
import { RENDER_MODE_HINT, RENDER_MODE_LABEL, formatDuration, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  useApproveClip,
  useClipSource,
  useClippingSSE,
  useRenderClip,
  useResolvedClipRenderProgress,
} from '@/hooks/useClipping'
import { useSystemStatus } from '@/hooks/useAnalytics'
import { ClipPlayer } from '../components/ClipPlayer'
import { ProgressSteps, ProgressSummary, isStalled, formatAge } from '../components/ProgressStatus'
import { StepTrail, isActiveStatus } from '../components/SourceQueueTable'

const RENDER_MODES: ClipRenderMode[] = ['split_screen', 'face_reframe', 'blur_background']

const STATUS_TONE: Record<ClipSourceStatus, string> = {
  pending: 'text-muted-foreground',
  downloading: 'text-warning',
  transcribing: 'text-warning',
  analyzing: 'text-accent',
  rendering: 'text-accent',
  completed: 'text-positive',
  failed: 'text-negative',
}

/** Kartu detail satu klip: pemutar + aksi render/setujui/distribusi. */
function ClipDetailCard({
  clip,
  sourceStatus,
}: {
  clip: GeneratedClipDTO
  sourceStatus: ClipSourceStatus
}) {
  const [renderMode, setRenderMode] = useState<ClipRenderMode>(clip.renderMode)
  const render = useRenderClip()
  const approve = useApproveClip()
  const liveProgress = useResolvedClipRenderProgress(clip, sourceStatus)
  const ready = Boolean(clip.videoUrl)
  const isRendering =
    render.isPending ||
    (Boolean(liveProgress) &&
      liveProgress!.stage !== 'completed' &&
      liveProgress!.stage !== 'failed')
  const pct = liveProgress ? Math.max(0, Math.min(100, Math.round(liveProgress.progress))) : 0

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-2.5 p-3">
        <ClipPlayer clip={clip} renderProgress={liveProgress} />

        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-[12px] font-medium leading-snug text-foreground">
              {clip.titleHook}
            </p>
            <span
              className={cn(
                'shrink-0 font-mono text-[11px] tabular-nums',
                clip.viralityScore >= 80
                  ? 'text-positive'
                  : clip.viralityScore >= 60
                    ? 'text-warning'
                    : 'text-muted-foreground',
              )}
              title="Skor virality"
            >
              {clip.viralityScore}
            </span>
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[9px] text-muted-foreground/70">
            <span>
              {formatDuration(clip.startTime)} – {formatDuration(clip.endTime)}
            </span>
            <span>{clip.durationSeconds.toFixed(0)}s</span>
            <span className="uppercase">{clip.renderMode.replace('_', ' ')}</span>
            {clip.isApproved ? (
              <span className="text-positive">disetujui</span>
            ) : null}
          </p>
        </div>

        {clip.aiReasoning ? (
          <p className="line-clamp-2 rounded border border-border/50 bg-secondary/30 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
            <Sparkles className="mr-1 inline h-2.5 w-2.5 text-primary/70" />
            {clip.aiReasoning}
          </p>
        ) : null}

        <div className="flex items-center gap-1.5">
          <Select
            value={renderMode}
            onChange={(event) => setRenderMode(event.target.value as ClipRenderMode)}
            className="h-8 min-w-0 flex-1 text-[11px]"
            aria-label="Mode render"
          >
            {RENDER_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {RENDER_MODE_LABEL[mode]}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              render.mutate({
                id: clip.id,
                renderMode,
                sourceId: clip.sourceId,
                currentFileHash: clip.fileHash,
              })
            }
            disabled={isRendering}
            title={RENDER_MODE_HINT[renderMode]}
          >
            {isRendering ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {isRendering ? `Merender ${pct}%` : ready ? 'Render ulang' : 'Render'}
          </Button>
          <Button
            size="icon-sm"
            variant={clip.isApproved ? 'default' : 'ghost'}
            onClick={() => approve.mutate({ id: clip.id, isApproved: !clip.isApproved })}
            disabled={approve.isPending}
            title={clip.isApproved ? 'Batalkan persetujuan' : 'Setujui klip'}
          >
            {clip.isApproved ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
          </Button>
          {ready ? (
            <Button asChild size="icon-sm" variant="ghost" title="Unduh klip">
              <a href={mediaUrl(clip.videoUrl, { download: true }) ?? '#'} download>
                <Download className="h-3 w-3" />
              </a>
            </Button>
          ) : null}
        </div>

        {render.isError || liveProgress?.stage === 'failed' ? (
          <p className="text-[10px] text-negative">
            {liveProgress?.stage === 'failed'
              ? liveProgress.label
              : (render.error as Error)?.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default function ClippingSourceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const sourceId = Number(id)
  const validSourceId = Number.isFinite(sourceId) ? sourceId : null
  const sseStatus = useClippingSSE(validSourceId ?? undefined)
  const detail = useClipSource(validSourceId)
  const system = useSystemStatus()
  const health = system.data?.clipping ?? null

  if (!Number.isFinite(sourceId)) {
    return (
      <ErrorState
        title="ID tidak valid"
        message="Alamat halaman tidak memuat ID sumber yang benar."
      />
    )
  }

  if (detail.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-[420px] w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (detail.isError || !detail.data) {
    return (
      <ErrorState
        title="Sumber tidak ditemukan"
        message={(detail.error as Error)?.message ?? 'Sumber klip ini mungkin sudah dihapus.'}
        onRetry={() => detail.refetch()}
      />
    )
  }

  const source = detail.data
  const clips = source.clips
  const rendered = clips.filter((clip) => clip.videoUrl)
  const stalled = isStalled(source, health)

  return (
    <div>
      <div className="mb-3">
        <Button asChild size="sm" variant="ghost">
          <Link to="/clipping">
            <ArrowLeft className="h-3.5 w-3.5" />
            Kembali ke antrean
          </Link>
        </Button>
      </div>

      <PageHeader
        eyebrow={`Sumber #${source.id} · ${source.platform}`}
        title={source.title || 'Tanpa judul'}
        description={source.url}
        actions={
          <>
            <LiveIndicator state={sseStatus} label="Render live" />
            <Button asChild size="sm" variant="outline">
              <a href={source.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Buka aslinya
              </a>
            </Button>
            {source.status === 'failed' || source.status === 'completed' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => detail.refetch()}
                title="Muat ulang status"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Muat ulang
              </Button>
            ) : null}
          </>
        }
      />

      {/* Ringkasan status + tahapan */}
      <Card className="mb-4">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span
              className={cn(
                'font-mono text-[11px] uppercase tracking-wider',
                STATUS_TONE[source.status],
              )}
            >
              {source.status}
            </span>
            <span className="text-border">|</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {formatDuration(source.durationSeconds ?? 0)}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {source.transcriptWordCount} kata transkrip
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {clips.length} klip · {rendered.length} ter-render
            </span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
              <Clock className="mr-1 inline h-2.5 w-2.5" />
              {formatRelative(source.createdAt)}
            </span>
          </div>

          {isActiveStatus(source.status) || stalled ? (
            <>
              <ProgressSteps source={source} health={health} />
              <ProgressSummary source={source} health={health} />
            </>
          ) : source.status === 'completed' ? (
            <p className="flex items-center gap-1.5 text-[10px] text-positive">
              <Check className="h-3 w-3" />
              Pipeline selesai — {clips.length} klip dihasilkan
              {rendered.length < clips.length
                ? `. ${clips.length - rendered.length} klip belum dirender.`
                : ' dan semuanya siap diunduh.'}
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-[10px] leading-snug text-negative">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {source.errorMessage ?? 'Pipeline gagal tanpa pesan.'}
            </p>
          )}

          {source.hasHeatmap === false && source.status === 'completed' ? (
            <p className="text-[10px] leading-snug text-muted-foreground/70">
              Heatmap YouTube tidak tersedia untuk video ini, sehingga skor kurasi hanya
              memakai sinyal lain (transkrip/energi audio/posisi).
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wider text-muted-foreground">
              <Scissors className="h-3.5 w-3.5" />
              Klip hasil generate
            </h2>
            <span className="font-mono text-[10px] text-muted-foreground/70">
              {rendered.length}/{clips.length} ter-render
            </span>
          </div>

          {clips.length === 0 ? (
            <EmptyState
              icon={Film}
              title="Belum ada klip"
              description={
                source.status === 'failed'
                  ? 'Pipeline gagal sebelum menghasilkan klip. Periksa pesan error di atas, lalu ulangi ingest.'
                  : 'Klip muncul otomatis di sini setelah kurasi AI selesai. Halaman ini menyegarkan diri tiap beberapa detik.'
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {clips.map((clip) => (
                <ClipDetailCard key={clip.id} clip={clip} sourceStatus={source.status} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          {source.sourceVideoUrl ? (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Video sumber
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <video
                  src={mediaUrl(source.sourceVideoUrl) ?? undefined}
                  controls
                  preload="metadata"
                  className="w-full rounded bg-black"
                />
                <p className="mt-1.5 text-[9px] leading-snug text-muted-foreground/70">
                  Video asli hasil unduhan. Gunakan pemutar ini untuk memeriksa apakah
                  potongan klip sudah tepat.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Tahapan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3 pt-0">
              <StepTrail source={source} health={health} />
              <p className="font-mono text-[9px] text-muted-foreground/70">
                {stalled
                  ? `macet ${formatAge(source.statusAgeSeconds)}`
                  : source.status === 'completed'
                    ? 'selesai'
                    : `${formatAge(source.statusAgeSeconds)} di tahap ini`}
              </p>
              <div className="flex items-center gap-1.5 pt-1">
                <Badge variant="outline" className="text-[9px]">
                  {source.transcriptWordCount > 0 ? 'transkrip ✓' : 'tanpa transkrip'}
                </Badge>
                <Badge variant="outline" className="text-[9px]">
                  {source.hasHeatmap ? 'heatmap ✓' : 'tanpa heatmap'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
