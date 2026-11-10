import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  FilterX,
  Newspaper,
  Radio,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import type { FeedQuery, MediaItemDTO, SentimentLabel, SseMediaEvent } from '@media-intel/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageHeader } from '@/components/shared/PageHeader'
import { RangeTabs } from '@/components/shared/RangeTabs'
import { LiveIndicator } from '@/components/shared/LiveIndicator'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { SentimentBadge } from '@/components/shared/Badges'
import { ArticleDetailDialog } from '@/components/feeds/ArticleDetailDialog'
import { useDebounce } from '@/hooks/useDebounce'
import { useFeeds, useKeywords, useSources } from '@/hooks/useAnalytics'
import { useSSE } from '@/hooks/useSSE'
import { fetchFeed } from '@/lib/api'
import {
  formatInt,
  formatPercent,
  formatRelative,
  formatTime,
  rangeFromPreset,
  truncate,
  type RangePreset,
} from '@/lib/format'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 20

export default function MediaMonitoringPage() {
  const [preset, setPreset] = useState<RangePreset>('7d')
  const [search, setSearch] = useState('')
  const [sentiment, setSentiment] = useState<'' | SentimentLabel>('')
  const [sourceId, setSourceId] = useState('')
  const [keywordId, setKeywordId] = useState('')
  const [page, setPage] = useState(1)
  const [live, setLive] = useState(true)
  const [selected, setSelected] = useState<MediaItemDTO | null>(null)
  const [liveItems, setLiveItems] = useState<MediaItemDTO[]>([])
  const [pending, setPending] = useState<SseMediaEvent[]>([])
  const [newIds, setNewIds] = useState<string[]>([])
  const debouncedSearch = useDebounce(search, 400)
  const range = useMemo(() => rangeFromPreset(preset), [preset])
  const queryClient = useQueryClient()

  const sources = useSources()
  const keywords = useKeywords(false)

  const params: FeedQuery = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      from: range.from,
      to: range.to,
      search: debouncedSearch || undefined,
      sentiment: sentiment || undefined,
      sourceId: sourceId || undefined,
      keywordId: keywordId || undefined,
    }),
    [page, range.from, range.to, debouncedSearch, sentiment, sourceId, keywordId],
  )

  const feeds = useFeeds(params)

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, sentiment, sourceId, keywordId, preset])

  useEffect(() => {
    setLiveItems([])
    setPending([])
  }, [page, debouncedSearch, sentiment, sourceId, keywordId, preset])

  useEffect(() => {
    if (newIds.length === 0) return
    const timer = setTimeout(() => setNewIds([]), 12_000)
    return () => clearTimeout(timer)
  }, [newIds])

  const appendLive = (items: MediaItemDTO[]) => {
    setLiveItems((previous) => {
      const merged = [...items, ...previous]
      const unique = merged.filter(
        (item, index) => merged.findIndex((candidate) => candidate.id === item.id) === index,
      )
      return unique.slice(0, 40)
    })
    setNewIds((previous) => [...items.map((item) => item.id), ...previous].slice(0, 40))
  }

  const sseStatus = useSSE(
    'media',
    {
      media: (payload) => {
        if (!live) return
        const event = payload as SseMediaEvent
        if (page !== 1 || keywordId) {
          setPending((previous) =>
            previous.some((item) => item.id === event.id) ? previous : [event, ...previous].slice(0, 30),
          )
          return
        }
        if (sentiment && event.sentiment !== sentiment) return
        if (debouncedSearch && !`${event.title} ${event.sourceName}`.toLowerCase().includes(debouncedSearch.toLowerCase())) {
          return
        }
        const activeSource = sources.data?.find((source) => source.id === sourceId)
        if (activeSource && event.sourceName !== activeSource.name) return

        const item: MediaItemDTO = {
          id: event.id,
          sourceId: activeSource?.id ?? null,
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
        }

        if (window.scrollY > 180) {
          setPending((previous) =>
            previous.some((entry) => entry.id === event.id) ? previous : [event, ...previous].slice(0, 30),
          )
          return
        }
        appendLive([item])
      },
      alert: () => {
        void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      },
    },
    live,
  )

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

  const loadPending = () => {
    const adapted: MediaItemDTO[] = pending.map((event) => ({
      id: event.id,
      sourceId: sources.data?.find((source) => source.name === event.sourceName)?.id ?? null,
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
    appendLive(adapted.reverse())
    setPending([])
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const items = [...liveItems, ...(feeds.data?.data ?? [])].filter(
    (item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index,
  )

  const hasFilters = Boolean(debouncedSearch || sentiment || sourceId || keywordId)
  const resetFilters = () => {
    setSearch('')
    setSentiment('')
    setSourceId('')
    setKeywordId('')
    setPage(1)
  }

  return (
    <div>
      <PageHeader
        eyebrow="Pemantauan media"
        title="Media Monitoring"
        description="Telusuri seluruh artikel terindeks. Filter dengan Boolean query, pantau aliran live, dan buka detail analisis sentimen serta entitas."
        actions={
          <>
            <RangeTabs value={preset} onChange={setPreset} />
            <Button
              variant={live ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLive((value) => !value)}
            >
              <Radio className="h-3.5 w-3.5" />
              {live ? 'Live aktif' : 'Live nonaktif'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => feeds.refetch()}
              disabled={feeds.isFetching}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', feeds.isFetching && 'animate-spin')} />
            </Button>
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-3">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[1.6fr_1fr_1fr_1fr_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari judul atau isi artikel…"
                className="pl-8"
              />
            </div>
            <Select
              value={sentiment}
              onChange={(event) => setSentiment(event.target.value as '' | SentimentLabel)}
            >
              <option value="">Semua sentimen</option>
              <option value="NEGATIVE">Negatif</option>
              <option value="NEUTRAL">Netral</option>
              <option value="POSITIVE">Positif</option>
            </Select>
            <Select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
              <option value="">Semua sumber</option>
              {sources.data?.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </Select>
            <Select value={keywordId} onChange={(event) => setKeywordId(event.target.value)}>
              <option value="">Semua kata kunci</option>
              {keywords.data?.map((keyword) => (
                <option key={keyword.id} value={keyword.id}>
                  {keyword.label}
                </option>
              ))}
            </Select>
            <Button variant="ghost" size="sm" onClick={resetFilters} disabled={!hasFilters}>
              <FilterX className="h-3.5 w-3.5" />
              Reset
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded border border-border/60 bg-background/40 px-2 py-0.5">
              <SlidersHorizontal className="h-3 w-3" />
              {feeds.data ? `${formatInt(feeds.data.meta.total)} artikel` : 'Memuat…'}
            </span>
            {hasFilters ? <span>Filter aktif</span> : <span>Tanpa filter</span>}
            <span className="ml-auto">
              <LiveIndicator state={live ? sseStatus : 'disabled'} />
            </span>
          </div>
        </CardContent>
      </Card>

      {pending.length > 0 ? (
        <button
          type="button"
          onClick={loadPending}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          {pending.length} artikel baru tersedia — muat sekarang
        </button>
      ) : null}

      {feeds.isError ? (
        <ErrorState message={(feeds.error as Error)?.message} onRetry={() => feeds.refetch()} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[76px] pl-4">Waktu</TableHead>
                  <TableHead>Headline</TableHead>
                  <TableHead className="hidden w-[150px] lg:table-cell">Sumber</TableHead>
                  <TableHead className="w-[104px]">Sentimen</TableHead>
                  <TableHead className="hidden w-[210px] xl:table-cell">Entitas</TableHead>
                  <TableHead className="w-[52px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {feeds.isLoading && !feeds.data
                  ? Array.from({ length: 8 }).map((_, index) => (
                      <TableRow key={index}>
                        <TableCell className="pl-4">
                          <Skeleton className="h-3 w-10" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-3 w-full max-w-lg" />
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <Skeleton className="h-3 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell className="hidden xl:table-cell">
                          <Skeleton className="h-3 w-24" />
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    ))
                  : items.map((item) => {
                      const entities = [
                        ...item.entities.persons.slice(0, 1),
                        ...item.entities.organizations.slice(0, 1),
                        ...item.entities.locations.slice(0, 1),
                      ]
                      return (
                        <TableRow
                          key={item.id}
                          className={cn(
                            'cursor-pointer',
                            newIds.includes(item.id) && 'bg-primary/[0.04]',
                          )}
                          onClick={() => void openItem(item)}
                        >
                          <TableCell className="pl-4">
                            <p className="font-mono text-xs tabular-nums text-foreground/90">
                              {formatTime(item.publishedAt)}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {formatRelative(item.publishedAt)}
                            </p>
                          </TableCell>
                          <TableCell className="py-2.5">
                            <div className="flex items-start gap-2">
                              {newIds.includes(item.id) ? (
                                <Badge variant="default" className="mt-0.5 shrink-0 px-1 py-0 text-[8px]">
                                  BARU
                                </Badge>
                              ) : null}
                              <div className="min-w-0">
                                <p className="line-clamp-2 text-xs font-medium leading-relaxed text-foreground/90">
                                  {truncate(item.title, 170)}
                                </p>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground lg:hidden">
                                  <span>{item.sourceName ?? '-'}</span>
                                  <span className="text-border">·</span>
                                  <span>{formatPercent(item.sentimentScore * 100)} yakin</span>
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <p className="truncate text-[11px] text-foreground/85">
                              {item.sourceName ?? '-'}
                            </p>
                            <p className="truncate font-mono text-[9px] text-muted-foreground">
                              {item.sourceDomain ?? '-'}
                            </p>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <SentimentBadge value={item.sentiment} />
                              <div className="h-0.5 w-14 overflow-hidden rounded-full bg-secondary">
                                <div
                                  className={cn(
                                    'h-full rounded-full',
                                    item.sentiment === 'POSITIVE' && 'bg-positive',
                                    item.sentiment === 'NEGATIVE' && 'bg-negative',
                                    item.sentiment === 'NEUTRAL' && 'bg-neutral',
                                  )}
                                  style={{ width: `${item.sentimentScore * 100}%` }}
                                />
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden xl:table-cell">
                            <div className="flex flex-wrap gap-1">
                              {entities.length > 0 ? (
                                entities.map((entity) => (
                                  <span
                                    key={entity}
                                    className="max-w-[88px] truncate rounded border border-border/70 bg-secondary/40 px-1 py-0.5 text-[9px] text-muted-foreground"
                                  >
                                    {entity}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[10px] text-muted-foreground/60">—</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="pr-4 text-right">
                            <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground/50" />
                          </TableCell>
                        </TableRow>
                      )
                    })}
              </TableBody>
            </Table>

            {!feeds.isLoading && items.length === 0 ? (
              <EmptyState
                className="m-4 border-0 bg-transparent"
                icon={Newspaper}
                title="Tidak ada artikel yang cocok"
                description="Longgarkan filter, ubah rentang waktu, atau jalankan pipeline ingestion untuk mengisi data."
                action={
                  hasFilters ? (
                    <Button variant="outline" size="sm" onClick={resetFilters}>
                      <FilterX className="h-3.5 w-3.5" />
                      Hapus filter
                    </Button>
                  ) : undefined
                }
              />
            ) : null}
          </CardContent>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
            <p className="font-mono text-[10px] text-muted-foreground">
              Halaman {feeds.data?.meta.page ?? page} dari {feeds.data?.meta.totalPages ?? 1} ·{' '}
              {formatInt(feeds.data?.meta.total ?? 0)} artikel
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={page >= (feeds.data?.meta.totalPages ?? 1)}
                onClick={() => setPage((value) => value + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      <ArticleDetailDialog
        item={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  )
}
