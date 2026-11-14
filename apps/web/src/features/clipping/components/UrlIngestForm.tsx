import { useState } from 'react'
import { Link2, Loader2, Sparkles, Wand2 } from 'lucide-react'
import type { ClipRenderMode } from '@media-intel/types'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RENDER_MODE_HINT, RENDER_MODE_LABEL } from '@/lib/format'
import { useIngestSource } from '@/hooks/useClipping'

const SAMPLE_URLS = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.tiktok.com/@akun/video/7300000000000000000',
]

export function UrlIngestForm({ onSubmitted }: { onSubmitted?: (sourceId: number) => void }) {
  const [url, setUrl] = useState('')
  const [maxClips, setMaxClips] = useState(8)
  const [renderMode, setRenderMode] = useState<ClipRenderMode>('split_screen')
  const [language, setLanguage] = useState('id')
  const ingest = useIngestSource()

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!url.trim()) return
    ingest.mutate(
      {
        url: url.trim(),
        maxClips,
        renderMode,
        language: language || undefined,
      },
      {
        onSuccess: (source) => {
          setUrl('')
          onSubmitted?.(source.id)
        },
      },
    )
  }

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Mulai kliping video
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Tempel URL YouTube / TikTok / Instagram / X. Worker akan mengunduh, mentranskripsi,
            lalu memilih momen paling viral.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="clip-url">URL video sumber</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
                <Input
                  id="clip-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  className="pl-8"
                  autoComplete="off"
                />
              </div>
              <Button type="submit" disabled={ingest.isPending || !url.trim()}>
                {ingest.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                Proses
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="clip-mode">Mode render</Label>
              <Select
                id="clip-mode"
                value={renderMode}
                onChange={(event) => setRenderMode(event.target.value as ClipRenderMode)}
              >
                {(Object.keys(RENDER_MODE_LABEL) as ClipRenderMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {RENDER_MODE_LABEL[mode]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clip-max">Jumlah klip</Label>
              <Select
                id="clip-max"
                value={String(maxClips)}
                onChange={(event) => setMaxClips(Number(event.target.value))}
              >
                {[4, 6, 8, 10, 12].map((count) => (
                  <option key={count} value={count}>
                    {count} klip
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clip-lang">Bahasa transkrip</Label>
              <Select
                id="clip-lang"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option value="id">Indonesia</option>
                <option value="en">Inggris</option>
                <option value="">Deteksi otomatis</option>
              </Select>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {RENDER_MODE_HINT[renderMode]}
          </p>

          {ingest.isError ? (
            <p className="text-[11px] text-negative">{(ingest.error as Error)?.message}</p>
          ) : null}

          {ingest.isSuccess ? (
            <p className="text-[11px] text-positive">
              Sumber #{ingest.data.id} diantrekan. Status diperbarui otomatis.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
              Contoh
            </span>
            {SAMPLE_URLS.map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => setUrl(sample)}
                className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {new URL(sample).hostname.replace('www.', '')}
              </button>
            ))}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
