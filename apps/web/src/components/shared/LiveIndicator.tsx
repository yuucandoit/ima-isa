import { Power } from 'lucide-react'
import { cn } from '@/lib/utils'

export type LiveState = 'connected' | 'connecting' | 'disconnected' | 'disabled'

export function LiveIndicator({
  state,
  label,
  className,
}: {
  state: LiveState
  label?: string
  className?: string
}) {
  const copy =
    label ??
    (state === 'connected'
      ? 'Live'
      : state === 'connecting'
        ? 'Menghubungkan'
        : state === 'disabled'
          ? 'Nonaktif'
          : 'Terputus')

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]',
        state === 'connected' && 'border-positive/30 bg-positive/10 text-positive',
        state === 'connecting' && 'border-warning/30 bg-warning/10 text-warning',
        state === 'disconnected' && 'border-negative/30 bg-negative/10 text-negative',
        state === 'disabled' && 'border-border bg-secondary/60 text-muted-foreground',
        className,
      )}
    >
      {state === 'connected' ? (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
        </span>
      ) : state === 'disabled' ? (
        <Power className="h-2.5 w-2.5" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      )}
      {copy}
    </span>
  )
}
