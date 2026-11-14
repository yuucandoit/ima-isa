import {
  parseBool,
  readCookieHeader,
  SESSION_COOKIE_NAME,
} from './auth-helpers'
import { env } from './env'
import { getPublisher } from './redis'

/**
 * Autentikasi sesi untuk dashboard.
 *
 * Model keamanan:
 *  - **Browser** memakai cookie sesi `httpOnly` (tidak bisa dibaca JS, jadi aman
 *    dari XSS pencurian token). EventSource untuk SSE ikut mengirim cookie
 *    otomatis karena same-origin.
 *  - **Otomasi/CLI** tetap bisa memakai header `x-api-key` lama (API_KEY),
 *    sehingga skrip `curl` dan integrasi yang sudah ada tidak patah.
 *
 * Sesi disimpan di Redis (TTL) agar tetap hidup saat API restart. Bila Redis
 * tidak tersedia, dipakai Map in-memory supaya dashboard tetap bisa dipakai.
 */

export const SESSION_COOKIE = SESSION_COOKIE_NAME

/** Umur sesi: 7 hari. Cukup panjang untuk workstation analis. */
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

const SESSION_PREFIX = 'auth:session:'

export interface Session {
  username: string
  createdAt: string
}

/* ── Kredensial ────────────────────────────────────────────── */

export const ADMIN_USERNAME = (process.env.ADMIN_USERNAME ?? 'admin').trim()
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ima-isa-2026'

/**
 * Hash password admin sekali saat modul dimuat.
 *
 * Disimpan sebagai hash (bukan teks polos di memori) dan diverifikasi dengan
 * `Bun.password` (argon2id) agar perbandingan bersifat constant-time — mencegah
 * timing attack walau hanya satu akun.
 */
let passwordHash: Promise<string> | null = null

function adminHash(): Promise<string> {
  if (!passwordHash) {
    passwordHash = Bun.password.hash(ADMIN_PASSWORD, {
      algorithm: 'argon2id',
      memoryCost: 19_456,
      timeCost: 2,
    })
  }
  return passwordHash
}

/** Verifikasi kredensial. Selalu constant-time terhadap hash. */
export async function verifyCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  // Bandingkan username lebih dulu; tetap jalankan verify agar waktu respons
  // tidak membocorkan apakah username benar.
  const usernameOk = timingSafeEqual(username.trim().toLowerCase(), ADMIN_USERNAME.toLowerCase())
  const passwordOk = await Bun.password.verify(password, await adminHash()).catch(() => false)
  return usernameOk && passwordOk
}

function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let index = 0; index < length; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0)
  }
  return diff === 0
}

/* ── Session store ─────────────────────────────────────────── */

const memorySessions = new Map<string, { session: Session; expiresAt: number }>()

function newToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createSession(username: string): Promise<string> {
  const token = newToken()
  const session: Session = { username, createdAt: new Date().toISOString() }

  const redis = getPublisher()
  if (redis) {
    try {
      await redis.set(
        `${SESSION_PREFIX}${token}`,
        JSON.stringify(session),
        'EX',
        SESSION_TTL_SECONDS,
      )
      return token
    } catch {
      /* jatuh ke memori */
    }
  }
  memorySessions.set(token, {
    session,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  })
  return token
}

export async function getSession(token: string | null | undefined): Promise<Session | null> {
  if (!token) return null

  const redis = getPublisher()
  if (redis) {
    try {
      const raw = await redis.get(`${SESSION_PREFIX}${token}`)
      if (raw) return JSON.parse(raw) as Session
    } catch {
      /* jatuh ke memori */
    }
  }

  const entry = memorySessions.get(token)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    memorySessions.delete(token)
    return null
  }
  return entry.session
}

export async function destroySession(token: string | null | undefined): Promise<void> {
  if (!token) return
  memorySessions.delete(token)
  const redis = getPublisher()
  if (!redis) return
  try {
    await redis.del(`${SESSION_PREFIX}${token}`)
  } catch {
    /* best effort */
  }
}

/* ── Cookie helpers ────────────────────────────────────────── */

export function readCookie(request: Request, name: string): string | null {
  return readCookieHeader(request.headers.get('cookie'), name)
}

/**
 * Susun header `Set-Cookie`. `Secure` hanya saat HTTPS supaya dev di
 * `http://localhost` tetap bisa login.
 */
export function sessionCookie(token: string, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ]
  if (secure) attributes.push('Secure')
  return attributes.join('; ')
}

export function clearCookie(secure: boolean): string {
  const attributes = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (secure) attributes.push('Secure')
  return attributes.join('; ')
}

export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')
  if (forwarded) return forwarded.split(',')[0]!.trim() === 'https'
  return new URL(request.url).protocol === 'https:'
}

/* ── Guard ─────────────────────────────────────────────────── */

export interface AuthContext {
  /** `session` = login browser, `api-key` = otomasi, `open` = auth dimatikan. */
  via: 'session' | 'api-key' | 'open'
  username: string | null
}

function unauthorized(message: string): never {
  throw Object.assign(new Error(message), { status: 401 })
}

/**
 * Wajib login untuk request yang menyentuh data.
 *
 * Urutan: API key (otomasi) → cookie sesi (browser). Bila tidak ada `API_KEY`
 * dan `AUTH_REQUIRED=false`, akses dibuka agar dev lokal tidak terhambat.
 */
export async function requireAuth(request: Request): Promise<AuthContext> {
  const apiKeyHeader = request.headers.get('x-api-key')
  if (env.apiKey && apiKeyHeader === env.apiKey) {
    return { via: 'api-key', username: 'api-key' }
  }

  const token = readCookie(request, SESSION_COOKIE)
  const session = await getSession(token)
  if (session) return { via: 'session', username: session.username }

  if (!env.authRequired) return { via: 'open', username: null }

  if (apiKeyHeader && env.apiKey && apiKeyHeader !== env.apiKey) {
    unauthorized('API key tidak valid.')
  }
  unauthorized('Sesi tidak ditemukan. Silakan masuk.')
}
