import { useEffect, useMemo, useState } from 'react'
import {
  Clapperboard,
  Clock,
  Eye,
  Flame,
  Loader2,
  RefreshCw,
  RotateCcw,
  Scissors,
  Share2,
  Sparkles,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import type {
  ClipSourceDTO,
  ClipSourceStatus,
  GeneratedClipDTO,
} from '@media-intel/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { SegmentedTabs } from '@/components/shared/SegmentedTabs'
import { LiveIndicator } from '@/components/shared/LiveIndicator'
import { UrlIngestForm } from '@/features/clipping/components/UrlIngestForm'
import { SourceQueueTable, QueueSummary } from '@/features/clipping/components/SourceQueueTable'
import {
  ProgressSteps,
  ProgressSummary,
  WorkerHealthBanner,
  isStalled,
  type ClippingHealth,
} from '@/features/clipping/components/ProgressStatus'
import { ClipPreviewCard } from '@/features/clipping/components/ClipPreviewCard'
import {
  DistributionDialog,
  DistributionMatrix,
} from '@/features/clipping/components/DistributionMatrix'
import { ViralTriggerPanel } from '@/features/clipping/components/ViralTriggerPanel'
import {
  useClipSource,
  useClipSources,
  useClippingAnalytics,
  useClippingSSE,
  useDeleteSource,
  useRetrySource,
  useTrackMetrics,
} from '@/hooks/useClipping'
import {
  CLIP_SOURCE_STATUS_LABEL,
  formatDuration,
  formatIdr,
  formatNumber,
  formatRelative,
} from '@/lib/format'
import { useSystemStatus } from '@/hooks/useAnalytics'
import { cn } from '@/lib/utils'

type ViewTab = 'studio' | 'payout'

const STATUS_TONE: Record<ClipSourceStatus, string> = {
  pending: 'text-muted-foreground',
  downloading: 'text-warning',
  transcribing: 'text-warning',
  analyzing: 'text-accent',
  rendering: 'text-accent',
  completed: 'text-positive',
  failed: 'text-negative',
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'primary',
}: {
  label: string
  value: string
  hint?: string
  icon: React.ComponentType<{ className?: string }>
  accent?: 'primary' | 'accent' | 'positive' | 'warning'
}) {
  return (
    <Card className="relative overflow-hidden">
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-px',
          accent === 'primary' && 'bg-gradient-to-r from-transparent via-primary/60 to-transparent',
          accent === 'accent' && 'bg-gradient-to-r from-transparent via-accent/60 to-transparent',
          accent === 'positive' && 'bg-gradient-to-r from-transparent via-positive/60 to-transparent',
          accent === 'warning' && 'bg-gradient-to-r from-transparent via-warning/60 to-transparent',
        )}
      />
      <CardContent className="space-y-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="label-caps">{label}</span>
          <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
        </div>
        <p className="kpi-value text-[26px]">{value}</p>
        {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

function ClippingStudio() {
  const summary = useClippingAnalytics()
  // Kesehatan pipeline: apakah worker hidup, berapa job menunggu, dependensi apa
  // yang hilang. Tanpa ini status "Antre" tidak bisa dibedakan dari "macet".
  const system = useSystemStatus()
  const health = system.data?.clipping ?? null
  const track = useTrackMetrics()

  const sseStatus = useClippingSSE()

  const totals = summary.data?.totals

  return (
    <div>
      <PageHeader
        eyebrow="AI Content Clipping"
        title="Clipping Studio"
        description="Tempel tautan video, pantau tahapannya di antrean, lalu buka detail untuk melihat dan mengunduh seluruh klip hasil generate."
        actions={
          <>
            <LiveIndicator state={sseStatus} label="Clipping live" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => track.mutate(undefined)}
              disabled={track.isPending}
            >
              {track.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Scrape metrik
            </Button>
          </>
        }
      />

      <WorkerHealthBanner health={health} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label="Sumber diproses"
          value={formatNumber(totals?.sources ?? 0)}
          hint="30 hari terakhir"
          icon={Clapperboard}
        />
        <KpiCard
          label="Klip dihasilkan"
          value={formatNumber(totals?.clips ?? 0)}
          hint={`${formatNumber(totals?.approvedClips ?? 0)} disetujui`}
          icon={Scissors}
          accent="accent"
        />
        <KpiCard
          label="Total views"
          value={formatNumber(totals?.views ?? 0)}
          hint={`${formatNumber(totals?.saves ?? 0)} simpan`}
          icon={Eye}
          accent="positive"
        />
        <KpiCard
          label="Trigger diterapkan"
          value={formatNumber(totals?.triggers ?? 0)}
          hint="Sesi human-like"
          icon={Flame}
          accent="warning"
        />
        <KpiCard
          label="Estimasi payout"
          value={formatIdr(totals?.estimatedRevenueIdr ?? 0)}
          hint="CPM ledger"
          icon={Wallet}
          accent="positive"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <div className="space-y-3">
          <UrlIngestForm />
          <QueueSummary health={health} />
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
                Aturan viral trigger
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ViralTriggerPanel summary={summary.data} />
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-3">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2 py-3">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
                Antrean pemrosesan
              </CardTitle>
              <span className="font-mono text-[10px] text-muted-foreground/70">
                klik baris untuk detail
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <SourceQueueTable health={health} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
                Distribusi terakhir
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <DistributionMatrix />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function PayoutDashboard() {
  const summary = useClippingAnalytics()

  if (summary.isError) {
    return (
      <ErrorState
        message={(summary.error as Error)?.message}
        onRetry={() => summary.refetch()}
      />
    )
  }

  const platformRows = summary.data?.byPlatform ?? []
  const maxViews = Math.max(1, ...platformRows.map((row) => row.views))

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-3.5 w-3.5 text-positive" />
            Monetization ledger per platform
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Estimasi revenue = ⌊views / 1000⌋ × CPM rate per distribusi.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {platformRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">Belum ada data distribusi.</p>
          ) : (
            platformRows.map((row) => (
              <div key={row.platform} className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium uppercase tracking-wider text-foreground/90">
                    {row.platform}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {formatNumber(row.total)} post · {formatNumber(row.views)} views
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary/70 to-accent"
                    style={{ width: `${Math.max(2, (row.views / maxViews) * 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Rata-rata {formatNumber(row.averageViews)} views/post</span>
                  <span className="font-mono text-positive">{formatIdr(row.revenueIdr)}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-3.5 w-3.5 text-accent" />
            Status distribusi
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(summary.data?.byStatus ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">Belum ada distribusi.</p>
          ) : (
            summary.data?.byStatus.map((row) => (
              <div
                key={row.status}
                className="flex items-center justify-between rounded border border-border/60 px-2.5 py-1.5"
              >
                <span className="text-[11px] text-foreground/90">
                  {row.status}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {formatNumber(row.total)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function ClippingStudioPage() {
  const [tab, setTab] = useState<ViewTab>('studio')
  const summary = useClippingAnalytics()

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <SegmentedTabs
          label="Tampilan clipping"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'studio', label: 'Studio' },
            { value: 'payout', label: 'Analytics & Payout' },
          ]}
        />
        <span className="hidden items-center gap-1 font-mono text-[10px] text-muted-foreground/70 sm:inline-flex">
          <Clock className="h-2.5 w-2.5" />
          tracker cron 3 jam
        </span>
      </div>
      {tab === 'studio' ? (
        <ClippingStudio />
      ) : (
        <>
          <PageHeader
            eyebrow="Analytics & Monetization"
            title="Clipping Payout Ledger"
            description="Agregasi performa klip lintas akun, retensi, dan estimasi pendapatan CPM."
          />
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label="Views"
              value={formatNumber(summary.data?.totals.views ?? 0)}
              icon={Eye}
              accent="positive"
            />
            <KpiCard
              label="Likes"
              value={formatNumber(summary.data?.totals.likes ?? 0)}
              icon={Flame}
            />
            <KpiCard
              label="Save"
              value={formatNumber(summary.data?.totals.saves ?? 0)}
              icon={Share2}
              accent="accent"
            />
            <KpiCard
              label="Payout"
              value={formatIdr(summary.data?.totals.estimatedRevenueIdr ?? 0)}
              icon={Wallet}
              accent="positive"
            />
          </div>
          <PayoutDashboard />
        </>
      )}
    </div>
  )
}
