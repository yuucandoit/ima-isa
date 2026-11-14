// Harus diimpor paling awal: `db/index.ts` membaca DATABASE_URL saat modul
// dievaluasi, jadi `.env` perlu dimuat sebelum itu.
import './lib/load-env'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'
import { checkDatabase } from './db'
import { env } from './lib/env'
import { getRedisStatus, startRedisBridge, stopRedisBridge } from './lib/redis'
import { sseHub } from './lib/sse'
import { analyticsRoutes } from './modules/analytics/controller'
import { feedsRoutes } from './modules/feeds/controller'
import { clustersRoutes } from './modules/clusters/controller'
import { alertsRoutes } from './modules/alerts/controller'
import { keywordsRoutes } from './modules/keywords/controller'
import { sourcesRoutes } from './modules/sources/controller'
import { systemRoutes } from './modules/system/controller'
import { trendingRoutes } from './modules/trending/controller'
import { devRoutes } from './modules/dev/controller'
import { clippingRoutes } from './modules/clipping/controller'
import { authRoutes } from './modules/auth/controller'
import { requireAuth } from './lib/auth'
import { scanForSpikes } from './modules/alerts/service'

const webDist = env.webDist ? resolve(env.webDist) : null
const canServeWeb = Boolean(webDist && existsSync(join(webDist, 'index.html')))

const app = new Elysia()
  .use(
    cors({
      origin: env.corsOrigin.includes('*') ? true : env.corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  )
  .use(
    swagger({
      path: '/docs',
      documentation: {
        info: {
          title: 'Indonesia Media & Social Intelligence API',
          version: '0.1.0',
          description:
            'API gateway untuk pemantauan media, analisis sentimen, semantic clustering, dan deteksi krisis.',
        },
        tags: [
          { name: 'Auth', description: 'Login/logout sesi dashboard' },
          { name: 'Analytics', description: 'Agregasi tren dan sentimen' },
          { name: 'Feeds', description: 'Feed artikel dan SSE live stream' },
          { name: 'Clusters', description: 'Klaster isu dan executive briefing' },
          { name: 'Alerts', description: 'Deteksi lonjakan dan peringatan krisis' },
          { name: 'Keywords', description: 'Manajemen kata kunci Boolean' },
          { name: 'Sources', description: 'Master sumber media' },
          { name: 'Trending', description: 'Trending sosial & tokoh paling disebut' },
          { name: 'System', description: 'Status pipeline dan dependensi' },
          { name: 'Dev', description: 'Utilitas pengembangan' },
          {
            name: 'Clipping',
            description: 'Kliping video AI, distribusi multi-akun, dan payout CPM',
          },
        ],
      },
    }),
  )
  .get('/', () => {
    if (canServeWeb && webDist) {
      return Bun.file(join(webDist, 'index.html'))
    }
    return {
      name: 'media-intel-api',
      version: '0.1.0',
      docs: '/docs',
      health: '/health',
    }
  })
  .get('/health', async () => {
    const database = await checkDatabase()
    const redis = getRedisStatus()
    return {
      status: database ? 'ok' : 'degraded',
      database: database ? 'ok' : 'error',
      redis: redis.status,
      sseClients: sseHub.size,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    }
  })
  // `onError` harus dipasang SEBELUM route: pada Elysia 1.4, handler error
  // validasi hanya berlaku untuk route yang didaftarkan setelahnya. Bila
  // diletakkan setelah `.group('/api', …)`, respons validasi keluar sebagai
  // objek mentah Elysia (`type`/`property`/`expected`) dan melanggar kontrak
  // `{ error, details }` yang dipakai Eden Treaty di dashboard.
  .onError(({ code, error, set }) => {
    // `code` diperiksa lebih dulu: error VALIDATION/NOT_FOUND bawaan Elysia
    // membawa properti `status` sehingga akan tertangkap cabang generik di
    // bawah bila urutannya dibalik.
    if (code === 'VALIDATION') {
      const failures = (error as { all?: Array<{ path?: string; message?: string }> }).all
      set.status = 422
      return {
        error: failures?.[0]?.message
          ? `Validasi input gagal: ${failures[0].message}`
          : 'Validasi input gagal.',
        details: failures?.map((failure) => ({
          path: failure.path,
          message: failure.message,
        })),
      }
    }
    if (code === 'NOT_FOUND') {
      set.status = 404
      return { error: 'Endpoint tidak ditemukan.' }
    }
    const status = (error as { status?: number }).status
    if (status) {
      set.status = status
      return { error: (error as Error).message }
    }
    const message = error instanceof Error ? error.message : String(error)
    if (/ECONNREFUSED|connect|password authentication|does not exist/i.test(message)) {
      set.status = 503
      // Detail koneksi bisa memuat host/user database: jangan bocorkan di produksi.
      return {
        error: 'Layanan data belum siap. Periksa PostgreSQL/Redis.',
        details: env.isDev ? message : undefined,
      }
    }
    console.error('[api:error]', error)
    set.status = 500
    return {
      error: 'Terjadi kesalahan internal.',
      details: env.isDev ? message : undefined,
    }
  })
  .group('/api', (api) =>
    api
      // Auth dipasang lebih dulu agar `/api/auth/*` (login, logout, me) tetap
      // bisa diakses tanpa sesi; guard global di bawah mengecualikannya.
      .use(authRoutes)
      .onBeforeHandle(async ({ request, path, set }) => {
        if (path.startsWith('/api/auth/')) return
        try {
          await requireAuth(request)
        } catch (error) {
          set.status = (error as { status?: number }).status ?? 401
          return { error: (error as Error).message }
        }
      })
      .use(analyticsRoutes)
      .use(feedsRoutes)
      .use(clustersRoutes)
      .use(alertsRoutes)
      .use(keywordsRoutes)
      .use(sourcesRoutes)
      .use(systemRoutes)
      .use(trendingRoutes)
      .use(devRoutes)
      .use(clippingRoutes),
  )

// Optional single-origin deployment: serve the built dashboard when WEB_DIST is set.

if (webDist && canServeWeb) {
  app.get('/*', ({ request, set }) => {
    const url = new URL(request.url)
    if (/^\/(api|health|docs)(\/|$)/.test(url.pathname)) {
      set.status = 404
      return { error: 'Endpoint tidak ditemukan.' }
    }
    const requested = url.pathname === '/' ? '/index.html' : url.pathname
    const candidate = resolve(join(webDist, requested))
    if (candidate.startsWith(webDist) && existsSync(candidate) && statSync(candidate).isFile()) {
      return Bun.file(candidate)
    }
    set.headers['cache-control'] = 'no-cache'
    return Bun.file(join(webDist, 'index.html'))
  })
  console.log(`▸ Menyajikan dashboard dari ${webDist}`)
}

app.listen(env.port)

console.log(
  `🦊 Media Intel API berjalan di http://localhost:${env.port} (docs: /docs, env: ${env.nodeEnv})`,
)

void startRedisBridge()

if (env.alertScanEnabled) {
  const timer = setInterval(() => {
    scanForSpikes()
      .then((result) => {
        if (result.triggered > 0) {
          console.log(`[alerts] ${result.triggered} peringatan baru dipicu.`)
        }
      })
      .catch((error) => console.warn('[alerts] scan gagal:', error instanceof Error ? error.message : error))
  }, env.alertScanIntervalMs)
  timer.unref?.()
}

const shutdown = async () => {
  console.log('\n▸ Menutup API…')
  await stopRedisBridge()
  await app.stop()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

export type App = typeof app
