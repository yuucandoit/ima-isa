import type { EntityCount, HeatmapCell } from '@media-intel/types'
import { Building2, MapPin, UserRound } from 'lucide-react'
import { formatNumber } from '@/lib/format'

const ENTITY_META = {
  person: { icon: UserRound, label: 'Tokoh', color: 'hsl(194 70% 55%)' },
  organization: { icon: Building2, label: 'Organisasi', color: 'hsl(158 64% 52%)' },
  location: { icon: MapPin, label: 'Lokasi', color: 'hsl(38 92% 58%)' },
} as const

export function EntityList({ entities }: { entities: EntityCount[] }) {
  const max = Math.max(1, ...entities.map((entity) => entity.count))

  return (
    <ul className="space-y-2.5">
      {entities.slice(0, 8).map((entity) => {
        const meta = ENTITY_META[entity.type]
        const Icon = meta.icon
        return (
          <li key={`${entity.type}-${entity.name}`} className="group">
            <div className="flex items-center gap-2">
              <Icon className="h-3 w-3 shrink-0" style={{ color: meta.color }} />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">
                {entity.name}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {formatNumber(entity.count)}
              </span>
            </div>
            <div className="ml-5 mt-1 h-0.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full opacity-70 transition-opacity group-hover:opacity-100"
                style={{
                  width: `${Math.max(3, (entity.count / max) * 100)}%`,
                  background: meta.color,
                }}
              />
            </div>
          </li>
        )
      })}
      {entities.length === 0 ? (
        <li className="text-xs text-muted-foreground">Belum ada entitas terdeteksi.</li>
      ) : null}
    </ul>
  )
}

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

export function ActivityHeatmap({ cells }: { cells: HeatmapCell[] }) {
  const max = Math.max(1, ...cells.map((cell) => cell.total))
  const map = new Map(cells.map((cell) => [`${cell.day}-${cell.hour}`, cell.total]))

  return (
    <div className="space-y-2">
      <div className="min-w-0 overflow-x-auto no-scrollbar">
        <div className="min-w-[420px]">
          <div className="mb-1 flex gap-[3px] pl-7">
            {Array.from({ length: 24 }).map((_, hour) => (
              <span
                key={hour}
                className="w-full text-center font-mono text-[8px] text-muted-foreground/60"
              >
                {hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}
              </span>
            ))}
          </div>
          {DAYS.map((day, dayIndex) => (
            <div key={day} className="mb-[3px] flex items-center gap-[3px]">
              <span className="w-6 shrink-0 text-[9px] uppercase text-muted-foreground/70">
                {day}
              </span>
              {Array.from({ length: 24 }).map((_, hour) => {
                const value = map.get(`${dayIndex}-${hour}`) ?? 0
                const intensity = value === 0 ? 0.06 : 0.16 + (value / max) * 0.78
                return (
                  <span
                    key={hour}
                    title={`${day} ${String(hour).padStart(2, '0')}:00 — ${value} artikel`}
                    className="h-3.5 w-full rounded-[2px] transition-transform hover:scale-110"
                    style={{ background: `hsl(var(--primary) / ${intensity})` }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5 text-[9px] text-muted-foreground/70">
        <span>Rendah</span>
        {[0.12, 0.3, 0.5, 0.72, 0.92].map((opacity) => (
          <span
            key={opacity}
            className="h-2 w-2 rounded-[2px]"
            style={{ background: `hsl(var(--primary) / ${opacity})` }}
          />
        ))}
        <span>Tinggi</span>
      </div>
    </div>
  )
}
