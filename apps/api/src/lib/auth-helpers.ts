/**
 * Helper murni autentikasi (tanpa Redis/env) agar mudah dites dan dipakai ulang.
 */

export const SESSION_COOKIE_NAME = 'ima_session'

/** Ambil nilai cookie dari header `Cookie` mentah. */
export function readCookieHeader(header: string | null | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    const separator = trimmed.indexOf('=')
    if (separator === -1) continue
    const key = trimmed.slice(0, separator)
    if (key !== name) continue
    return decodeURIComponent(trimmed.slice(separator + 1))
  }
  return null
}

/** Ambil token sesi dari satu header `Set-Cookie`. */
export function sessionCookieValue(header: string | null | undefined): string | null {
  if (!header) return null
  const first = header.split(';')[0] ?? ''
  const separator = first.indexOf('=')
  if (separator === -1) return null
  if (first.slice(0, separator) !== SESSION_COOKIE_NAME) return null
  const value = first.slice(separator + 1).trim()
  return value || null
}

/** Parse boolean dari env dengan daftar nilai falsy yang eksplisit. */
export function parseBool(value: string | undefined | null, fallback: boolean): boolean {
  if (value === undefined || value === null || value.trim() === '') return fallback
  const normalized = value.trim().toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  return true
}
