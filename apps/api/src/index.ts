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
          { name: 'Analytics', description: 'Agregasi tren dan sentimen' },
          { name: 'Feeds', description: 'Feed artikel dan SSE live stream' },
          { name: 'Clusters', description: 'Klaster isu dan executive briefing' },
          { name: 'Alerts', description: 'Deteksi lonjakan dan peringatan krisis' },
          { name: 'Keywords', description: 'Manajemen kata kunci Boolean' },
          { name: 'Sources', description: 'Master sumber media' },
          { name: 'Trending', description: 'Trending sosial & tokoh paling disebut' },
          { name: 'System', description: 'Status pipeline dan dependensi' },
          { name: 'Dev', description: 'Utilitas pengembangan' },
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
  .group('/api', (api) =>
    api
      .use(analyticsRoutes)
      .use(feedsRoutes)
      .use(clustersRoutes)
      .use(alertsRoutes)
      .use(keywordsRoutes)
      .use(sourcesRoutes)
      .use(systemRoutes)
      .use(trendingRoutes)
      .use(devRoutes),
  )
  .onError(({ code, error, set }) => {
    const status = (error as { status?: number }).status
    if (status) {
      set.status = status
      return { error: (error as Error).message }
    }
    if (code === 'VALIDATION') {
      set.status = 422
      return { error: 'Validasi input gagal.', details: (error as { all?: unknown }).all }
    }
    if (code === 'NOT_FOUND') {
      set.status = 404
      return { error: 'Endpoint tidak ditemukan.' }
    }
    const message = error instanceof Error ? error.message : String(error)
    if (/ECONNREFUSED|connect|password authentication|does not exist/i.test(message)) {
      set.status = 503
      return { error: 'Layanan data belum siap. Periksa PostgreSQL/Redis.', details: message }
    }
    console.error('[api:error]', error)
    set.status = 500
    return {
      error: 'Terjadi kesalahan internal.',
      details: env.isDev ? message : undefined,
    }
  })

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
