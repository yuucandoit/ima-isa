import { statSync } from 'node:fs'
import { downloadName, parseRange, videoMimeType } from './media'

/**
 * Stream berkas video dengan dukungan HTTP Range.
 *
 * Kenapa bukan `Bun.file()` langsung: `Bun.file()` membalas 200 penuh tanpa
 * menghormati `Range`, sehingga browser tidak bisa seek dan Safari menolak
 * memutar video. Handler ini membalas `206 Partial Content` sesuai RFC 9110.
 */
export function streamVideo(
  request: Request,
  file: { path: string; title: string; id: number },
  kind: 'clip' | 'source',
): Response {
  const size = statSync(file.path).size
  const mime = videoMimeType(file.path)
  const name = downloadName(`${kind}-${file.id}`, file.title, file.path)

  const headers = new Headers({
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    // `inline` agar browser memutar di tempat; nama file tetap disediakan.
    'Content-Disposition': `inline; filename="${name}"`,
    // Artefak render bisa ditimpa saat re-render dengan id yang sama.
    'Cache-Control': 'private, no-cache',
  })

  // `?download=1` memaksa unduhan alih-alih diputar.
  const download = new URL(request.url).searchParams.get('download') === '1'
  if (download) headers.set('Content-Disposition', `attachment; filename="${name}"`)

  const range = parseRange(request.headers.get('range'), size)

  if (range === 'invalid') {
    headers.set('Content-Range', `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }

  if (!range) {
    headers.set('Content-Length', String(size))
    if (download) return new Response(Bun.file(file.path), { status: 200, headers })
    return new Response(Bun.file(file.path), { status: 200, headers })
  }

  const { start, end } = range
  const length = end - start + 1
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  headers.set('Content-Length', String(length))

  return new Response(Bun.file(file.path).slice(start, end + 1), {
    status: 206,
    headers,
  })
}
