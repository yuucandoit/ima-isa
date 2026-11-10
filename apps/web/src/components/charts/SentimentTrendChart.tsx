import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SentimentPoint } from '@media-intel/types'
import { formatNumber } from '@/lib/format'

const SERIES = [
  { key: 'positive', label: 'Positif', color: 'hsl(var(--positive))' },
  { key: 'neutral', label: 'Netral', color: 'hsl(var(--neutral))' },
  { key: 'negative', label: 'Negatif', color: 'hsl(var(--negative))' },
] as const

function trendLabel(value: string | number | undefined, bucket: 'hour' | 'day'): string {
  const text = String(value ?? '')
  if (bucket === 'hour') {
    const [, time] = text.split(' ')
    return time ?? text
  }
  const [, month, day] = text.split('-')
  return day && month ? `${day}/${month}` : text
}

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; value?: number; color?: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((sum, entry) => sum + (entry.value ?? 0), 0)
  return (
    <div className="rounded-md border border-border bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label} WIB
      </p>
      <div className="space-y-1">
        {SERIES.map((series) => {
          const entry = payload.find((candidate) => candidate.dataKey === series.key)
          return (
            <div key={series.key} className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: series.color }}
              />
              <span className="min-w-[52px] text-muted-foreground">{series.label}</span>
              <span className="ml-auto font-mono tabular-nums text-foreground">
                {formatNumber(entry?.value ?? 0)}
              </span>
            </div>
          )
        })}
        <div className="flex items-center gap-2 border-t border-border/60 pt-1">
          <span className="min-w-[52px] text-muted-foreground">Total</span>
          <span className="ml-auto font-mono font-semibold tabular-nums text-foreground">
            {formatNumber(total)}
          </span>
        </div>
      </div>
    </div>
  )
}

export function SentimentTrendChart({
  data,
  bucket,
}: {
  data: SentimentPoint[]
  bucket: 'hour' | 'day'
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {SERIES.map((series) => (
          <span key={series.key} className="inline-flex items-center gap-1.5 text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: series.color }} />
            <span className="text-muted-foreground">{series.label}</span>
          </span>
        ))}
      </div>
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <defs>
              {SERIES.map((series) => (
                <linearGradient key={series.key} id={`fill-${series.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={series.color} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={series.color} stopOpacity={0.03} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" vertical={false} />
            <XAxis
              dataKey="label"
              tickFormatter={(value: string | number) => trendLabel(value, bucket)}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'hsl(var(--border))' }} />
            {SERIES.map((series) => (
              <Area
                key={series.key}
                type="monotone"
                dataKey={series.key}
                stackId="sentiment"
                stroke={series.color}
                strokeWidth={1.5}
                fill={`url(#fill-${series.key})`}
                activeDot={{ r: 3, strokeWidth: 0 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
