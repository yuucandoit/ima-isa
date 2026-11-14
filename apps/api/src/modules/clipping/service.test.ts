import { describe, expect, test } from 'bun:test'
import { detectPlatform, normalizeSourceUrl } from './service'

describe('detectPlatform', () => {
  test('mengenali platform utama', () => {
    expect(detectPlatform('https://www.youtube.com/watch?v=abc')).toBe('youtube')
    expect(detectPlatform('https://youtu.be/abc')).toBe('youtube')
    expect(detectPlatform('https://www.tiktok.com/@a/video/1')).toBe('tiktok')
    expect(detectPlatform('https://instagram.com/reel/xyz')).toBe('instagram')
    expect(detectPlatform('https://x.com/user/status/1')).toBe('twitter')
    expect(detectPlatform('https://twitter.com/user/status/1')).toBe('twitter')
  })

  test('mengembalikan other untuk host tak dikenal', () => {
    expect(detectPlatform('https://example.com/video')).toBe('other')
  })
})

describe('normalizeSourceUrl', () => {
  test('menerima URL YouTube dan membuang hash', () => {
    const result = normalizeSourceUrl('https://www.youtube.com/watch?v=abc123#t=30')
    expect(result.platform).toBe('youtube')
    expect(result.url).not.toContain('#')
  })

  test('menerima URL TikTok', () => {
    expect(normalizeSourceUrl('https://www.tiktok.com/@a/video/123').platform).toBe('tiktok')
  })

  test('menolak skema non-http', () => {
    expect(() => normalizeSourceUrl('file:///etc/passwd')).toThrow(/http/)
    expect(() => normalizeSourceUrl('javascript:alert(1)')).toThrow()
  })

  test('menolak URL tidak valid', () => {
    expect(() => normalizeSourceUrl('bukan url')).toThrow(/valid/)
  })

  test('menolak platform yang belum didukung', () => {
    expect(() => normalizeSourceUrl('https://vimeo.com/12345')).toThrow(/Platform/)
    expect(() => normalizeSourceUrl('http://169.254.169.254/latest/meta-data')).toThrow(/Platform/)
  })

  test('menormalkan spasi di awal/akhir', () => {
    expect(normalizeSourceUrl('  https://youtu.be/abc  ').url).toBe('https://youtu.be/abc')
  })
})
