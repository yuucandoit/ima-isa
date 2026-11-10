import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Database,
  Newspaper,
  Radar,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import type { MediaItemDTO, SseAlertEvent, SseMediaEvent } from '@media-intel/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { RangeTabs } from '@/components/shared/RangeTabs'
import { LiveIndicator } from '@/components/shared/LiveIndicator'
import { ErrorState, EmptyState } from '@/components/shared/States'
import { SeverityBadge } from '@/components/shared/Badges'
import { SentimentTrendChart } from '@/components/charts/SentimentTrendChart'
import { ShareOfVoiceChart } from '@/components/charts/ShareOfVoiceChart'
import { PlatformVolumeChart } from '@/components/charts/PlatformVolumeChart'
import { ActivityHeatmap, EntityList } from '@/components/charts/InsightPanels'
import { LocationInsightsSkeleton } from '@/components/map/LocationInsightsSkeleton'
import { ArticleCard } from '@/components/feeds/ArticleCard'
import { ArticleDetailDialog } from '@/components/feeds/ArticleDetailDialog'
import { useAlerts, useAnalytics, useFeeds, useLocationAnalytics } from '@/hooks/useAnalytics'
import { useSSE } from '@/hooks/useSSE'
import { fetchFeed, seedDemoData } from '@/lib/api'
import { formatNumber, formatRelative, rangeFromPreset, type RangePreset } from '@/lib/format'
import { cn } from '@/lib/utils'

// Peta (MapLibre) dimuat terpisah agar bundle awal dashboard tetap ringan.
const LocationInsights = lazy(() =>
  import('@/components/map/LocationInsights').then((module) => ({
    default: module.LocationInsights,
  })),
)

function KpiCard({
  label,
  value,
  suffix,
  hint,
  trend,
  icon: Icon,
  accent = 'primary',
}: {
  label: string
  value: string
  suffix?: string
  hint?: React.ReactNode
  trend?: { value: number; label: string }
  icon: React.ComponentType<{ className?: string }>
  accent?: 'primary' | 'negative' | 'warning' | 'accent'
}) {
  return (
    <Card className="relative overflow-hidden">
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-px',
          accent === 'primary' && 'bg-gradient-to-r from-transparent via-primary/60 to-transparent',
          accent === 'negative' && 'bg-gradient-to-r from-transparent via-negative/60 to-transparent',
          accent === 'warning' && 'bg-gradient-to-r from-transparent via-warning/60 to-transparent',
          accent === 'accent' && 'bg-gradient-to-r from-transparent via-accent/60 to-transparent',
        )}
      />
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="label-caps">{label}</span>
          <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="kpi-value">{value}</span>
          {suffix ? (
            <span className="text-xs font-medium text-muted-foreground">{suffix}</span>
          ) : null}
        </div>
        <div className="flex min-h-[16px] items-center gap-1.5 text-[10px] text-muted-foreground">
          {trend ? (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-mono tabular-nums',
                trend.value >= 0 ? 'text-positive' : 'text-negative',
              )}
            >
              {trend.value >= 0 ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {Math.abs(trend.value).toFixed(0)}%
            </span>
          ) : null}
          {hint}
        </div>
      </CardContent>
    </Card>
  )
}

function AlertBanner({ alert, onDismiss }: { alert: SseAlertEvent; onDismiss: () => void }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-warning/35 bg-warning/10 px-4 py-3">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge value={alert.severity} />
          <span className="text-xs font-medium text-foreground">{alert.title}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{alert.description}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Tutup
      </Button>
    </div>
  )
}

