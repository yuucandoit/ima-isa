import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRight,
  Boxes,
  CalendarClock,
  Layers,
  Newspaper,
  RefreshCw,
  Sparkles,
  Wand2,
} from 'lucide-react'
import type { ClusterDTO } from '@media-intel/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { SentimentBadge } from '@/components/shared/Badges'
import { LiveIndicator } from '@/components/shared/LiveIndicator'
import { useCluster, useClusters } from '@/hooks/useAnalytics'
import { useSSE } from '@/hooks/useSSE'
import { rebuildClusters, requestClusterSummary, seedDemoData } from '@/lib/api'
import { formatDateTime, formatNumber, formatRelative, truncate } from '@/lib/format'
import { cn } from '@/lib/utils'

function MarkdownLite({ text }: { text: string }) {
  const renderInline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={index} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <span key={index}>{part}</span>
      ),
    )

  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-foreground/85">
      {text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
          if (/^\*\*[^*]+\*\*$/.test(line)) {
            return (
              <p key={index} className="label-caps pt-2 first:pt-0">
                {line.replace(/\*\*/g, '')}
              </p>
            )
          }
          if (line.startsWith('- ') || /^\d+\.\s/.test(line)) {
            return (
              <div key={index} className="flex gap-2 pl-1">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                <p>{renderInline(line.replace(/^(- |\d+\.\s)/, ''))}</p>
              </div>
            )
          }
          return <p key={index}>{renderInline(line)}</p>
        })}
    </div>
  )
}

function ClusterCard({
  cluster,
  index,
  onOpen,
}: {
  cluster: ClusterDTO
  index: number
  onOpen: () => void
}) {
  return (
    <Card
      className="group cursor-pointer transition-colors hover:border-primary/35 hover:bg-card/90"
      onClick={onOpen}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
            Cluster {String(index + 1).padStart(2, '0')}
          </span>
          {cluster.dominantSentiment ? (
            <SentimentBadge value={cluster.dominantSentiment} />
          ) : (
            <Badge variant="outline">Tanpa sentimen</Badge>
          )}
        </div>

        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
          {cluster.title}
        </h3>

        <div className="grid grid-cols-3 gap-2 border-y border-border/50 py-2">
          <div>
            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {formatNumber(cluster.totalArticles)}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">artikel</p>
          </div>
          <div>
            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {formatNumber(cluster.sourceCount)}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">portal</p>
          </div>
          <div>
            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {formatRelative(cluster.lastUpdated).replace('yang lalu', '').trim()}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">update</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {cluster.sources.slice(0, 4).map((source) => (
            <span
              key={source}
              className="rounded border border-border/70 bg-secondary/40 px-1.5 py-0.5 text-[9px] text-muted-foreground"
            >
              {source}
            </span>
          ))}
          {cluster.sources.length > 4 ? (
            <span className="px-1 py-0.5 text-[9px] text-muted-foreground">
              +{cluster.sources.length - 4}
            </span>
          ) : null}
        </div>

        {cluster.sampleHeadlines[0] ? (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
            {cluster.sampleHeadlines[0]}
          </p>
        ) : null}

        <div className="flex items-center justify-between pt-0.5">
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            {cluster.summary ? (
              <>
                <Sparkles className="h-3 w-3 text-primary" />
                Briefing tersedia
              </>
            ) : (
              <>
                <Wand2 className="h-3 w-3" />
                Buat briefing AI
              </>
            )}
          </span>
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/50 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
      </CardContent>
    </Card>
  )
}

