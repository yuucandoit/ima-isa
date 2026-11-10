import { useState } from 'react'
import type { MediaItemDTO } from '@media-intel/types'
import { Check, Copy, ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SentimentBadge } from '@/components/shared/Badges'
import {
  PLATFORM_LABEL,
  formatDateTime,
  formatPercent,
  SENTIMENT_COLOR,
} from '@/lib/format'

function EntityGroup({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="label-caps">{label}</p>
      <div className="flex flex-wrap gap-1">
        {values.map((value) => (
          <Badge key={value} variant="secondary" className="font-normal">
            {value}
          </Badge>
        ))}
      </div>
    </div>
  )
}

export function ArticleDetailDialog({
  item,
  open,
  onOpenChange,
}: {
  item: MediaItemDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [copied, setCopied] = useState(false)
  if (!item) return null

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(item.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1_800)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{PLATFORM_LABEL[item.platform]}</Badge>
            <SentimentBadge value={item.sentiment} />
            <span className="font-mono text-[10px] text-muted-foreground">
              {formatDateTime(item.publishedAt)}
            </span>
          </div>
          <DialogTitle className="pr-4 text-lg leading-snug">{item.title}</DialogTitle>
          <DialogDescription>
            {item.sourceName ?? 'Tanpa sumber'}
            {item.author ? ` · ${item.author}` : ''}
            {item.sourceDomain ? ` · ${item.sourceDomain}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-5 overflow-y-auto p-5">
          <div className="rounded-md border border-border/70 bg-background/40 p-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Confidence sentimen</span>
              <span
                className="font-mono font-medium tabular-nums"
                style={{ color: SENTIMENT_COLOR[item.sentiment] }}
              >
                {formatPercent(item.sentimentScore * 100, 1)}
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, item.sentimentScore * 100)}%`,
                  background: SENTIMENT_COLOR[item.sentiment],
                }}
              />
            </div>
          </div>

          <div className="space-y-3 text-sm leading-relaxed text-foreground/85">
            {item.cleanContent.split(/\n+/).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>

          <div className="grid gap-4 border-t border-border/60 pt-4 sm:grid-cols-3">
            <EntityGroup label="Tokoh" values={item.entities.persons} />
            <EntityGroup label="Organisasi" values={item.entities.organizations} />
            <EntityGroup label="Lokasi" values={item.entities.locations} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 p-4">
          <span className="max-w-[50%] truncate font-mono text-[10px] text-muted-foreground">
            {item.externalId}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyLink}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Tersalin' : 'Salin tautan'}
            </Button>
            <Button size="sm" asChild>
              <a href={item.url} target="_blank" rel="noreferrer">
                Buka artikel
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
