import { useRef, useState } from 'react'
import { Download, Film, Maximize2, Pause, Play, Sparkles, Volume2, VolumeX } from 'lucide-react'
import type { GeneratedClipDTO } from '@media-intel/types'
import { mediaUrl } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/format'
import { useClipRenderProgress, type ClipRenderProgress } from '@/hooks/useClipping'

function RenderProgressOverlay({
  progress,
}: {
  progress: ClipRenderProgress
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress.progress)))
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 overflow-hidden rounded-md bg-slate-950/88 px-5 text-center backdrop-blur-sm">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1/2 animate-shimmer bg-gradient-to-r from-transparent via-primary/15 to-transparent"
      />
      <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-primary/40 bg-primary/10 shadow-[0_0_24px_hsl(var(--primary)/0.35)]">
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary" />
        <Film className="h-5 w-5 text-primary" />
      </div>

      <div className="relative space-y-1">
        <div className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          <Sparkles className="h-2.5 w-2.5 animate-pulse" />
          <span>Rendering 9:16</span>
        </div>
        <p className="font-mono text-2xl font-bold tracking-tight text-white tabular-nums">
          {pct}%
        </p>
        <p className="max-w-[24ch] text-[11px] leading-snug text-white/75">
          {progress.label}
        </p>
      </div>

      <div className="relative h-2 w-full max-w-[200px] overflow-hidden rounded-full bg-white/15">
        <div
          className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-300 ease-out"
          style={{ width: `${Math.max(4, pct)}%` }}
        >
          <div className="absolute inset-y-0 left-0 w-1/2 animate-shimmer bg-gradient-to-r from-transparent via-white/50 to-transparent" />
        </div>
      </div>
    </div>
  )
}

/**
 * Pemutar video vertikal (9:16) untuk klip hasil render.
 *
 * Mengandalkan endpoint streaming API yang mendukung HTTP Range, jadi seek
 * berfungsi tanpa mengunduh seluruh berkas lebih dulu.
 */
export function ClipPlayer({
  clip,
  className,
  autoPlay = false,
  showMeta = true,
  renderProgress: renderProgressProp,
}: {
  clip: GeneratedClipDTO
  className?: string
  autoPlay?: boolean
  showMeta?: boolean
  renderProgress?: ClipRenderProgress
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [failed, setFailed] = useState(false)
  const [progress, setProgress] = useState(0)

  const subscribedProgress = useClipRenderProgress(clip.id)
  const activeProgress = renderProgressProp ?? subscribedProgress
  const isRendering =
    Boolean(activeProgress) &&
    activeProgress!.stage !== 'completed' &&
    activeProgress!.stage !== 'failed'

  const baseSrc = mediaUrl(clip.videoUrl)
  const src =
    baseSrc && clip.fileHash
      ? `${baseSrc}?v=${encodeURIComponent(clip.fileHash.slice(0, 12))}`
      : baseSrc
  const downloadSrc = mediaUrl(clip.videoUrl, { download: true })

  if (!src) {
    return (
      <div
        className={cn(
          'relative flex aspect-[9/16] max-h-[420px] flex-col items-center justify-center gap-2 overflow-hidden rounded-md border border-dashed border-border bg-secondary/20 px-4 text-center',
          className,
        )}
      >
        <p className="text-[11px] font-medium text-muted-foreground">Belum dirender</p>
        <p className="max-w-[26ch] text-[10px] leading-snug text-muted-foreground/70">
          Pilih mode lalu tekan <strong className="text-foreground/80">Render</strong> untuk
          menghasilkan video 9:16.
        </p>
        {isRendering && activeProgress ? (
          <RenderProgressOverlay progress={activeProgress} />
        ) : null}
      </div>
    )
  }

  const toggle = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play()
    } else {
      video.pause()
    }
  }

  return (
    <div className={cn('group relative overflow-hidden rounded-md bg-black', className)}>
      <video
        key={src}
        ref={videoRef}
        src={src}
        className="mx-auto block aspect-[9/16] max-h-[420px] w-full object-contain"
        playsInline
        preload="metadata"
        muted={muted}
        autoPlay={autoPlay}
        loop
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedData={() => setFailed(false)}
        onError={() => setFailed(true)}
        onTimeUpdate={(event) => {
          const video = event.currentTarget
          if (video.duration > 0) setProgress((video.currentTime / video.duration) * 100)
        }}
        onClick={toggle}
      />

      {isRendering && activeProgress ? (
        <RenderProgressOverlay progress={activeProgress} />
      ) : null}

      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 px-4 text-center">
          <p className="text-[11px] font-medium text-white/90">Video gagal dimuat</p>
          <p className="max-w-[28ch] text-[10px] leading-snug text-white/60">
            Berkas mungkin sudah dihapus dari disk. Render ulang klip ini.
          </p>
          {downloadSrc ? (
            <a
              href={downloadSrc}
              className="text-[10px] text-accent underline underline-offset-2"
            >
              Coba unduh langsung
            </a>
          ) : null}
        </div>
      ) : null}

      {/* Kontrol overlay */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2 pt-6 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? 'Jeda' : 'Putar'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/25"
          >
            {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </button>

          <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-white/90 transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>

          <button
            type="button"
            onClick={() => setMuted((value) => !value)}
            aria-label={muted ? 'Nyalakan suara' : 'Bisukan'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/25"
          >
            {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          </button>

          <a
            href={downloadSrc ?? src}
            download
            aria-label="Unduh klip"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/25"
          >
            <Download className="h-3 w-3" />
          </a>
        </div>
      </div>

      {showMeta ? (
        <div className="absolute left-2 top-2 flex items-center gap-1">
          <span className="rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-white/90 backdrop-blur-sm">
            {formatDuration(clip.durationSeconds)}
          </span>
          <span className="rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] uppercase text-white/90 backdrop-blur-sm">
            {clip.renderMode.replace('_', ' ')}
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** Grid klip dengan pemutar; dipakai di halaman detail sumber. */
export function ClipVideoGrid({
  clips,
  onOpen,
}: {
  clips: GeneratedClipDTO[]
  onOpen?: (clip: GeneratedClipDTO) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {clips.map((clip) => (
        <div key={clip.id} className="space-y-1.5">
          <ClipPlayer clip={clip} />
          <div className="flex items-center justify-between gap-1.5">
            <p className="line-clamp-1 text-[11px] font-medium text-foreground/90">
              {clip.titleHook}
            </p>
            {onOpen ? (
              <Button
                size="icon-sm"
                variant="ghost"
                title="Buka detail"
                onClick={() => onOpen(clip)}
              >
                <Maximize2 className="h-3 w-3" />
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
