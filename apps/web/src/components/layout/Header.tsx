import { useEffect, useState } from 'react'
import { Menu, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { PageBreadcrumb } from '@/components/shared/Misc'
import { Button } from '@/components/ui/button'
import { useSystemStatus } from '@/hooks/useAnalytics'
import { cn } from '@/lib/utils'

function clock(): string {
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jakarta',
  }).format(new Date())
}

function headerDate(): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(new Date())
}

export function Header({ onOpenMenu }: { onOpenMenu: () => void }) {
  const [time, setTime] = useState(clock)
  const status = useSystemStatus()
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setTime(clock()), 1_000)
    return () => clearInterval(timer)
  }, [])

  const online = status.data?.database === 'ok'

  const refreshAll = async () => {
    setRefreshing(true)
    try {
      await queryClient.invalidateQueries()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={onOpenMenu}
          aria-label="Buka menu"
        >
          <Menu className="h-4 w-4" />
        </Button>

        <PageBreadcrumb />

        <div className="ml-auto flex items-center gap-2 sm:gap-4">
          <span
            className={cn(
              'hidden items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] sm:inline-flex',
              online
                ? 'border-positive/30 bg-positive/10 text-positive'
                : 'border-negative/30 bg-negative/10 text-negative',
            )}
          >
            {online ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
            {online ? 'Pipeline online' : 'Pipeline offline'}
          </span>

          <div className="hidden text-right sm:block">
            <p className="font-mono text-xs tabular-nums text-foreground">{time} WIB</p>
            <p className="text-[10px] capitalize text-muted-foreground">{headerDate()}</p>
          </div>

          <Button
            variant="outline"
            size="icon-sm"
            onClick={refreshAll}
            aria-label="Muat ulang data"
            disabled={refreshing}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>
    </header>
  )
}