export default function TopicClustersPage() {
  const [openId, setOpenId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const clusters = useClusters(24)
  const detail = useCluster(openId)

  const sseStatus = useSSE(
    'clusters',
    {
      cluster: () => {
        void queryClient.invalidateQueries({ queryKey: ['clusters'] })
        if (openId) void queryClient.invalidateQueries({ queryKey: ['cluster', openId] })
      },
    },
    true,
  )

  const summarize = useMutation({
    mutationFn: ({ id, refresh }: { id: string; refresh: boolean }) =>
      requestClusterSummary(id, refresh),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['cluster', variables.id] })
      await queryClient.invalidateQueries({ queryKey: ['clusters'] })
    },
  })

  const rebuild = useMutation({
    mutationFn: () => rebuildClusters({ windowHours: 24, minItems: 5 }),
    onSuccess: async (result) => {
      setNotice(
        `Klasterisasi selesai (cosine < ${result.distanceThreshold ?? '—'}): ${result.clustersCreated} klaster baru, ${result.clustersUpdated} diperbarui, ${result.assignedToExisting} artikel ditempatkan.`,
      )
      await queryClient.invalidateQueries({ queryKey: ['clusters'] })
      setTimeout(() => setNotice(null), 8_000)
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
        eyebrow="Semantic clustering"
        title="Topic Clusters"
        description="Klaster isu terbentuk otomatis dari kemiripan embedding artikel (cosine distance < 0.25 untuk IndoBERT, < 0.62 untuk mode leksikal) dan span maksimal 4 jam. Setiap klaster bisa diringkas menjadi executive briefing."
        actions={
          <>
            <span className="hidden sm:block">
              <LiveIndicator state={sseStatus} />
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => rebuild.mutate()}
              disabled={rebuild.isPending}
            >
              <Layers className={cn('h-3.5 w-3.5', rebuild.isPending && 'animate-pulse')} />
              {rebuild.isPending ? 'Mengklaster…' : 'Klaster ulang'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => clusters.refetch()}
              disabled={clusters.isFetching}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', clusters.isFetching && 'animate-spin')} />
            </Button>
          </>
        }
      />

      {notice ? (
        <div className="mb-4 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
          {notice}
        </div>
      ) : null}

      {rebuild.isError ? (
        <ErrorState
          className="mb-4"
          title="Klasterisasi gagal"
          message={(rebuild.error as Error)?.message}
        />
      ) : null}

      {clusters.isError ? (
        <ErrorState
          message={(clusters.error as Error)?.message}
          onRetry={() => clusters.refetch()}
        />
      ) : clusters.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index}>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-2.5 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : clusters.data && clusters.data.length > 0 ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <Badge variant="outline" className="font-mono">
              {clusters.data.length} klaster aktif
            </Badge>
            <span>Ambang minimum 5 artikel dari ≥ 2 portal</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {clusters.data.map((cluster, index) => (
              <ClusterCard
                key={cluster.id}
                cluster={cluster}
                index={index}
                onOpen={() => setOpenId(cluster.id)}
              />
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          icon={Boxes}
          title="Belum ada klaster isu"
          description="Klaster akan terbentuk saat minimal 5 artikel dari portal berbeda membahas topik serupa dalam rentang 4 jam."
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => rebuild.mutate()}>
                <Layers className="h-3.5 w-3.5" />
                Jalankan klasterisasi
              </Button>
              <Button size="sm" onClick={() => seed.mutate()} disabled={seed.isPending}>
                <Sparkles className="h-3.5 w-3.5" />
                Muat data demo
              </Button>
            </div>
          }
        />
      )}

      <Dialog open={Boolean(openId)} onOpenChange={(open) => !open && setOpenId(null)}>
        <DialogContent className="max-w-3xl">
          {detail.isLoading || !detail.data ? (
            <div className="space-y-4 p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  {detail.data.cluster.dominantSentiment ? (
                    <SentimentBadge value={detail.data.cluster.dominantSentiment} />
                  ) : null}
                  <Badge variant="outline" className="font-mono">
                    {formatNumber(detail.data.cluster.totalArticles)} artikel
                  </Badge>
                  <Badge variant="outline" className="font-mono">
                    {formatNumber(detail.data.cluster.sourceCount)} portal
                  </Badge>
                </div>
                <DialogTitle className="pr-6 text-lg leading-snug">
                  {detail.data.cluster.title}
                </DialogTitle>
                <DialogDescription>
                  Pertama terdeteksi {formatDateTime(detail.data.cluster.firstSeenAt)} · update{' '}
                  {formatRelative(detail.data.cluster.lastUpdated)}
                </DialogDescription>
              </DialogHeader>

              <div className="max-h-[60vh] overflow-y-auto">
                <div className="space-y-3 border-b border-border/60 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="label-caps">Executive briefing</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Ringkasan terstruktur via LLM gateway (OpenAI-compatible / Ollama)
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={detail.data.cluster.summary ? 'outline' : 'default'}
                      onClick={() =>
                        summarize.mutate({
                          id: detail.data!.cluster.id,
                          refresh: Boolean(detail.data!.cluster.summary),
                        })
                      }
                      disabled={summarize.isPending}
                    >
                      {summarize.isPending ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Wand2 className="h-3.5 w-3.5" />
                      )}
                      {summarize.isPending
                        ? 'Menyusun…'
                        : detail.data.cluster.summary
                          ? 'Perbarui ringkasan'
                          : 'Generate summary'}
                    </Button>
                  </div>

                  {summarize.isError ? (
                    <p className="rounded border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative">
                      {(summarize.error as Error)?.message}
                    </p>
                  ) : null}

                  {summarize.isPending ? (
                    <div className="space-y-2 rounded-md border border-border/50 bg-background/40 p-4">
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-11/12" />
                      <Skeleton className="h-3 w-4/5" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  ) : detail.data.cluster.summary ? (
                    <div className="rounded-md border border-border/60 bg-background/40 p-4">
                      <MarkdownLite text={detail.data.cluster.summary} />
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
                      Belum ada briefing. Tekan tombol generate untuk menyusun ringkasan dari{' '}
                      {detail.data.articles.length} artikel terbaru.
                    </p>
                  )}
                </div>

                <div className="p-5">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="label-caps">Artikel anggota</p>
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      <CalendarClock className="h-3 w-3" />
                      {formatDateTime(detail.data.cluster.firstSeenAt)} —{' '}
                      {formatDateTime(detail.data.cluster.lastUpdated)}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {detail.data.articles.map((article) => (
                      <li key={article.id}>
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noreferrer"
                          className="group flex items-start gap-2 rounded-md border border-border/50 bg-background/30 px-3 py-2 transition-colors hover:border-border hover:bg-secondary/30"
                        >
                          <Newspaper className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60" />
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-[11px] leading-relaxed text-foreground/90">
                              {truncate(article.title, 160)}
                            </p>
                            <p className="mt-0.5 text-[9px] text-muted-foreground">
                              {article.sourceName ?? article.sourceDomain} ·{' '}
                              {formatRelative(article.publishedAt)}
                            </p>
                          </div>
                          <SentimentBadge value={article.sentiment} />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
