import type { AlertSeverity, SentimentLabel } from '@media-intel/types'
import { Badge } from '@/components/ui/badge'
import { SEVERITY_LABEL, SENTIMENT_LABEL } from '@/lib/format'

export function SentimentBadge({ value }: { value: SentimentLabel }) {
  const variant =
    value === 'POSITIVE' ? 'positive' : value === 'NEGATIVE' ? 'negative' : 'neutral'
  return <Badge variant={variant}>{SENTIMENT_LABEL[value]}</Badge>
}

export function SeverityBadge({
  value,
  withDot = true,
}: {
  value: AlertSeverity
  withDot?: boolean
}) {
  const variant =
    value === 'CRITICAL'
      ? 'critical'
      : value === 'HIGH'
        ? 'high'
        : value === 'MEDIUM'
          ? 'warning'
          : 'neutral'
  return (
    <Badge variant={variant}>
      {withDot ? (
        <span
          className="h-1 w-1 rounded-full bg-current"
          aria-hidden
        />
      ) : null}
      {SEVERITY_LABEL[value]}
    </Badge>
  )
}
