import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const OverviewPage = lazy(() => import('@/pages/Overview'))
const MediaMonitoringPage = lazy(() => import('@/pages/MediaMonitoring'))
const TopicClustersPage = lazy(() => import('@/pages/TopicClusters'))
const TrendingPage = lazy(() => import('@/pages/Trending'))
const CrisisAlertsPage = lazy(() => import('@/pages/CrisisAlerts'))
const SettingsPage = lazy(() => import('@/pages/Settings'))

function PageFallback() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-2.5 w-28" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-3 w-full max-w-xl" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-[104px] w-full" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-[320px] xl:col-span-2" />
        <Skeleton className="h-[320px]" />
      </div>
    </div>
  )
}

function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-secondary/40 text-muted-foreground">
        <Compass className="h-5 w-5" />
      </span>
      <p className="font-mono text-4xl font-semibold text-foreground">404</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Halaman yang Anda cari tidak tersedia di konsol intelijen ini.
      </p>
      <Button asChild size="sm" variant="outline">
        <Link to="/">Kembali ke overview</Link>
      </Button>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<DashboardShell />}>
        <Route
          index
          element={
            <Suspense fallback={<PageFallback />}>
              <OverviewPage />
            </Suspense>
          }
        />
        <Route
          path="media"
          element={
            <Suspense fallback={<PageFallback />}>
              <MediaMonitoringPage />
            </Suspense>
          }
        />
        <Route
          path="clusters"
          element={
            <Suspense fallback={<PageFallback />}>
              <TopicClustersPage />
            </Suspense>
          }
        />
        <Route
          path="trending"
          element={
            <Suspense fallback={<PageFallback />}>
              <TrendingPage />
            </Suspense>
          }
        />
        <Route
          path="alerts"
          element={
            <Suspense fallback={<PageFallback />}>
              <CrisisAlertsPage />
            </Suspense>
          }
        />
        <Route
          path="settings"
          element={
            <Suspense fallback={<PageFallback />}>
              <SettingsPage />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
