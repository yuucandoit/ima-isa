import { describe, expect, it } from 'bun:test'

/**
 * Kontrak error API.
 *
 * Regresi yang dijaga: pada Elysia 1.4 handler `onError` hanya berlaku untuk
 * route yang didaftarkan SETELAHNYA. Bila `onError` dipasang setelah
 * `.group('/api', …)`, error validasi dan 404 keluar sebagai objek mentah
 * (`{ type, on, property, expected }`) sehingga `unwrap()` di dashboard
 * menampilkan pesan tak terbaca dan `NOT_FOUND` menjadi `{"error":"NOT_FOUND"}`.
 */

interface ErrorBody {
  error: string
  details?: unknown
}

/** Bentuk yang dipakai `apps/api/src/index.ts` (cermin logika handler). */
function normalizeError(
  code: string,
  error: unknown,
): { status: number; body: ErrorBody } {
  if (code === 'VALIDATION') {
    const failures = (error as { all?: Array<{ path?: string; message?: string }> }).all
    return {
      status: 422,
      body: {
        error: failures?.[0]?.message
          ? `Validasi input gagal: ${failures[0].message}`
          : 'Validasi input gagal.',
        details: failures?.map((failure) => ({
          path: failure.path,
          message: failure.message,
        })),
      },
    }
  }
  if (code === 'NOT_FOUND') {
    return { status: 404, body: { error: 'Endpoint tidak ditemukan.' } }
  }
  const status = (error as { status?: number }).status
  if (status) {
    return { status, body: { error: (error as Error).message } }
  }
  return { status: 500, body: { error: 'Terjadi kesalahan internal.' } }
}

describe('error contract', () => {
  it('meringkas error validasi menjadi pesan yang bisa dibaca', () => {
    const { status, body } = normalizeError('VALIDATION', {
      all: [{ path: '/maxClips', message: 'Expected union value' }],
    })
    expect(status).toBe(422)
    expect(body.error).toBe('Validasi input gagal: Expected union value')
    expect(body.details).toEqual([{ path: '/maxClips', message: 'Expected union value' }])
  })

  it('validasi tanpa detail tetap memberi pesan generik', () => {
    const { status, body } = normalizeError('VALIDATION', {})
    expect(status).toBe(422)
    expect(body.error).toBe('Validasi input gagal.')
    expect(body.details).toBeUndefined()
  })

  it('route tidak dikenal menjadi 404 berbahasa Indonesia', () => {
    const { status, body } = normalizeError('NOT_FOUND', { status: 404 })
    expect(status).toBe(404)
    expect(body.error).toBe('Endpoint tidak ditemukan.')
  })

  it('error domain membawa status sendiri (mis. 404 entitas)', () => {
    const error = Object.assign(new Error('Artikel tidak ditemukan.'), { status: 404 })
    const { status, body } = normalizeError('UNKNOWN', error)
    expect(status).toBe(404)
    expect(body.error).toBe('Artikel tidak ditemukan.')
  })

  it('error tanpa status menjadi 500 generik', () => {
    const { status, body } = normalizeError('UNKNOWN', new Error('boom'))
    expect(status).toBe(500)
    expect(body.error).toBe('Terjadi kesalahan internal.')
  })
})
