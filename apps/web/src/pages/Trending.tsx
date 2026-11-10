import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownRight,
  ArrowUpRight,
  Flame,
  Hash,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { FigurePeriod, TrendingWindow } from '@media-intel/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { SegmentedTabs } from '@/components/shared/SegmentedTabs'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { useFigureTrending, useSocialTrending } from '@/hooks/useTrending'
import { useSSE } from '@/hooks/useSSE'
import {
  PLATFORM_LABEL,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
} from '@/lib/format'
import { cn } from '@/lib/utils'

const SOCIAL_WINDOWS: Array<{ value: TrendingWindow; label: string }> = [
  { value: '24h', label: '24 jam' },
  { value: '7d', label: '7 hari' },
]

const FIGURE_PERIODS: Array<{ value: FigurePeriod; label: string }> = [
  { value: 'daily', label: 'Harian' },
  { value: 'weekly', label: 'Mingguan' },
  { value: 'monthly', label: 'Bulanan' },
  { value: 'yearly', label: 'Tahunan' },
]

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <Badge variant="outline" className="font-mono text-[9px]">
        baru
      </Badge>
    )
  }
  const positive = value >= 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 font-mono text-[10px] tabular-nums',
        positive ? 'text-positive' : 'text-negative',
      )}
    >
      {positive ? (
        <ArrowUpRight className="h-3 w-3" />
      ) : (
        <ArrowDownRight className="h-3 w-3" />
      )}
      {Math.abs(value).toFixed(0)}%
    </span>
  )
}

function ShareBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(2, (value / Math.max(1, max)) * 100)}%`, background: color }}
      />
    </div>
  )
}

function SocialContent({ window }: { window: TrendingWindow }) {
  const query = useSocialTrending(window)
  const maxVolume = Math.max(1, ...(query.data?.items.map((item) => item.volume) ?? [0]))

  if (query.isError) {
    return <ErrorState message={(query.error as Error)?.message} onRetry={() => query.refetch()} />
  }

  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 p-5">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-1 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  if (!query.data || query.data.items.length === 0) {
    return (
      <EmptyState
        icon={Flame}
        title="Belum ada data trending sosial"
        description="Trending diambil dari X Trends API (butuh X_BEARER_TOKEN) dan hashtag pada post sosial yang sudah di-ingest. Isi kredensial di .env lalu jalankan `bun run worker:social -- --once`."
        action={
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Cek ulang
          </Button>
        }
      />
    )
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>Trending sosial</CardTitle>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            X trends {formatNumber(query.data.sources.xTrends)} · hashtag{' '}
            {formatNumber(query.data.sources.hashtags)}
            {query.data.capturedAt
              ? ` · diperbarui ${formatRelative(query.data.capturedAt)}`
              : ''}
          </p>
        </div>
        <Badge variant="outline" className="font-mono">
          {window === '24h' ? '24 jam' : '7 hari'}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.data.items.map((item, index) => (
          <a
            key={`${item.type}-${item.name}`}
            href={item.url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="group block rounded-md border border-border/50 bg-background/30 px-3 py-2.5 transition-colors hover:border-border hover:bg-secondary/30"
          >
            <div className="flex items-center gap-2">
              <span className="w-6 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {String(item.rank ?? index + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90 group-hover:text-foreground">
                {item.type === 'hashtag' ? (
                  <Hash className="mr-0.5 inline h-3 w-3 text-accent" />
                ) : (
                  <Flame className="mr-0.5 inline h-3 w-3 text-warning" />
                )}
                {item.name}
              </span>
              <Badge variant={item.type === 'x_trend' ? 'warning' : 'secondary'}>
                {item.type === 'x_trend' ? 'X Trend' : 'Hashtag'}
              </Badge>
              <DeltaBadge value={item.deltaPct} />
            </div>
            <div className="mt-1.5 flex items-center gap-3 pl-8">
              <ShareBar
                value={item.volume}
                max={maxVolume}
                color={item.type === 'x_trend' ? 'hsl(var(--warning))' : 'hsl(var(--accent))'}
              />
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                {formatNumber(item.volume)} sebutan
              </span>
              {item.negativeRatio > 0 ? (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-negative">
                  {formatPercent(item.negativeRatio)} negatif
                </span>
              ) : null}
              <span className="hidden shrink-0 text-[9px] text-muted-foreground/60 sm:inline">
                {PLATFORM_LABEL[item.platform] ?? item.platform}
              </span>
            </div>
          </a>
        ))}
      </CardContent>
    </Card>
  )
}

function FigureChart({ items }: { items: Array<{ name: string; mentions: number }> }) {
  const data = items.slice(0, 10).map((item) => ({
    ...item,
    label: item.name.length > 22 ? `${item.name.slice(0, 21)}…` : item.name,
  }))

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border) / 0.5)"
            horizontal={false}
          />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={130}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'hsl(var(--secondary) / 0.35)' }}
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              fontSize: 11,
              color: 'hsl(var(--foreground))',
            }}
            formatter={(value: number) => [formatNumber(value), 'Sebutan']}
          />
          <Bar dataKey="mentions" fill="hsl(var(--primary) / 0.75)" radius={[0, 3, 3, 0]} barSize={12} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function FiguresContent({ period }: { period: FigurePeriod }) {
  const query = useFigureTrending(period)

  if (query.isError) {
    return <ErrorState message={(query.error as Error)?.message} onRetry={() => query.refetch()} />
  }

  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 p-5">
          <Skeleton className="h-[240px] w-full" />
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (!query.data || query.data.items.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Belum ada tokoh pada periode ini"
        description="Nama tokoh diekstrak dari artikel/postingan yang masuk. Jalankan poller + AI worker terlebih dahulu, atau pilih periode yang lebih panjang."
        action={
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Cek ulang
          </Button>
        }
      />
    )
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Peringkat tokoh</CardTitle>
          <p className="-mt-1 text-[11px] text-muted-foreground">
            Jumlah sebutan · periode {formatDateTime(query.data.from)} —{' '}
            {formatDateTime(query.data.to)}
          </p>
        </CardHeader>
        <CardContent>
          <FigureChart items={query.data.items} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Detail sebutan</CardTitle>
          <p className="-mt-1 text-[11px] text-muted-foreground">
            {formatNumber(query.data.items.length)} tokoh teratas
          </p>
        </CardHeader>
        <CardContent className="-mt-1 space-y-2">
          {query.data.items.map((item, index) => (
            <div
              key={item.name}
              className="rounded-md border border-border/50 bg-background/30 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="w-5 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {item.name}
                </span>
                <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                  {formatNumber(item.mentions)}
                </span>
                <DeltaBadge value={item.deltaPct} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 pl-7 text-[10px] text-muted-foreground">
                <span className="text-negative">
                  {formatPercent(item.negativeRatio)} negatif
                </span>
                <span>·</span>
                <span>{formatNumber(item.sourceCount)} sumber</span>
                {item.lastSeenAt ? (
                  <>
                    <span>·</span>
                    <span>terakhir {formatRelative(item.lastSeenAt)}</span>
                  </>
                ) : null}
                {item.sources.slice(0, 2).map((source) => (
                  <span
                    key={source}
                    className="rounded border border-border/60 bg-secondary/40 px-1 py-0.5 text-[9px]"
                  >
                    {source}
                  </span>
                ))}
              </div>
              {item.sampleHeadlines[0] ? (
                <p className="mt-1 line-clamp-1 pl-7 text-[10px] text-muted-foreground/75">
                  {item.sampleHeadlines[0]}
                </p>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

export default function TrendingPage() {
  const [tab, setTab] = useState<'social' | 'figures'>('social')
  const [window, setWindow] = useState<TrendingWindow>('24h')
  const [period, setPeriod] = useState<FigurePeriod>('weekly')
  const queryClient = useQueryClient()

  useSSE(
    'media',
    {
      media: () => {
        void queryClient.invalidateQueries({ queryKey: ['trending-figures'] })
        void queryClient.invalidateQueries({ queryKey: ['trending-social'] })
      },
    },
    true,
  )

  return (
    <div>
      <PageHeader
        eyebrow="Social listening & entity intelligence"
        title="Trending & Tokoh"
        description="Pantau topik yang sedang naik di media sosial dan tokoh yang paling banyak disebut. Filter tokoh harian, mingguan, bulanan, atau tahunan."
        actions={
          <>
            <SegmentedTabs
              label="Jenis data"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'social', label: 'Sosial Media' },
                { value: 'figures', label: 'Tokoh' },
              ]}
            />
            {tab === 'social' ? (
              <SegmentedTabs
                label="Rentang trending"
                value={window}
                onChange={setWindow}
                options={SOCIAL_WINDOWS}
              />
            ) : (
              <SegmentedTabs
                label="Periode tokoh"
                value={period}
                onChange={setPeriod}
                options={FIGURE_PERIODS}
              />
            )}
          </>
        }
      />

      {tab === 'social' ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <Badge variant="outline" className="font-mono">
              <Flame className="h-3 w-3 text-warning" />
              X Trends + hashtag
            </Badge>
            <span>
              Sumber: X Trends API (jika `X_BEARER_TOKEN` diisi) dan hashtag dari post
              sosial yang sudah diproses AI worker.
            </span>
          </div>
          <SocialContent window={window} />
        </>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <Badge variant="outline" className="font-mono">
              <TrendingUp className="h-3 w-3 text-primary" />
              {FIGURE_PERIODS.find((option) => option.value === period)?.label}
            </Badge>
            <span>
              Dihitung dari entitas <code className="text-foreground/80">persons</code> pada
              artikel &amp; post sosial, dibandingkan dengan periode sebelumnya.
            </span>
          </div>
          <FiguresContent period={period} />
        </>
      )}
    </div>
  )
}
