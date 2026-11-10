import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PlatformVolumeItem } from '@media-intel/types'
import { PLATFORM_LABEL, formatNumber } from '@/lib/format'

export function PlatformVolumeChart({ data }: { data: PlatformVolumeItem[] }) {
  const chartData = data.map((item) => ({
    ...item,
    name: PLATFORM_LABEL[item.platform] ?? item.platform,
  }))

  return (
    <div className="h-[190px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
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
            dataKey="name"
            width={92}
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
            formatter={(value: number, name: string) => [formatNumber(value), name]}
          />
          <Bar dataKey="total" name="Total" fill="hsl(var(--primary) / 0.65)" radius={[0, 3, 3, 0]} barSize={12} />
          <Bar dataKey="negative" name="Negatif" fill="hsl(var(--negative) / 0.75)" radius={[0, 3, 3, 0]} barSize={12} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