export default function OverviewPage() {
  const [preset, setPreset] = useState<RangePreset>('7d')
  const range = useMemo(() => rangeFromPreset(preset), [preset])
  const analytics = useAnalytics(range)
  const locations = useLocationAnalytics({ from: range.from, to: range.to })
  const feeds = useFeeds({ limit: 6, from: range.from, to: range.to })
  const alerts = useAlerts({ limit: 5, resolved: false })
  const [liveItems, setLiveItems] = useState<SseMediaEvent[]>([])
  const [incomingAlert, setIncomingAlert] = useState<SseAlertEvent | null>(null)
  const [selected, setSelected] = useState<MediaItemDTO | null>(null)
  const queryClient = useQueryClient()

  const seed = useMutation({
    mutationFn: seedDemoData,
    onSuccess: async () => {
      setLiveItems([])
      await queryClient.invalidateQueries()
    },
  })

  const sseStatus = useSSE(
    'media,alerts',
    {
      media: (payload) => {
        const event = payload as SseMediaEvent
        setLiveItems((previous) => {
          if (previous.some((item) => item.id === event.id)) return previous
          return [event, ...previous].slice(0, 8)
        })
      },
      alert: (payload) => {
        const event = payload as SseAlertEvent
        if (event.severity === 'HIGH' || event.severity === 'CRITICAL') {
          setIncomingAlert(event)
        }
        void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      },
    },
    true,
  )

  useEffect(() => {
    if (!incomingAlert) return
    const timer = setTimeout(() => setIncomingAlert(null), 12_000)
    return () => clearTimeout(timer)
  }, [incomingAlert])

  useEffect(() => {
    setLiveItems([])
  }, [preset])

  const openItem = async (item: MediaItemDTO) => {
    if (!item.cleanContent) {
      try {
        const full = await queryClient.fetchQuery({
          queryKey: ['feed', item.id],
          queryFn: () => fetchFeed(item.id),
        })
        setSelected(full)
      } catch {
        setSelected(null)
      }
      return
    }
    setSelected(item)
  }

  const liveAsItems: MediaItemDTO[] = liveItems.map((event) => ({
    id: event.id,
    sourceId: null,
    sourceName: event.sourceName,
    sourceDomain: event.sourceDomain,
    platform: event.platform,
    externalId: event.id,
    url: event.url,
    author: null,
    title: event.title,
    rawContent: '',
    cleanContent: '',
    sentiment: event.sentiment,
    sentimentScore: event.sentimentScore,
    entities: { persons: [], organizations: [], locations: [] },
    publishedAt: event.publishedAt,
    processedAt: event.publishedAt,
  }))

  const feedItems = [...liveAsItems, ...(feeds.data?.data ?? [])]
    .filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 6)

  const stats = analytics.data?.stats

  return (
    <div>
      <PageHeader
        eyebrow="Ringkasan eksekutif"
        title="Overview Intelijen"
        description="Pantau denyut pemberitaan nasional: volume, sentimen, entitas, klaster isu, dan sinyal krisis dalam satu layar."
        actions={
          <>
            <RangeTabs value={preset} onChange={setPreset} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => analytics.refetch()}
              disabled={analytics.isFetching}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', analytics.isFetching && 'animate-spin')} />
              Segarkan
            </Button>
          </>
        }
      />

      {incomingAlert ? (
        <AlertBanner alert={incomingAlert} onDismiss={() => setIncomingAlert(null)} />
      ) : null}

      {analytics.isError ? (
        <ErrorState
          message={(analytics.error as Error)?.message}
          onRetry={() => analytics.refetch()}
          className="mb-4"
        />
      ) : null}

      {analytics.data && stats && stats.totalItems === 0 ? (
        <EmptyState
          className="mb-4"
          icon={Database}
          title="Belum ada data pada rentang ini"
          description="Jalankan RSS poller + worker AI, atau muat dataset demo untuk melihat seluruh visualisasi bekerja."
          action={
            <Button size="sm" onClick={() => seed.mutate()} disabled={seed.isPending}>
              <Sparkles className="h-3.5 w-3.5" />
              {seed.isPending ? 'Menyiapkan…' : 'Muat data demo'}
            </Button>
          }
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {analytics.isLoading || !stats ? (
          Array.from({ length: 5 }).map((_, index) => (
            <Card key={index}>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-2 w-24" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <KpiCard
              label="Total artikel"
              value={formatNumber(stats.totalItems)}
              icon={Newspaper}
              trend={{ value: stats.volumeChangePct, label: 'vs periode lalu' }}
              hint={<span>vs periode sebelumnya ({formatNumber(stats.baselineVolume)})</span>}
            />
            <KpiCard
              label="Sentimen negatif"
              value={`${stats.negativeRatio.toFixed(0)}%`}
              icon={Activity}
              accent="negative"
              hint={<span>{formatNumber(stats.negativeItems)} artikel negatif</span>}
            />
            <KpiCard
              label="Sumber aktif"
              value={String(stats.activeSources)}
              suffix="/ 10"
              icon={Radar}
              accent="accent"
              hint={<span>portal terpantau pada rentang ini</span>}
            />
            <KpiCard
              label="Klaster isu"
              value={formatNumber(stats.activeClusters)}
              icon={Boxes}
              hint={<span>≥ 5 artikel per klaster</span>}
            />
            <KpiCard
              label="Peringatan aktif"
              value={formatNumber(stats.activeAlerts)}
              icon={ShieldAlert}
              accent="warning"
              hint={
                <span>
                  {stats.criticalAlerts > 0 ? (
                    <span className="text-critical">{stats.criticalAlerts} kritis</span>
                  ) : (
                    'tidak ada level kritis'
                  )}
                </span>
              }
            />
          </>
        )}
      </div>

      <div className="mt-4">
        <Suspense fallback={<LocationInsightsSkeleton />}>
          <LocationInsights data={locations.data} isLoading={locations.isLoading} />
        </Suspense>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Tren sentimen</CardTitle>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Distribusi positif / netral / negatif per {analytics.data?.range.bucket === 'hour' ? 'jam' : 'hari'}
              </p>
            </div>
            <Badge variant="outline" className="font-mono">
              {analytics.data?.range.bucket === 'hour' ? 'per jam' : 'per hari'}
            </Badge>
          </CardHeader>
          <CardContent>
            {analytics.data ? (
              <SentimentTrendChart
                data={analytics.data.sentimentTrend}
                bucket={analytics.data.range.bucket}
              />
            ) : (
              <Skeleton className="h-[260px] w-full" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Live stream</CardTitle>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Artikel terbaru lintas portal</p>
            </div>
            <LiveIndicator state={sseStatus} />
          </CardHeader>
          <CardContent className="px-4">
            {feeds.isLoading && !feeds.data ? (
              <div className="space-y-3 py-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="space-y-1.5">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-2 w-24" />
                  </div>
                ))}
              </div>
            ) : feedItems.length > 0 ? (
              <div className="divide-y divide-border/40">
                {feedItems.map((item) => (
                  <ArticleCard
                    key={item.id}
                    item={item}
                    onOpen={openItem}
                    isNew={liveItems.some((live) => live.id === item.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">
                Belum ada artikel masuk.
              </p>
            )}
            <div className="border-t border-border/50 py-2">
              <Link
                to="/media"
                className="text-[11px] text-primary transition-colors hover:text-primary/80"
              >
                Buka media monitoring →
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Share of voice</CardTitle>
            <p className="-mt-1 text-[11px] text-muted-foreground">Dominasi pemberitaan per portal</p>
          </CardHeader>
          <CardContent>
            {analytics.data ? (
              <ShareOfVoiceChart
                data={analytics.data.shareOfVoice}
                total={analytics.data.stats.totalItems}
              />
            ) : (
              <Skeleton className="h-[200px] w-full" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Entitas teratas</CardTitle>
            <p className="-mt-1 text-[11px] text-muted-foreground">Tokoh, organisasi, dan lokasi paling disebut</p>
          </CardHeader>
          <CardContent>
            {analytics.data ? (
              <EntityList entities={analytics.data.topEntities} />
            ) : (
              <Skeleton className="h-[200px] w-full" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Radar krisis</CardTitle>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Peringatan belum terselesaikan</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/alerts">Semua</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : alerts.data && alerts.data.data.length > 0 ? (
              alerts.data.data.map((alert) => (
                <Link
                  key={alert.id}
                  to="/alerts"
                  className="block rounded-md border border-border/60 bg-background/40 px-2.5 py-2 transition-colors hover:border-border hover:bg-secondary/30"
                >
                  <div className="flex items-center gap-1.5">
                    <SeverityBadge value={alert.severity} />
                    <span className="ml-auto font-mono text-[9px] text-muted-foreground">
                      {formatRelative(alert.triggeredAt)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-foreground/90">
                    {alert.title}
                  </p>
                </Link>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center">
                <ShieldAlert className="mx-auto h-4 w-4 text-muted-foreground/60" />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Tidak ada lonjakan terdeteksi. Detektor berjalan otomatis setiap 5 menit.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>Aktivitas pemberitaan</CardTitle>
            <p className="-mt-1 text-[11px] text-muted-foreground">
              Distribusi artikel per hari dan jam (WIB)
            </p>
          </CardHeader>
          <CardContent>
            {analytics.data ? (
              <ActivityHeatmap cells={analytics.data.activityHeatmap} />
            ) : (
              <Skeleton className="h-[150px] w-full" />
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Volume per platform</CardTitle>
            <p className="-mt-1 text-[11px] text-muted-foreground">
              Total vs artikel bernada negatif
            </p>
          </CardHeader>
          <CardContent>
            {analytics.data ? (
              <PlatformVolumeChart data={analytics.data.platformVolume} />
            ) : (
              <Skeleton className="h-[190px] w-full" />
            )}
            <p className="mt-2 font-mono text-[9px] text-muted-foreground/70">
              Pembaruan terakhir {new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB
            </p>
          </CardContent>
        </Card>
      </div>

      <ArticleDetailDialog
        item={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  )
}
