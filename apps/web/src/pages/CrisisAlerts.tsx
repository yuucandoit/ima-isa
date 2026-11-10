import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  BellRing,
  CheckCheck,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Webhook,
  Zap,
} from 'lucide-react'
import type { AlertDTO, AlertSeverity, SseAlertEvent } from '@media-intel/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { SeverityBadge } from '@/components/shared/Badges'
import { SeverityStripe } from '@/components/shared/Misc'
import { LiveIndicator } from '@/components/shared/LiveIndicator'
import { useAlerts } from '@/hooks/useAnalytics'
import { useSSE } from '@/hooks/useSSE'
import {
  fetchNotificationChannels,
  requestAlertScan,
  resolveAlert,
  seedDemoData,
} from '@/lib/api'
import { formatDateTime, formatNumber, formatPercent, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

type ResolutionFilter = 'active' | 'all' | 'resolved'

function AlertCard({
  alert,
  onResolve,
  resolving,
}: {
  alert: AlertDTO
  onResolve: () => void
  resolving: boolean
}) {
  const metrics = alert.metricsSnapshot
  return (
    <Card className="relative overflow-hidden">
      <SeverityStripe severity={alert.severity} />
      <CardContent className="space-y-3 p-4 pl-5">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge value={alert.severity} />
          {alert.keywordLabel ? <Badge variant="outline">{alert.keywordLabel}</Badge> : null}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {formatRelative(alert.triggeredAt)}
          </span>
        </div>

        <div>
          <h3 className="text-sm font-semibold leading-snug text-foreground">{alert.title}</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {alert.description}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-md border border-border/60 bg-background/40 py-2">
          <div className="px-3">
            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {metrics ? `${metrics.volumeIncreasePct > 0 ? '+' : ''}${metrics.volumeIncreasePct.toFixed(0)}%` : '—'}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">lonjakan</p>
          </div>
          <div className="border-x border-border/50 px-3">
            <p className="font-mono text-sm font-semibold tabular-nums text-negative">
              {metrics ? formatPercent(metrics.negativeRatio * 100) : '—'}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">negatif</p>
          </div>
          <div className="px-3">
            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {metrics?.recentVolume !== undefined
                ? `${formatNumber(metrics.recentVolume)} / ${metrics.baselineVolume?.toFixed(1) ?? '0'}`
                : '—'}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
              volume vs baseline
            </p>
          </div>
        </div>

        {metrics?.sampleHeadlines?.length ? (
          <ul className="space-y-1">
            {metrics.sampleHeadlines.slice(0, 3).map((headline) => (
              <li key={headline} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                <span className="line-clamp-1">{headline}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-center justify-between border-t border-border/50 pt-2.5">
          <span className="font-mono text-[9px] text-muted-foreground/70">
            {formatDateTime(alert.triggeredAt)}
          </span>
          {alert.isResolved ? (
            <Badge variant="positive">
              <CheckCheck className="h-3 w-3" />
              Selesai
            </Badge>
          ) : (
            <Button variant="outline" size="sm" onClick={onResolve} disabled={resolving}>
              <ShieldCheck className="h-3.5 w-3.5" />
              Tandai selesai
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function CrisisAlertsPage() {
  const [resolution, setResolution] = useState<ResolutionFilter>('active')
  const [severity, setSeverity] = useState<'' | AlertSeverity>('')
  const [notice, setNotice] = useState<string | null>(null)
  const [incoming, setIncoming] = useState<SseAlertEvent | null>(null)
  const queryClient = useQueryClient()

  const params = useMemo(
    () => ({
      page: 1,
      limit: 30,
      severity: severity || undefined,
      resolved: resolution === 'all' ? undefined : resolution === 'active' ? false : true,
    }),
    [resolution, severity],
  )

  const alerts = useAlerts(params)
  const channels = useQuery({
    queryKey: ['notification-channels'],
    queryFn: fetchNotificationChannels,
    staleTime: 60_000,
  })

  const sseStatus = useSSE(
    'alerts',
    {
      alert: (payload) => {
        const event = payload as SseAlertEvent
        setIncoming(event)
        void queryClient.invalidateQueries({ queryKey: ['alerts'] })
        setTimeout(() => setIncoming(null), 12_000)
      },
    },
    true,
  )

  const scan = useMutation({
    mutationFn: requestAlertScan,
    onSuccess: async (result) => {
      setNotice(
        result.triggered > 0
          ? `Scan selesai: ${result.triggered} peringatan baru dipicu dari ${result.scanned} kata kunci.`
          : `Scan selesai: tidak ada lonjakan baru dari ${result.scanned} kata kunci.`,
      )
      await queryClient.invalidateQueries()
      setTimeout(() => setNotice(null), 8_000)
    },
  })

  const resolve = useMutation({
    mutationFn: (id: string) => resolveAlert(id, true),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['alerts'] })
    },
  })

  const seed = useMutation({
    mutationFn: seedDemoData,
    onSuccess: async (result) => {
      setNotice(result.message)
      await queryClient.invalidateQueries()
      setTimeout(() => setNotice(null), 8_000)
    },
  })

  return (
    <div>
      <PageHeader
        eyebrow="Crisis & spike engine"
        title="Crisis Alerts"
        description="Deteksi dini lonjakan isu: volume 30 menit dibanding baseline 6 jam, dan rasio sentimen negatif. Peringatan HIGH/CRITICAL otomatis dikirim ke Telegram atau webhook."
        actions={
          <>
            <span className="hidden sm:block">
              <LiveIndicator state={sseStatus} />
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => alerts.refetch()}
              disabled={alerts.isFetching}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', alerts.isFetching && 'animate-spin')} />
            </Button>
            <Button size="sm" onClick={() => scan.mutate()} disabled={scan.isPending}>
              <Zap className={cn('h-3.5 w-3.5', scan.isPending && 'animate-pulse')} />
              {scan.isPending ? 'Memindai…' : 'Scan sekarang'}
            </Button>
          </>
        }
      />

      {incoming ? (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-warning/35 bg-warning/10 px-4 py-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge value={incoming.severity} />
              <span className="text-xs font-medium text-foreground">{incoming.title}</span>
              <Badge variant="outline" className="font-mono">
                live
              </Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
              {incoming.description}
            </p>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="mb-4 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
          {notice}
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <div className="inline-flex items-center rounded-md border border-border/80 bg-background/40 p-0.5">
              {(
                [
                  { key: 'active', label: 'Aktif' },
                  { key: 'all', label: 'Semua' },
                  { key: 'resolved', label: 'Selesai' },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setResolution(option.key)}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    resolution === option.key
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <Select
              value={severity}
              onChange={(event) => setSeverity(event.target.value as '' | AlertSeverity)}
              className="w-[150px]"
            >
              <option value="">Semua level</option>
              <option value="CRITICAL">Kritis</option>
              <option value="HIGH">Tinggi</option>
              <option value="MEDIUM">Sedang</option>
              <option value="LOW">Rendah</option>
            </Select>

            <Badge variant="outline" className="ml-auto font-mono">
              {formatNumber(alerts.data?.meta.total ?? 0)} peringatan
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <span className="label-caps whitespace-nowrap">Kanal</span>
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[10px]',
                channels.data?.telegram ? 'text-positive' : 'text-muted-foreground/60',
              )}
            >
              <MessageSquare className="h-3 w-3" />
              Telegram
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[10px]',
                channels.data?.webhook ? 'text-positive' : 'text-muted-foreground/60',
              )}
            >
              <Webhook className="h-3 w-3" />
              Webhook
            </span>
          </CardContent>
        </Card>
      </div>

      {scan.isError ? (
        <div className="mb-3 rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative">
          {(scan.error as Error)?.message}
        </div>
      ) : null}

      {alerts.isError ? (
        <ErrorState message={(alerts.error as Error)?.message} onRetry={() => alerts.refetch()} />
      ) : alerts.isLoading ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index}>
              <CardContent className="space-y-3 p-5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-14 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : alerts.data && alerts.data.data.length > 0 ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {alerts.data.data.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              resolving={resolve.isPending && resolve.variables === alert.id}
              onResolve={() => resolve.mutate(alert.id)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ShieldCheck}
          title="Tidak ada peringatan pada filter ini"
          description="Detektor berjalan otomatis setiap 5 menit. Anda juga bisa memicu pemindaian manual atau memuat dataset demo yang berisi lonjakan isu BBM."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="outline" onClick={() => scan.mutate()} disabled={scan.isPending}>
                <Activity className="h-3.5 w-3.5" />
                Scan manual
              </Button>
              <Button size="sm" onClick={() => seed.mutate()} disabled={seed.isPending}>
                <Sparkles className="h-3.5 w-3.5" />
                Muat data demo
              </Button>
            </div>
          }
        />
      )}

      <div className="mt-4 flex items-start gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2.5">
        <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Aturan trigger: volume 30 menit &gt; 2,5× baseline ATAU sentimen negatif ≥ 65%, dengan
          minimum 5 artikel dan cooldown 30 menit per kata kunci. Notifikasi HIGH/CRITICAL dikirim
          ke kanal yang dikonfigurasi pada <code className="text-foreground/80">.env</code>.
        </p>
      </div>
    </div>
  )
}
