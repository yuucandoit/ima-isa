import { useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'

export function SeverityStripe({ severity }: { severity: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute inset-y-0 left-0 w-0.5',
        severity === 'CRITICAL' && 'bg-critical',
        severity === 'HIGH' && 'bg-warning',
        severity === 'MEDIUM' && 'bg-warning/50',
        severity === 'LOW' && 'bg-border',
      )}
    />
  )
}

export function PageBreadcrumb() {
  const location = useLocation()
  const labels: Record<string, string> = {
    '/': 'Overview',
    '/media': 'Media Monitoring',
    '/clusters': 'Topic Clusters',
    '/trending': 'Trending & Tokoh',
    '/clipping': 'Clipping Studio',
    '/alerts': 'Crisis Alerts',
    '/settings': 'Pengaturan',
  }

  // Halaman detail (`/clipping/12`) tidak punya entri persis; turunkan label
  // dari segmen pertama agar breadcrumb tidak jatuh ke "Overview".
  const section = `/${location.pathname.split('/')[1] ?? ''}`
  const label = labels[location.pathname] ?? labels[section] ?? 'Overview'
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span className="font-mono uppercase tracking-[0.16em] text-muted-foreground/70">
        IMA-ISA
      </span>
      <span className="text-border">/</span>
      <span className="text-foreground/80">{label}</span>
    </div>
  )
}
