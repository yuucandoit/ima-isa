import { NavLink } from 'react-router-dom'
import {
  Activity,
  Boxes,
  ChevronRight,
  LayoutDashboard,
  Newspaper,
  Radar,
  Settings,
  ShieldAlert,
  TrendingUp,
  X,
} from 'lucide-react'
import { useAlerts } from '@/hooks/useAnalytics'
import { useSystemStatus } from '@/hooks/useAnalytics'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/media', label: 'Media Monitoring', icon: Newspaper },
  { to: '/clusters', label: 'Topic Clusters', icon: Boxes },
  { to: '/trending', label: 'Trending & Tokoh', icon: TrendingUp },
  { to: '/alerts', label: 'Crisis Alerts', icon: ShieldAlert },
  { to: '/settings', label: 'Pengaturan', icon: Settings },
]

function StatusRow({
  label,
  state,
}: {
  label: string
  state: 'ok' | 'error' | 'disabled' | 'loading'
}) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 font-mono uppercase tracking-wider">
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            state === 'ok' && 'bg-positive',
            state === 'error' && 'bg-negative',
            state === 'disabled' && 'bg-muted-foreground/40',
            state === 'loading' && 'animate-pulse bg-muted-foreground/60',
          )}
        />
        <span
          className={cn(
            state === 'ok' && 'text-foreground/80',
            state === 'error' && 'text-negative',
            state === 'disabled' && 'text-muted-foreground/60',
            state === 'loading' && 'text-muted-foreground/60',
          )}
        >
          {state === 'loading' ? 'cek' : state === 'disabled' ? 'off' : state}
        </span>
      </span>
    </div>
  )
}

export function AppSidebar({
  onNavigate,
  onClose,
  mobile = false,
}: {
  onNavigate?: () => void
  onClose?: () => void
  mobile?: boolean
}) {
  const alerts = useAlerts({ limit: 1, resolved: false })
  const status = useSystemStatus()
  const activeAlerts = alerts.data?.meta.total ?? 0

  return (
    <aside
      className={cn(
        'flex h-full w-[248px] flex-col border-r border-border/70 bg-background/80 backdrop-blur-xl',
        mobile ? 'relative' : 'fixed inset-y-0 left-0 z-30 hidden md:flex',
      )}
    >
      <div className="flex items-center gap-2.5 border-b border-border/70 px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
          <Radar className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[13px] font-semibold tracking-[0.18em] text-foreground">
            IMA-ISA
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            Media &amp; Social Intelligence
          </p>
        </div>
        {mobile ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Tutup menu"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        <div>
          <p className="px-2 pb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
            Pemantauan
          </p>
          <ul className="space-y-0.5">
            {NAV_ITEMS.slice(0, 5).map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors',
                      isActive
                        ? 'bg-secondary/80 text-foreground'
                        : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          isActive ? 'text-primary' : 'text-muted-foreground/70',
                        )}
                      />
                      <span className="flex-1">{item.label}</span>
                      {item.to === '/alerts' && activeAlerts > 0 ? (
                        <span className="rounded border border-critical/30 bg-critical/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-critical">
                          {activeAlerts}
                        </span>
                      ) : isActive ? (
                        <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
                      ) : null}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="px-2 pb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
            Sistem
          </p>
          <ul className="space-y-0.5">
            {NAV_ITEMS.slice(5).map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors',
                      isActive
                        ? 'bg-secondary/80 text-foreground'
                        : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          isActive ? 'text-primary' : 'text-muted-foreground/70',
                        )}
                      />
                      <span className="flex-1">{item.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="space-y-3 border-t border-border/70 px-5 py-4">
        <div className="flex items-center justify-between">
          <span className="label-caps">Status pipeline</span>
          <Activity className="h-3 w-3 text-muted-foreground/60" />
        </div>
        <div className="space-y-1.5">
          <StatusRow
            label="PostgreSQL"
            state={status.isLoading ? 'loading' : status.data?.database ?? 'error'}
          />
          <StatusRow
            label="Redis Streams"
            state={status.isLoading ? 'loading' : status.data?.redis ?? 'error'}
          />
          <StatusRow
            label="LLM Gateway"
            state={status.isLoading ? 'loading' : status.data?.llm ?? 'error'}
          />
        </div>
        <div className="rounded-md border border-border/60 bg-card/50 px-2.5 py-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Artikel terindeks
            </span>
            <span className="font-mono text-xs tabular-nums text-foreground">
              {status.data ? formatNumber(status.data.counts.mediaItems) : '—'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Antrean raw
            </span>
            <span className="font-mono text-xs tabular-nums text-foreground">
              {status.data ? formatNumber(status.data.worker.backlog) : '—'}
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}
