import { RANGE_LABEL, type RangePreset } from '@/lib/format'
import { cn } from '@/lib/utils'

const PRESETS: RangePreset[] = ['24h', '7d', '30d']

export function RangeTabs({
  value,
  onChange,
}: {
  value: RangePreset
  onChange: (value: RangePreset) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Rentang waktu"
      className="inline-flex items-center rounded-md border border-border/80 bg-background/40 p-0.5"
    >
      {PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          role="tab"
          aria-selected={value === preset}
          onClick={() => onChange(preset)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            value === preset
              ? 'bg-secondary text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {RANGE_LABEL[preset]}
        </button>
      ))}
    </div>
  )
}
