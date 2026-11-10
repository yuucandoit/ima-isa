import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { ShareOfVoiceItem } from '@media-intel/types'
import { formatNumber, formatPercent } from '@/lib/format'

const PALETTE = [
  'hsl(158 64% 52%)',
  'hsl(194 70% 55%)',
  'hsl(220 80% 66%)',
  'hsl(38 92% 58%)',
  'hsl(352 78% 62%)',
  'hsl(275 70% 66%)',
  'hsl(180 50% 50%)',
  'hsl(20 85% 62%)',
]

export function ShareOfVoiceChart({ data, total }: { data: ShareOfVoiceItem[]; total: number }) {
  const top = data.slice(0, 7)
  const chartData = top.map((item, index) => ({
    name: item.sourceName,
    value: item.total,
    color: PALETTE[index % PALETTE.length],
  }))

  return (
    <div className="grid gap-4 sm:grid-cols-[168px_1fr] sm:items-center">
      <div className="relative h-[168px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={54}
              outerRadius={78}
              paddingAngle={2}
              stroke="hsl(var(--card))"
              strokeWidth={2}
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                fontSize: 11,
                color: 'hsl(var(--foreground))',
              }}
              formatter={(value: number) => [formatNumber(value), 'Artikel']}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
            {formatNumber(total)}
          </span>
          <span className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            artikel
          </span>
        </div>
      </div>

      <ul className="space-y-2">
        {top.map((item, index) => (
          <li key={`${item.sourceName}-${index}`}>
            <div className="flex items-center gap-2 text-[11px]">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: PALETTE[index % PALETTE.length] }}
              />
              <span className="min-w-0 flex-1 truncate text-foreground/85">{item.sourceName}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {formatNumber(item.total)}
              </span>
              <span className="w-10 text-right font-mono tabular-nums text-foreground">
                {formatPercent(item.sharePct)}
              </span>
            </div>
            <div className="ml-3.5 mt-1 h-0.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, item.sharePct)}%`,
                  background: PALETTE[index % PALETTE.length],
                }}
              />
            </div>
          </li>
        ))}
        {top.length === 0 ? (
          <li className="text-xs text-muted-foreground">Belum ada data sumber pada rentang ini.</li>
        ) : null}
      </ul>
    </div>
  )
}
