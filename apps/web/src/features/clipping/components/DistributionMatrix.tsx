import { useState } from 'react'
import {
  ExternalLink,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  Plus,
  Rocket,
  Share2,
  Trash2,
  Wallet,
} from 'lucide-react'
import type {
  ClipDistributionDTO,
  ClipDistributionStatus,
  ClipTargetPlatform,
  GeneratedClipDTO,
} from '@media-intel/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CLIP_DIST_STATUS_LABEL, formatIdr, formatNumber, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  useBoostDistribution,
  useDistributeClip,
  useDistributions,
  type DistributionAccountInput,
} from '@/hooks/useClipping'

const PLATFORMS: ClipTargetPlatform[] = ['tiktok', 'reels', 'shorts']

const STATUS_VARIANT: Record<
  ClipDistributionStatus,
  'default' | 'secondary' | 'positive' | 'warning' | 'critical' | 'outline'
> = {
  queued: 'outline',
  uploading: 'warning',
  published: 'positive',
  boosting: 'default',
  shadowbanned: 'critical',
  failed: 'critical',
}

const EMPTY_ACCOUNT: DistributionAccountInput = {
  targetPlatform: 'tiktok',
  accountUsername: '',
  deviceSerial: '',
  cpmRateIdr: 5000,
}

export function DistributionDialog({
  clip,
  open,
  onOpenChange,
}: {
  clip: GeneratedClipDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [accounts, setAccounts] = useState<DistributionAccountInput[]>([{ ...EMPTY_ACCOUNT }])
  const [enableTrigger, setEnableTrigger] = useState(true)
  const [watchTime, setWatchTime] = useState(180)
  const [dripWindow, setDripWindow] = useState(120)
  const distribute = useDistributeClip()

  const update = (index: number, patch: Partial<DistributionAccountInput>) => {
    setAccounts((previous) =>
      previous.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    )
  }

  const valid = accounts.filter((account) => account.accountUsername.trim().length > 0)

  const submit = () => {
    if (!clip || valid.length === 0) return
    distribute.mutate(
      {
        id: clip.id,
        accounts: valid.map((account) => ({
          ...account,
          accountUsername: account.accountUsername.replace(/^@/, '').trim(),
          deviceSerial: account.deviceSerial?.trim() || undefined,
        })),
        enableViralTrigger: enableTrigger,
        watchTimePct: watchTime,
        dripWindowMinutes: dripWindow,
      },
      {
        onSuccess: () => {
          onOpenChange(false)
          setAccounts([{ ...EMPTY_ACCOUNT }])
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Distribusi klip</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto p-5">
          {clip ? (
            <div className="rounded-md border border-border/70 bg-secondary/30 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">Klip #{clip.id}</p>
              <p className="line-clamp-1 text-[13px] font-medium text-foreground">
                {clip.titleHook}
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Akun target</Label>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAccounts((previous) => [...previous, { ...EMPTY_ACCOUNT }])}
              >
                <Plus className="h-3 w-3" /> Tambah akun
              </Button>
            </div>
            {accounts.map((account, index) => (
              <div
                key={index}
                className="grid grid-cols-[110px_1fr_auto] items-center gap-1.5"
              >
                <Select
                  value={account.targetPlatform}
                  onChange={(event) =>
                    update(index, { targetPlatform: event.target.value as ClipTargetPlatform })
                  }
                  className="h-8 text-xs"
                >
                  {PLATFORMS.map((platform) => (
                    <option key={platform} value={platform}>
                      {platform === 'tiktok' ? 'TikTok' : platform === 'reels' ? 'Reels' : 'Shorts'}
                    </option>
                  ))}
                </Select>
                <Input
                  value={account.accountUsername}
                  onChange={(event) => update(index, { accountUsername: event.target.value })}
                  placeholder="@username"
                  className="h-8 text-xs"
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() =>
                    setAccounts((previous) =>
                      previous.length === 1
                        ? [{ ...EMPTY_ACCOUNT }]
                        : previous.filter((_item, position) => position !== index),
                    )
                  }
                  aria-label="Hapus akun"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="watch-time">Target watch-time</Label>
              <Select
                id="watch-time"
                value={String(watchTime)}
                onChange={(event) => setWatchTime(Number(event.target.value))}
              >
                {[150, 180, 200, 220].map((value) => (
                  <option key={value} value={value}>
                    {value}% durasi
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drip">Jendela drip-feed</Label>
              <Select
                id="drip"
                value={String(dripWindow)}
                onChange={(event) => setDripWindow(Number(event.target.value))}
              >
                {[60, 120, 240, 360].map((value) => (
                  <option key={value} value={value}>
                    {value} menit
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-md border border-border/70 bg-secondary/20 px-3 py-2">
            <input
              type="checkbox"
              checked={enableTrigger}
              onChange={(event) => setEnableTrigger(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[hsl(var(--primary))]"
            />
            <span className="space-y-0.5">
              <span className="block text-xs font-medium text-foreground">
                Aktifkan viral trigger
              </span>
              <span className="block text-[10px] leading-relaxed text-muted-foreground">
                Search-to-watch, retention loop, save/like, dan jitter 3–12 menit per sesi.
              </span>
            </span>
          </label>

          {distribute.isError ? (
            <p className="text-[11px] text-negative">{(distribute.error as Error)?.message}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={submit} disabled={distribute.isPending || valid.length === 0}>
            {distribute.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            Jadwalkan {valid.length} akun
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Metric({
  icon: Icon,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: number
}) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] tabular-nums text-muted-foreground">
      <Icon className="h-2.5 w-2.5" />
      {formatNumber(value)}
    </span>
  )
}

export function DistributionMatrix({ clipId }: { clipId?: number }) {
  const [status, setStatus] = useState<ClipDistributionStatus | ''>('')
  const distributions = useDistributions(status ? { status } : {})
  const boost = useBoostDistribution()

  const rows = (distributions.data ?? []).filter((row) =>
    clipId ? row.clipId === clipId : true,
  )

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <div className="space-y-0.5">
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-3.5 w-3.5 text-primary" />
            Matriks distribusi
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Performa per akun + estimasi payout CPM
          </p>
        </div>
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value as ClipDistributionStatus | '')}
          className="h-8 w-[140px] text-xs"
        >
          <option value="">Semua status</option>
          {(Object.keys(CLIP_DIST_STATUS_LABEL) as ClipDistributionStatus[]).map((value) => (
            <option key={value} value={value}>
              {CLIP_DIST_STATUS_LABEL[value]}
            </option>
          ))}
        </Select>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-muted-foreground">
            Belum ada distribusi. Setujui &amp; render klip, lalu jadwalkan ke akun target.
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {rows.map((row) => (
              <DistributionRow
                key={row.id}
                row={row}
                onBoost={() => boost.mutate({ id: row.id, sessions: 10, watchTimePct: 180 })}
                boosting={boost.isPending && boost.variables?.id === row.id}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DistributionRow({
  row,
  onBoost,
  boosting,
}: {
  row: ClipDistributionDTO
  onBoost: () => void
  boosting: boolean
}) {
  return (
    <div className="space-y-2 px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[row.status]} className="text-[9px]">
          {CLIP_DIST_STATUS_LABEL[row.status]}
        </Badge>
        <span className="font-mono text-[11px] text-foreground/90">@{row.accountUsername}</span>
        <span className="rounded border border-border/70 px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
          {row.targetPlatform}
        </span>
        {row.deviceSerial ? (
          <span className="font-mono text-[9px] text-muted-foreground/70">{row.deviceSerial}</span>
        ) : null}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {row.publishedAt ? formatRelative(row.publishedAt) : 'belum terbit'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Metric icon={Eye} value={row.viewsCount} />
        <Metric icon={Heart} value={row.likesCount} />
        <Metric icon={MessageCircle} value={row.commentsCount} />
        <Metric icon={Share2} value={row.sharesCount} />
        <span className="inline-flex items-center gap-1 font-mono text-[10px] tabular-nums text-positive">
          <Wallet className="h-2.5 w-2.5" />
          {formatIdr(row.estimatedRevenueIdr)}
        </span>
        <span className="text-[9px] text-muted-foreground/70">
          CPM {formatIdr(row.cpmRateIdr)} · {row.triggerCountApplied} trigger
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {row.postUrl ? (
          <a
            href={row.postUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5',
              'text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground',
            )}
          >
            <ExternalLink className="h-2.5 w-2.5" />
            Buka post
          </a>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px]"
          onClick={onBoost}
          disabled={boosting || !row.postUrl || row.status === 'shadowbanned'}
        >
          {boosting ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : (
            <Rocket className="h-2.5 w-2.5" />
          )}
          Boost
        </Button>
        {row.lastScrapedAt ? (
          <span className="text-[9px] text-muted-foreground/60">
            scrape {formatRelative(row.lastScrapedAt)}
          </span>
        ) : null}
      </div>
    </div>
  )
}
