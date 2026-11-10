import type { ComponentType } from 'react'
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
}: {
  title: string
  description?: string
  icon?: ComponentType<{ className?: string }>
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/70 bg-card/30 px-6 py-12 text-center',
        className,
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-secondary/40 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

export function ErrorState({
  title = 'Gagal memuat data',
  message,
  onRetry,
  className,
}: {
  title?: string
  message?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-negative/25 bg-negative/5 px-6 py-10 text-center',
        className,
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-negative/30 bg-negative/10 text-negative">
        <AlertTriangle className="h-4 w-4" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          {message ??
            'Pastikan API, PostgreSQL, dan Redis berjalan. Jalankan `docker compose up -d` lalu `bun run dev:api`.'}
        </p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" />
          Coba lagi
        </Button>
      ) : null}
    </div>
  )
}
