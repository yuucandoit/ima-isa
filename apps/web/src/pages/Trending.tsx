import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownRight,
  ArrowUpRight,
  Flame,
  Globe,
  Hash,
  Music2,
  RefreshCw,
  Search,
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
import type { FigurePeriod, SocialTrendItem, TrendSort, TrendingWindow } from '@media-intel/types'
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

type TrendTab = 'all' | 'TWITTER_X' | 'TIKTOK' | 'GOOGLE_TRENDS'

const TREND_TABS: Array<{ value: TrendTab; label: string; icon: typeof Flame }> = [
  { value: 'all', label: 'Semua', icon: TrendingUp },
  { value: 'TWITTER_X', label: 'X', icon: Flame },
  { value: 'TIKTOK', label: 'TikTok', icon: Music2 },
  { value: 'GOOGLE_TRENDS', label: 'Google', icon: Globe },
]

const TREND_TYPE_META: Record<
  SocialTrendItem['type'],
  { label: string; icon: typeof Flame; badge: 'warning' | 'secondary' | 'outline' }
> = {
  x_trend: { label: 'X Trend', icon: Flame, badge: 'warning' },
  google_search: { label: 'Google', icon: Search, badge: 'outline' },
  hashtag: { label: 'Hashtag', icon: Hash, badge: 'secondary' },
  tiktok_sound: { label: 'Sound', icon: Music2, badge: 'secondary' },
}

type GoogleWindow = '4' | '24' | '168'

const GOOGLE_HOURS: Array<{ value: GoogleWindow; label: string }> = [
  { value: '4', label: '4 jam' },
  { value: '24', label: '24 jam' },
  { value: '168', label: '7 hari' },
]

