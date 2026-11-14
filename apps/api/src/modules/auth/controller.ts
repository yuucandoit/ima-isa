import { Elysia, t } from 'elysia'
import { env } from '../../lib/env'
import {
  clearCookie,
  createSession,
  destroySession,
  isSecureRequest,
  readCookie,
  requireAuth,
  sessionCookie,
  SESSION_COOKIE,
  verifyCredentials,
} from '../../lib/auth'

const loginBody = t.Object({
  username: t.String({ minLength: 1, maxLength: 80 }),
  password: t.String({ minLength: 1, maxLength: 200 }),
})

/** Batasi percobaan login untuk memperlambat brute force. */
const attempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 8
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000

function clientKey(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'local'
  )
}

function tooManyAttempts(key: string): boolean {
  const entry = attempts.get(key)
  if (!entry) return false
  if (entry.resetAt <= Date.now()) {
    attempts.delete(key)
    return false
  }
  return entry.count >= MAX_ATTEMPTS
}

function recordFailure(key: string): void {
  const entry = attempts.get(key)
  if (!entry || entry.resetAt <= Date.now()) {
    attempts.set(key, { count: 1, resetAt: Date.now() + ATTEMPT_WINDOW_MS })
    return
  }
  entry.count += 1
}

export const authRoutes = new Elysia({ prefix: '/auth', tags: ['Auth'] })
  .post(
    '/login',
    async ({ body, request, set }) => {
      const key = clientKey(request)
      if (tooManyAttempts(key)) {
        set.status = 429
        return {
          error: 'Terlalu banyak percobaan masuk. Coba lagi dalam beberapa menit.',
        }
      }

      const ok = await verifyCredentials(body.username, body.password)
      if (!ok) {
        recordFailure(key)
        set.status = 401
        return { error: 'Username atau password salah.' }
      }

      attempts.delete(key)
      const token = await createSession(body.username.trim())
      set.headers['set-cookie'] = sessionCookie(token, isSecureRequest(request))
      return {
        authenticated: true,
        username: body.username.trim(),
        expiresInDays: 7,
      }
    },
    {
      body: loginBody,
      detail: { summary: 'Masuk dengan kredensial admin (cookie sesi httpOnly)' },
    },
  )
  .post(
    '/logout',
    async ({ request, set }) => {
      await destroySession(readCookie(request, SESSION_COOKIE))
      set.headers['set-cookie'] = clearCookie(isSecureRequest(request))
      return { authenticated: false }
    },
    { detail: { summary: 'Keluar dan hapus sesi' } },
  )
  .get(
    '/me',
    async ({ request, set }) => {
      try {
        const auth = await requireAuth(request)
        return {
          authenticated: true,
          username: auth.username,
          via: auth.via,
          // Berguna untuk UI: tampilkan login walau API_KEY tidak di-set.
          authRequired: env.authRequired,
        }
      } catch {
        set.status = 401
        return {
          authenticated: false,
          username: null,
          via: null,
          authRequired: env.authRequired,
        }
      }
    },
    { detail: { summary: 'Status sesi saat ini' } },
  )
