import { describe, expect, it } from 'bun:test'
import { parseBool, readCookieHeader, sessionCookieValue } from './auth-helpers'

/**
 * Tes kontrak autentikasi.
 *
 * Regresi yang dijaga: sesi disimpan di cookie `httpOnly`, jadi nilai cookie
 * harus bisa diparse dari header `Cookie` mentah — termasuk karakter `=` di
 * dalam token (base64/hex) yang sering terpotong oleh split naif.
 */

describe('readCookieHeader', () => {
  it('menemukan cookie tunggal', () => {
    expect(readCookieHeader('ima_session=abc123', 'ima_session')).toBe('abc123')
  })

  it('menemukan cookie di antara beberapa nilai', () => {
    const header = 'theme=dark; ima_session=deadbeef; other=1'
    expect(readCookieHeader(header, 'ima_session')).toBe('deadbeef')
  })

  it('mengembalikan null bila header kosong', () => {
    expect(readCookieHeader(null, 'ima_session')).toBeNull()
    expect(readCookieHeader('', 'ima_session')).toBeNull()
  })

  it('mengembalikan null bila cookie tidak ada', () => {
    expect(readCookieHeader('theme=dark', 'ima_session')).toBeNull()
  })

  it('tidak tertipu cookie dengan prefix mirip', () => {
    expect(readCookieHeader('x_ima_session=evil', 'ima_session')).toBeNull()
  })

  it('menangani nilai berisi tanda sama dengan', () => {
    // Token base64 bisa mengakhiri dengan '='.
    expect(readCookieHeader('ima_session=abc==', 'ima_session')).toBe('abc==')
  })
})

describe('sessionCookieValue', () => {
  it('mengekstrak token dari Set-Cookie', () => {
    const header =
      'ima_session=b334c04814f3; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800'
    expect(sessionCookieValue(header)).toBe('b334c04814f3')
  })

  it('mengembalikan null untuk header tanpa cookie sesi', () => {
    expect(sessionCookieValue('theme=dark; Path=/')).toBeNull()
  })
})

describe('parseBool', () => {
  it('memperlakukan nilai falsy yang umum sebagai false', () => {
    for (const value of ['false', '0', 'no', 'off', 'FALSE', ' No ']) {
      expect(parseBool(value, true)).toBe(false)
    }
  })

  it('memakai default saat tidak di-set', () => {
    expect(parseBool(undefined, true)).toBe(true)
    expect(parseBool(undefined, false)).toBe(false)
    expect(parseBool('', true)).toBe(true)
  })

  it('menganggap nilai lain sebagai true', () => {
    for (const value of ['true', '1', 'yes', 'on']) {
      expect(parseBool(value, false)).toBe(true)
    }
  })
})
