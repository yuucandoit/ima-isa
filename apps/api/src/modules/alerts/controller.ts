import { Elysia, t } from 'elysia'
import { listAlerts, scanForSpikes, setAlertResolved } from './service'
import { assertApiKey } from '../../lib/env'
import { sseHub } from '../../lib/sse'
import { notificationChannels } from '../../lib/notify'

const uuid = t.Object({ id: t.String({ pattern: '^[0-9a-fA-F-]{36}$' }) })

export const alertsRoutes = new Elysia({ prefix: '/alerts', tags: ['Alerts'] })
  .get(
    '/',
    ({ query }) =>
      listAlerts({
        page: query.page,
        limit: query.limit,
        severity: query.severity,
        keywordId: query.keywordId,
        resolved:
          query.resolved === undefined ? undefined : query.resolved === 'true',
      }),
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        severity: t.Optional(
          t.Union([
            t.Literal('LOW'),
            t.Literal('MEDIUM'),
            t.Literal('HIGH'),
            t.Literal('CRITICAL'),
          ]),
        ),
        keywordId: t.Optional(t.String({ pattern: '^[0-9a-fA-F-]{36}$' })),
        resolved: t.Optional(t.String()),
      }),
      detail: { summary: 'Daftar peringatan krisis' },
    },
  )
  .get(
    '/channels',
    () => notificationChannels(),
    { detail: { summary: 'Status kanal notifikasi yang aktif' } },
  )
  .get(
    '/stream',
    ({ request }) => sseHub.subscribe(request, ['alerts']),
    { detail: { summary: 'SSE stream untuk peringatan baru' } },
  )
  .post(
    '/scan',
    async ({ headers }) => {
      assertApiKey(headers as Record<string, string | undefined>)
      return scanForSpikes()
    },
    { detail: { summary: 'Jalankan deteksi lonjakan secara manual (admin)' } },
  )
  .patch(
    '/:id/resolve',
    async ({ params, body, set }) => {
      const alert = await setAlertResolved(params.id, body.isResolved)
      if (!alert) {
        set.status = 404
        return { error: 'Peringatan tidak ditemukan.' }
      }
      return alert
    },
    {
      params: uuid,
      body: t.Object({ isResolved: t.Boolean() }),
      detail: { summary: 'Tandai peringatan selesai / aktif kembali' },
    },
  )
