import {
  Brain,
  Clock3,
  Radar,
  Save,
  Search,
  ShieldCheck,
  Timer,
  Zap,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatNumber } from '@/lib/format'
import type { ClippingAnalyticsSummary } from '@media-intel/types'

const RULES = [
  {
    icon: Search,
    title: 'Search-to-watch',
    body: 'Scroll FYP 2–3 video → tab Search → ketik username/keyword → buka video dari hasil pencarian.',
  },
  {
    icon: Timer,
    title: 'Retention weighting',
    body: 'Tonton 150–220% durasi (1x penuh + loop) agar sinyal retensi melampaui baseline.',
  },
  {
    icon: Save,
    title: 'Interaksi terbobot',
    body: 'Save 60% · Copy link 40% · Like 80% · Komentar 12%, masing-masing dengan jeda manusiawi.',
  },
  {
    icon: Clock3,
    title: 'Drip-feed jitter',
    body: 'Satu interaksi tiap 3–12 menit (distribusi normal) dalam 2 jam pertama setelah terbit.',
  },
  {
    icon: ShieldCheck,
    title: 'Isolasi jaringan',
    body: 'Rotasi IP seluler via airplane-mode toggle ADB antar sesi akun; tanpa closed-loop follow.',
  },
  {
    icon: Radar,
    title: 'Deteksi shadowban',
    body: 'Views < 10 setelah 6 jam → status `shadowbanned` + alert evaluasi akun/proxy.',
  },
]

export function ViralTriggerPanel({ summary }: { summary?: ClippingAnalyticsSummary }) {
  const triggers = summary?.totals.triggers ?? 0
  const shadow = summary?.byStatus.find((item) => item.status === 'shadowbanned')?.total ?? 0
  const boosting = summary?.byStatus.find((item) => item.status === 'boosting')?.total ?? 0

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="space-y-0.5">
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-3.5 w-3.5 text-accent" />
            Viral Trigger Engine
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Perilaku manusia sintetis untuk melewati batch testing awal
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="default" className="text-[9px]">
            <Zap className="h-2.5 w-2.5" />
            {formatNumber(triggers)} sesi
          </Badge>
          {shadow > 0 ? (
            <Badge variant="critical" className="text-[9px]">
              {shadow} shadowban
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Sedang boost" value={formatNumber(boosting)} tone="text-primary" />
          <Stat
            label="Rata-rata skor"
            value={String(summary?.totals.averageViralityScore ?? 0)}
            tone="text-foreground"
          />
          <Stat
            label="Estimasi payout"
            value={formatNumber(summary?.totals.estimatedRevenueIdr ?? 0)}
            tone="text-positive"
          />
        </div>

        <ul className="mt-3 space-y-2">
          {RULES.map((rule) => (
            <li key={rule.title} className="flex gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border/70 bg-secondary/40 text-muted-foreground">
                <rule.icon className="h-2.5 w-2.5" />
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-[11px] font-medium text-foreground/90">{rule.title}</p>
                <p className="text-[10px] leading-relaxed text-muted-foreground">{rule.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-secondary/25 px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70">{label}</p>
      <p className={`font-mono text-sm tabular-nums ${tone}`}>{value}</p>
    </div>
  )
}
