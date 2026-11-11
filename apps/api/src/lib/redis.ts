import Redis from 'ioredis'
import { env } from './env'
import { sseHub } from './sse'

let publisher: Redis | null = null
let subscriber: Redis | null = null
let available = false
let lastError: string | null = null

function createClient(name: string): Redis {
  const client = new Redis(env.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
  })
  client.on('error', (error) => {
    lastError = error.message
    if (available) console.warn(`[redis:${name}] ${error.message}`)
    available = false
  })
  client.on('ready', () => {
    if (!available) console.log(`[redis:${name}] connected`)
    available = true
    lastError = null
  })
  return client
}

export function getRedisStatus(): { status: 'ok' | 'error' | 'disabled'; error: string | null } {
  if (!env.redisUrl) return { status: 'disabled', error: null }
  return { status: available ? 'ok' : 'error', error: lastError }
}

export function getPublisher(): Redis | null {
  return publisher
}

/**
 * Tandai bahwa dashboard sedang membuka trending. Worker Python memakai kunci ini
 * untuk menghemat bandwidth: scrape halaman Google (±154 KB/request) hanya
 * dilakukan saat ada penonton, atau sekali sejam bila sepi.
 */
export function markTrendInterest(platform: string, ttlSeconds = 900): void {
  const client = publisher
  if (!client) return
  client
    .set(`trends:interest:${platform.toLowerCase()}`, '1', 'EX', ttlSeconds)
    .catch(() => {
      /* best-effort: kegagalan Redis tidak boleh menggagalkan request */
    })
}

/**
 * Bridge Redis pub/sub (fed by the Python workers) into the in-process SSE hub,
 * and mirror a few channels for observability.
 */
export async function startRedisBridge(): Promise<void> {
  if (!env.redisUrl) return

  publisher = createClient('publisher')
  subscriber = createClient('subscriber')

  subscriber.on('message', (channel, message) => {
    let payload: unknown = message
    try {
      payload = JSON.parse(message)
    } catch {
      /* keep raw string */
    }

    if (channel === 'media:new') {
      sseHub.broadcast('media', payload, 'media')
      sseHub.broadcast('media', payload, 'overview')
    } else if (channel === 'alerts:new') {
      sseHub.broadcast('alert', payload, 'alerts')
      sseHub.broadcast('alert', payload, 'overview')
    } else if (channel === 'clusters:updated') {
      sseHub.broadcast('cluster', payload, 'clusters')
    }
  })

  try {
    await publisher.connect()
    await subscriber.connect()
    await subscriber.subscribe('media:new', 'alerts:new', 'clusters:updated')
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    console.warn(`[redis] bridge unavailable: ${lastError}`)
  }
}

export async function publish(channel: string, payload: unknown): Promise<boolean> {
  if (!publisher) return false
  try {
    await publisher.publish(channel, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export async function stopRedisBridge(): Promise<void> {
  await Promise.allSettled([publisher?.quit(), subscriber?.quit()])
  publisher = null
  subscriber = null
}
