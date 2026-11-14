import { Elysia } from 'elysia'
import { assertApiKey } from '../../lib/env'
import {
  analyticsQuery,
  approveBody,
  boostBody,
  clipIdParams,
  clipListQuery,
  clipSourceQuery,
  distributeBody,
  distributionQuery,
  ingestBody,
  parseClipId,
  patchClipBody,
  renderBody,
  trackQuery,
} from './dto'
import {
  boostDistribution,
  deleteClip,
  deleteSource,
  distributeClip,
  getAnalyticsSummary,
  getClip,
  getDistribution,
  getSourceDetail,
  getSourceMedia,
  getClipMedia,
  ingestSource,
  listClips,
  listDistributions,
  listSources,
  patchClip,
  requestRender,
  requestTracking,
  retryDistribution,
  retrySource,
} from './service'
import { streamVideo } from './stream'

const tags = ['Clipping']

function requireWrite(headers: Record<string, string | undefined>): void {
  assertApiKey(headers)
}

/**
 * Modul clipping: orchestration HTTP untuk pipeline berat di Python worker.
 * Setiap endpoint tulis hanya menulis DB + publish job Redis Streams; proses
 * media/AI berjalan asinkron di `services/worker-ai/clipping/`.
 */
export const clippingRoutes = new Elysia({ prefix: '/clipping', tags })
  /* ── Sources ─────────────────────────────────────────────── */
  .get('/sources', ({ query }) => listSources(query), {
    query: clipSourceQuery,
    detail: { summary: 'Daftar sumber video yang pernah disubmit' },
  })
  .post(
    '/sources',
    async ({ body, headers, set }) => {
      requireWrite(headers as Record<string, string | undefined>)
      const source = await ingestSource(body)
      set.status = 202
      return source
    },
    {
      body: ingestBody,
      detail: { summary: 'Submit URL video sumber, memicu job `clip.ingest`' },
    },
  )
  .get(
    '/sources/:id',
    async ({ params, set }) => {
      const detail = await getSourceDetail(parseClipId(params.id))
      if (!detail) {
        set.status = 404
        return { error: 'Sumber klip tidak ditemukan.' }
      }
      return detail
    },
    {
      params: clipIdParams,
      detail: { summary: 'Status proses, transkrip, heatmap, dan daftar klip' },
    },
  )
  .post(
    '/sources/:id/retry',
    async ({ params, headers }) => {
      requireWrite(headers as Record<string, string | undefined>)
      return retrySource(parseClipId(params.id))
    },
    { params: clipIdParams, detail: { summary: 'Ulangi pipeline ingest untuk sumber gagal' } },
  )
  .delete(
    '/sources/:id',
    async ({ params, headers }) => {
      requireWrite(headers as Record<string, string | undefined>)
      return deleteSource(parseClipId(params.id))
    },
    { params: clipIdParams, detail: { summary: 'Hapus sumber beserta klip & distribusinya' } },
  )
  .get(
    '/sources/:id/video',
    async ({ params, request, set }) => {
      const media = await getSourceMedia(parseClipId(params.id))
      if (!media) {
        set.status = 404
        return { error: 'Video sumber belum tersedia atau belum diunduh.' }
      }
      return streamVideo(request, media, 'source')
    },
    {
      params: clipIdParams,
      detail: {
        summary: 'Stream video sumber asli (mendukung Range; ?download=1 untuk unduh)',
      },
    },
  )

  /* ── Clips ───────────────────────────────────────────────── */
  .get(
    '/clips',
    ({ query }) =>
      listClips({
        sourceId: query.sourceId,
        approvedOnly: query.approvedOnly === 'true',
        limit: query.limit,
        offset: query.offset,
      }),
    {
      query: clipListQuery,
      detail: { summary: 'Daftar klip hasil kurasi AI (opsional filter sumber)' },
    },
  )
  .get(
    '/clips/:id',
    async ({ params, set }) => {
      const clip = await getClip(parseClipId(params.id))
      if (!clip) {
        set.status = 404
        return { error: 'Klip tidak ditemukan.' }
      }
      return clip
    },
    { params: clipIdParams, detail: { summary: 'Detail satu klip' } },
  )
  .get(
    '/clips/:id/video',
    async ({ params, request, set }) => {
      const media = await getClipMedia(parseClipId(params.id))
      if (!media) {
        set.status = 404
        return { error: 'Berkas video belum tersedia. Render klip terlebih dahulu.' }
      }
      return streamVideo(request, media, 'clip')
    },
    {
      params: clipIdParams,
      detail: {
        summary: 'Stream video klip (mendukung Range; tambahkan ?download=1 untuk unduh)',
      },
    },
  )
  .patch(
    '/clips/:id',
    async ({ params, body, headers }) => {
      requireWrite(headers as Record<string, string | undefined>)
      return patchClip(parseClipId(params.id), body)
    },
    { params: clipIdParams, body: patchClipBody, detail: { summary: 'Ubah hook/timing/mode klip' } },
  )
  .delete(
    '/clips/:id',
    async ({ params, headers }) => {
      requireWrite(headers as Record<string, string | undefined>)
      return deleteClip(parseClipId(params.id))
    },
    { params: clipIdParams, detail: { summary: 'Hapus klip' } },
  )
  .post(
    '/clips/:id/render',
    async ({ params, body, headers }) => {
      requireWrite(headers as Record<string, string | undefined>)
      return requestRender(parseClipId(params.id), body ?? {})
    },
    {
      params: clipIdParams,
      body: renderBody,
      detail: { summary: 'Render klip: split_screen / face_reframe / blur_background' },
    },
  )
  .post(
    '/clips/:id/approve',
    async ({ params, body, headers }) => {
      requireWrite(headers as Record<string, string | undefined>)
      return patchClip(parseClipId(params.id), { isApproved: body.isApproved })
    },
    { params: clipIdParams, body: approveBody, detail: { summary: 'Setujui / tolak klip' } },
  )
  .post(
    '/clips/:id/distribute',
    async ({ params, body, headers, set }) => {
      requireWrite(headers as Record<string, string | undefined>)
      const result = await distributeClip(parseClipId(params.id), body)
      set.status = 202
      return result
    },
    {
      params: clipIdParams,
      body: distributeBody,
      detail: { summary: 'Jadwalkan distribusi multi-akun + viral trigger' },
    },
  )

  /* ── Distributions ───────────────────────────────────────── */
  .get('/distributions', ({ query }) => listDistributions(query), {
    query: distributionQuery,
    detail: { summary: 'Daftar distribusi beserta metrik & estimasi pendapatan' },
  })
  .get(
    '/distributions/:id',
    async ({ params, set }) => {
      const distribution = await getDistribution(parseClipId(params.id))
      if (!distribution) {
        set.status = 404
        return { error: 'Distribusi tidak ditemukan.' }
      }
      return distribution
    },
    { params: clipIdParams, detail: { summary: 'Detail satu distribusi' } },
  )
  .post(
    '/distributions/:id/boost',
    async ({ params, body, headers, set }) => {
      requireWrite(headers as Record<string, string | undefined>)
      const result = await boostDistribution(parseClipId(params.id), body ?? {})
      set.status = 202
      return result
    },
    {
      params: clipIdParams,
      body: boostBody,
      detail: { summary: 'Picu manual drip-feed boost (human-like trigger)' },
    },
  )
  .post(
    '/distributions/:id/retry',
    async ({ params, headers }) => {
      requireWrite(headers as Record<string, string | undefined>)
      return retryDistribution(parseClipId(params.id))
    },
    { params: clipIdParams, detail: { summary: 'Ulangi distribusi yang gagal' } },
  )
  .post(
    '/distributions/track',
    async ({ headers, query }) => {
      requireWrite(headers as Record<string, string | undefined>)
      return requestTracking(query.distributionId)
    },
    {
      query: trackQuery,
      detail: { summary: 'Paksa scrape metrik sekarang (cron: tiap 3 jam)' },
    },
  )

  /* ── Analytics ───────────────────────────────────────────── */
  .get('/analytics/summary', ({ query }) => getAnalyticsSummary(query), {
    query: analyticsQuery,
    detail: { summary: 'Agregasi views, retensi, dan estimasi payout CPM' },
  })
