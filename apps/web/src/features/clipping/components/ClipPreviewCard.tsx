import { useState } from 'react'
import {
  Check,
  Clock,
  Film,
  Loader2,
  Play,
  Scissors,
  Share2,
  Sparkles,
  X,
} from 'lucide-react'
import type { ClipRenderMode, GeneratedClipDTO } from '@media-intel/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import {
  RENDER_MODE_LABEL,
  RENDER_MODE_HINT,
  formatDuration,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { useApproveClip, useRenderClip, useResolvedClipRenderProgress } from '@/hooks/useClipping'

const RENDER_MODES: ClipRenderMode[] = ['split_screen', 'face_reframe', 'blur_background']

export function ViralityMeter({ score }: { score: number }) {
  const tone =
    score >= 80 ? 'text-positive' : score >= 60 ? 'text-warning' : 'text-muted-foreground'
  const bar = score >= 80 ? 'bg-positive' : score >= 60 ? 'bg-warning' : 'bg-muted-foreground/50'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-secondary">
        <div className={cn('h-full rounded-full', bar)} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <span className={cn('font-mono text-[11px] tabular-nums', tone)}>{score}</span>
    </div>
  )
}

export function ClipPreviewCard({
  clip,
  onDistribute,
}: {
  clip: GeneratedClipDTO
  onDistribute?: (clip: GeneratedClipDTO) => void
}) {
  const [renderMode, setRenderMode] = useState<ClipRenderMode>(clip.renderMode)
  const render = useRenderClip()
  const approve = useApproveClip()
  const liveProgress = useResolvedClipRenderProgress(clip)

  const ready = Boolean(clip.outputFilePath)
  const isRendering =
    render.isPending ||
    (Boolean(liveProgress) &&
      liveProgress!.stage !== 'completed' &&
      liveProgress!.stage !== 'failed')
  const pct = liveProgress ? Math.max(0, Math.min(100, Math.round(liveProgress.progress))) : 0

  return (
    <Card className="group relative overflow-hidden transition-colors hover:border-border">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground/70">
                #{clip.id}
              </span>
              <Badge variant={ready ? 'positive' : 'outline'} className="text-[9px]">
                {ready ? 'Siap' : 'Belum dirender'}
              </Badge>
              {clip.isApproved ? (
                <Badge variant="default" className="text-[9px]">
                  <Check className="h-2.5 w-2.5" /> Disetujui
                </Badge>
              ) : null}
            </div>
            <p className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
              {clip.titleHook}
            </p>
          </div>
          <ViralityMeter score={clip.viralityScore} />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            {formatDuration(clip.startTime)} – {formatDuration(clip.endTime)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Scissors className="h-2.5 w-2.5" />
            {clip.durationSeconds.toFixed(0)}s
          </span>
          <span className="inline-flex items-center gap-1">
            <Film className="h-2.5 w-2.5" />
            {RENDER_MODE_LABEL[clip.renderMode]}
          </span>
          {clip.distributionCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Share2 className="h-2.5 w-2.5" />
              {clip.distributionCount} akun
            </span>
          ) : null}
        </div>

        {clip.aiReasoning ? (
          <p className="line-clamp-2 rounded border border-border/50 bg-secondary/30 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <Sparkles className="mr-1 inline h-2.5 w-2.5 text-primary/70" />
            {clip.aiReasoning}
          </p>
        ) : null}

        {isRendering && liveProgress ? (
          <div className="space-y-1.5 rounded-md border border-primary/25 bg-primary/5 p-2">
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span className="truncate font-medium text-primary">{liveProgress.label}</span>
              <span className="font-mono font-semibold text-foreground tabular-nums">{pct}%</span>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-300 ease-out"
                style={{ width: `${Math.max(4, pct)}%` }}
              >
                <div className="absolute inset-y-0 left-0 w-1/2 animate-shimmer bg-gradient-to-r from-transparent via-white/45 to-transparent" />
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-1.5">
          <Select
            value={renderMode}
            onChange={(event) => setRenderMode(event.target.value as ClipRenderMode)}
            className="h-8 text-xs"
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
            {isRendering ? `${pct}%` : ready ? 'Render ulang' : 'Render'}
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
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => onDistribute?.(clip)}
            disabled={!ready}
            title={ready ? 'Jadwalkan distribusi' : 'Render klip terlebih dahulu'}
          >
            <Share2 className="h-3 w-3" />
            Distribusi
          </Button>
        </div>

        {render.isError ? (
          <p className="text-[10px] text-negative">{(render.error as Error)?.message}</p>
        ) : null}
        {render.isSuccess && !render.data?.queued ? (
          <p className="text-[10px] text-warning">
            Job render tidak terkirim (Redis offline). Klip tetap tercatat.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
