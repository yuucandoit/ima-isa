import { existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ClipSourceStatus } from '@media-intel/types'

/**
 * Penyajian berkas media (video sumber & klip hasil render) ke browser.
 *
 * Worker Python menulis artefak ke `CLIP_WORK_DIR` (default
 * `services/worker-ai/storage/clipping`), sedangkan kolom
 * `clip_sources.raw_file_path` / `generated_clips.output_file_path` menyimpan
 * path **absolut di disk server**. Path itu tidak bisa dibuka browser, jadi API
 * harus men-stream berkasnya. Semua akses lewat resolver di bawah agar:
 *   - path relatif terhadap cwd API maupun absolut dua-duanya dikenali;
 *   - `..` tidak bisa keluar dari direktori kerja (path traversal);
 *   - klip yang belum dirender menghasilkan 404 yang jelas, bukan 500.
 */

/**
 * Folder kerja worker.
 *
 * Nilai `.env` (`CLIP_WORK_DIR=storage/clipping`) bersifat **relatif terhadap
 * cwd worker** (`services/worker-ai`), bukan terhadap repo maupun cwd API. Jadi
 * path relatif dicoba terhadap beberapa akar yang masuk akal agar API dan worker
 * selalu menunjuk folder yang sama.
 */
const HERE = dirname(fileURLToPath(import.meta.url))

function workDirCandidates(): string[] {
  const configured = process.env.CLIP_WORK_DIR?.trim() || 'storage/clipping'
  if (isAbsolute(configured)) return [resolve(configured)]

  return [
    // cwd API (apps/api) — bila dijalankan dengan path absolut/relatif repo
    resolve(configured),
    // <repo>/services/worker-ai/<configured> — lokasi sebenarnya artefak worker
    resolve(HERE, '../../../../../services/worker-ai', configured),
    // <repo>/<configured>
    resolve(HERE, '../../../../../', configured),
  ]
}

/** Direktori kerja pertama yang benar-benar ada (fallback: kandidat pertama). */
function resolveWorkDir(): string {
  const candidates = workDirCandidates()
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]!
}

export const CLIP_WORK_DIR = resolveWorkDir()

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v'])

export function isVideoPath(path: string): boolean {
  const lowered = path.toLowerCase()
  return [...VIDEO_EXTENSIONS].some((extension) => lowered.endsWith(extension))
}

/**
 * Ubah path tersimpan menjadi path absolut yang aman.
 *
 * Path absolut dipakai apa adanya *hanya bila* berada di dalam direktori kerja;
 * path relatif dicoba terhadap cwd API, lalu terhadap direktori kerja.
 */
export function resolveMediaPath(rawPath: string): string | null {
  const trimmed = rawPath?.trim()
  if (!trimmed) return null

  const roots = [CLIP_WORK_DIR, ...workDirCandidates()]
  const candidates = isAbsolute(trimmed)
    ? [trimmed]
    : roots.map((root) => join(root, trimmed))

  for (const candidate of candidates) {
    const normalized = resolve(candidate)
    if (!existsSync(normalized) || !statSync(normalized).isFile()) continue
    // Tolak path yang keluar dari direktori kerja (mis. berisi `..`).
    const inside = roots.some((root) => {
      const relativePath = relative(resolve(root), normalized)
      return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath)
    })
    if (!inside) continue
    return normalized
  }
  return null
}

/** Nama unduhan yang ramah: `clip-12-<slug>.mp4` alih-alih path panjang. */
export function downloadName(prefix: string, label: string, path: string): string {
  const extension = path.slice(path.lastIndexOf('.')) || '.mp4'
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug ? `${prefix}-${slug}${extension}` : `${prefix}${extension}`
}

/** Tebak MIME dari ekstensi; cukup untuk `<video>` dan unduhan. */
export function videoMimeType(path: string): string {
  if (path.toLowerCase().endsWith('.webm')) return 'video/webm'
  if (path.toLowerCase().endsWith('.mkv')) return 'video/x-matroska'
  if (path.toLowerCase().endsWith('.mov')) return 'video/quicktime'
  return 'video/mp4'
}

export interface ParsedRange {
  start: number
  end: number
}

/**
 * Parse header `Range` (RFC 9110) menjadi batas byte.
 *
 * Streaming video butuh ini: tanpa dukungan Range, browser tidak bisa seek dan
 * Safari menolak memutar berkas besar sama sekali.
 */
export function parseRange(
  header: string | null,
  size: number,
): ParsedRange | 'invalid' | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return 'invalid'

  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return 'invalid'

  let start: number
  let end: number

  if (rawStart === '') {
    // `bytes=-500` → 500 byte terakhir.
    const suffixLength = Number(rawEnd)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return 'invalid'
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return 'invalid'
  }
  return { start, end: Math.min(end, size - 1) }
}

/** Status sumber yang sudah tidak akan berubah lagi. */
export function isTerminalStatus(status: ClipSourceStatus | string): boolean {
  return status === 'completed' || status === 'failed'
}

