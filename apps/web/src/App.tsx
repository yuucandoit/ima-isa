import { lazy, Suspense } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Compass, Radar } from 'lucide-react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/useAuth'

const OverviewPage = lazy(() => import('@/pages/Overview'))
const MediaMonitoringPage = lazy(() => import('@/pages/MediaMonitoring'))
const TopicClustersPage = lazy(() => import('@/pages/TopicClusters'))
const TrendingPage = lazy(() => import('@/pages/Trending'))
const ClippingStudioPage = lazy(() => import('@/features/clipping/pages/ClippingStudioPage'))
const ClippingSourceDetailPage = lazy(
  () => import('@/features/clipping/pages/ClippingSourceDetailPage'),
)
const CrisisAlertsPage = lazy(() => import('@/pages/CrisisAlerts'))
const SettingsPage = lazy(() => import('@/pages/Settings'))
const LoginPage = lazy(() => import('@/pages/Login'))

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

/** Layar tunggu singkat saat sesi sedang diverifikasi. */
function AuthSplash() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <span className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
          <Radar className="h-5 w-5 animate-pulse text-primary" />
        </span>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
          memverifikasi sesi…
        </p>
      </div>
    </div>
  )
}

/**
 * Bungkus rute yang butuh login. Saat `status === 'loading'` jangan langsung
 * redirect: sesi masih diperiksa dan redirect dini akan membuat pengguna
 * terlempar ke /login setiap kali halaman di-refresh.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <AuthSplash />
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

export default function App() {
  const { status } = useAuth()

  return (
    <Routes>
      <Route
        path="login"
        element={
          status === 'authenticated' ? (
            <Navigate to="/" replace />
          ) : (
            <Suspense fallback={<AuthSplash />}>
              <LoginPage />
            </Suspense>
          )
        }
      />
      <Route
        element={
          <RequireAuth>
            <DashboardShell />
          </RequireAuth>
        }
      >
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
          path="clipping"
          element={
            <Suspense fallback={<PageFallback />}>
              <ClippingStudioPage />
            </Suspense>
          }
        />
        <Route
          path="clipping/:id"
          element={
            <Suspense fallback={<PageFallback />}>
              <ClippingSourceDetailPage />
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
