import type { MediaItemDTO } from '@media-intel/types'
import { ArrowUpRight } from 'lucide-react'
import { formatRelative, SENTIMENT_COLOR, truncate } from '@/lib/format'
import { cn } from '@/lib/utils'

export function ArticleCard({
  item,
  onOpen,
  isNew = false,
}: {
  item: MediaItemDTO
  onOpen?: (item: MediaItemDTO) => void
  isNew?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(item)}
      className={cn(
        'group flex w-full gap-2.5 border-b border-border/50 px-1 py-2.5 text-left transition-colors last:border-0 hover:bg-secondary/25',
        isNew && 'animate-fade-in',
      )}
    >
      <span
        className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: SENTIMENT_COLOR[item.sentiment] }}
        aria-label={item.sentiment}
      />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-xs leading-relaxed text-foreground/90 group-hover:text-foreground">
          {isNew ? (
            <span className="mr-1.5 rounded-sm border border-primary/30 bg-primary/10 px-1 py-px align-[1px] font-mono text-[8px] uppercase tracking-wider text-primary">
              baru
            </span>
          ) : null}
          {truncate(item.title, 150)}
        </p>
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="truncate">{item.sourceName ?? item.sourceDomain ?? 'Tanpa sumber'}</span>
          <span className="text-border">·</span>
          <span className="shrink-0 font-mono">{formatRelative(item.publishedAt)}</span>
          <ArrowUpRight className="ml-auto h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
        </div>
      </div>
    </button>
  )
}