const SORT_OPTIONS: Array<{ value: TrendSort; label: string }> = [
  { value: 'volume', label: 'Volume' },
  { value: 'rank', label: 'Peringkat feed' },
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

/** Tab jendela hanya muncul untuk jendela yang datanya ada di server. */
function GoogleWindowTabs({
  value,
  onChange,
}: {
  value: GoogleWindow
  onChange: (value: GoogleWindow) => void
}) {
  const query = useSocialTrending('24h', 'GOOGLE_TRENDS', 'volume', 24)
  const available = new Set((query.data?.windows ?? []).map((item) => item.hours))
  const options = GOOGLE_HOURS.filter(
    (option) => available.size === 0 || available.has(Number(option.value)),
  )
  if (options.length < 2) return null
  return (
    <SegmentedTabs label="Jendela waktu" value={value} onChange={onChange} options={options} />
  )
}

function snapshotAgeSeconds(isoDate: string | null): number | null {
  if (!isoDate) return null
  return (Date.now() - Date.parse(isoDate)) / 1000
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

function SourcePills({
  breakdown,
}: {
  breakdown: NonNullable<ReturnType<typeof useSocialTrending>['data']>['breakdown']
}) {
  if (!breakdown?.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {breakdown.map((item) => (
        <Badge key={item.platform} variant="outline" className="gap-1 font-normal">
          {item.platform === 'GOOGLE_TRENDS' ? (
            <Globe className="h-3 w-3" />
          ) : item.platform === 'TIKTOK' ? (
            <Music2 className="h-3 w-3" />
          ) : (
            <Flame className="h-3 w-3" />
          )}
          {item.label}
          {item.region ? (
            <span className="text-muted-foreground/60">{item.region}</span>
          ) : null}
          <span className="font-mono tabular-nums text-muted-foreground">{item.total}</span>
          {item.capturedAt ? (
            <span className="text-muted-foreground/70">· {formatRelative(item.capturedAt)}</span>
          ) : null}
        </Badge>
      ))}
    </div>
  )
}

function SocialContent({
  window,
  tab,
  sort,
  hours,
}: {
  window: TrendingWindow
  tab: TrendTab
  sort: TrendSort
  hours: number
}) {
  const platform = tab === 'all' ? undefined : (tab as 'TWITTER_X' | 'TIKTOK' | 'GOOGLE_TRENDS')
  const query = useSocialTrending(window, platform, sort, hours)
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
    const hints: Record<string, string> = {
      TWITTER_X:
        'X trends diambil dari API resmi (X_BEARER_TOKEN) atau cookie login (X_AUTH_TOKEN + X_CT0). Jalankan `bun run worker:trends -- --once --platform x`.',
      TIKTOK:
        'TikTok trends diambil dari Creative Center (butuh TIKTOK_SESSION_COOKIE) atau Discover feed publik. Jalankan `bun run worker:trends -- --once --platform tiktok`.',
      GOOGLE_TRENDS:
        'Google Trends memakai RSS publik — tidak perlu kredensial. Jalankan `bun run worker:trends -- --once --platform google`.',
    }
    return (
      <EmptyState
        icon={Flame}
        title="Belum ada data trending"
        description={
          hints[tab] ??
          'Snapshot tren diambil oleh worker (X, TikTok, Google Trends) dan hashtag dari post sosial yang sudah di-ingest. Jalankan `bun run worker:trends -- --once`.'
        }
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
        <div className="min-w-0">
          <CardTitle>Trending</CardTitle>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            X {formatNumber(query.data.sources.xTrends)} · Google{' '}
            {formatNumber(query.data.sources.googleTrends)} · TikTok{' '}
            {formatNumber(query.data.sources.tiktokTrends)} · hashtag{' '}
            {formatNumber(query.data.sources.hashtags)}
            {query.data.capturedAt
              ? ` · diperbarui ${formatRelative(query.data.capturedAt)}`
              : ''}
          </p>
          <div className="mt-2">
            <SourcePills breakdown={query.data.breakdown} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-mono">
            {window === '24h' ? '24 jam' : '7 hari'}
          </Badge>
          {(() => {
            const age = snapshotAgeSeconds(query.data.capturedAt)
            if (age === null) return null
            // Feed Google berganti tiap ±1 menit; di atas 5 menit data sudah
            // tidak mewakili daftar yang tampil di trends.google.com.
            const stale = age > (tab === 'GOOGLE_TRENDS' || tab === 'all' ? 900 : 300)
            return (
              <Badge
                variant={stale ? 'warning' : 'secondary'}
                className="font-normal"
                title={
                  stale
                    ? 'Snapshot lebih tua dari 15 menit — worker tren mungkin belum jalan.'
                    : 'Umur snapshot terbaru dari worker tren'
                }
              >
                snapshot {formatRelative(query.data.capturedAt ?? '')}
              </Badge>
            )
          })()}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.data.items.map((item, index) => {
          const meta = TREND_TYPE_META[item.type] ?? TREND_TYPE_META.hashtag
          const Icon = meta.icon
          return (
            <a
              key={`${item.platform}-${item.type}-${item.name}`}
              href={item.url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="group block rounded-md border border-border/50 bg-background/30 px-3 py-2.5 transition-colors hover:border-border hover:bg-secondary/30"
            >
              <div className="flex items-center gap-2">
                <span className="w-6 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90 group-hover:text-foreground">
                  <Icon className="mr-0.5 inline h-3 w-3 text-accent" />
                  {item.name}
                </span>
                <Badge variant={meta.badge}>{meta.label}</Badge>
                <DeltaBadge value={item.deltaPct} />
              </div>
              <div className="mt-1.5 flex items-center gap-3 pl-8">
                <ShareBar
                  value={item.volume}
                  max={maxVolume}
                  color={
                    item.platform === 'GOOGLE_TRENDS'
                      ? 'hsl(var(--primary))'
                      : item.platform === 'TIKTOK'
                        ? 'hsl(var(--accent))'
                        : 'hsl(var(--warning))'
                  }
                />
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {item.volumeLabel ?? (item.volume > 0 ? `${formatNumber(item.volume)} sebutan` : '—')}
                </span>
                {item.negativeRatio > 0 ? (
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-negative">
                    {formatPercent(item.negativeRatio)} negatif
                  </span>
                ) : null}
                <span className="hidden shrink-0 text-[9px] text-muted-foreground/60 sm:inline">
                  {PLATFORM_LABEL[item.platform] ?? item.platform}
                  {item.windowHours ? ` ${item.windowHours}j` : ''}
                  {item.dataSource === 'rss' ? ' · RSS' : ''}
                  {item.newsCount ? ` · ${formatNumber(item.newsCount)} berita` : ''}
                  {item.publishedAt ? ` · ${formatRelative(item.publishedAt)}` : ''}
                </span>
              </div>
              {item.relatedQueries.length > 1 ? (
                <p className="mt-1 truncate pl-8 text-[9px] text-muted-foreground/70">
                  terkait: {item.relatedQueries.slice(1, 5).join(' · ')}
                </p>
              ) : null}
            </a>
          )
        })}
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
  const [trendTab, setTrendTab] = useState<TrendTab>('all')
  const [trendSort, setTrendSort] = useState<TrendSort>('volume')
  const [googleHours, setGoogleHours] = useState<GoogleWindow>('24')
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
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SegmentedTabs
              label="Platform trending"
              value={trendTab}
              onChange={setTrendTab}
              options={TREND_TABS.map(({ value, label }) => ({ value, label }))}
            />
            <SegmentedTabs
              label="Urutkan"
              value={trendSort}
              onChange={setTrendSort}
              options={SORT_OPTIONS}
            />
            {trendTab === 'GOOGLE_TRENDS' ? (
              <GoogleWindowTabs value={googleHours} onChange={setGoogleHours} />
            ) : null}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <Badge variant="outline" className="font-mono">
              <Flame className="h-3 w-3 text-warning" />
              X · TikTok · Google Trends
            </Badge>
            <span>
              Urut <strong className="text-foreground/80">volume</strong>:{' '}
              <em>approx_traffic</em> Google, tayangan TikTok, jumlah sebutan hashtag.
              Google diambil dari halaman <code>/trending</code> (140 tren/24 jam) — bukan
              lagi RSS 10 item; fallback ke RSS otomatis bila struktur halaman berubah.
            </span>
          </div>
          <SocialContent
            window={window}
            tab={trendTab}
            sort={trendSort}
            hours={Number(googleHours)}
          />
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
