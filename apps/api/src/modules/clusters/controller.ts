import { Elysia, t } from 'elysia'
import {
  getClusterDetail,
  listClusters,
  queueRecluster,
  summarizeCluster,
} from './service'
import { rebuildClusters } from './clustering'
import { assertApiKey } from '../../lib/env'

const uuid = t.Object({ id: t.String({ pattern: '^[0-9a-fA-F-]{36}$' }) })

export const clustersRoutes = new Elysia({ prefix: '/clusters', tags: ['Clusters'] })
  .get(
    '/',
    ({ query }) => listClusters(query.limit ?? 20, query.minArticles ?? 5),
    {
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        minArticles: t.Optional(t.Numeric({ minimum: 2, maximum: 50 })),
      }),
      detail: { summary: 'Daftar klaster isu hasil semantic clustering' },
    },
  )
  .post(
    '/rebuild',
    async ({ headers, body }) => {
      assertApiKey(headers as Record<string, string | undefined>)
      const result = await rebuildClusters(body ?? {})
      return { ...result, queuedForWorker: await queueRecluster() }
    },
    {
      body: t.Optional(
        t.Object({
          windowHours: t.Optional(t.Numeric({ minimum: 1, maximum: 168 })),
          distanceThreshold: t.Optional(t.Numeric({ minimum: 0.01, maximum: 1 })),
          minItems: t.Optional(t.Numeric({ minimum: 2, maximum: 50 })),
          maxSpanHours: t.Optional(t.Numeric({ minimum: 1, maximum: 72 })),
        }),
      ),
      detail: { summary: 'Jalankan klasterisasi inkremental (admin)' },
    },
  )
  .get(
    '/:id',
    async ({ params, set }) => {
      const detail = await getClusterDetail(params.id)
      if (!detail) {
        set.status = 404
        return { error: 'Klaster tidak ditemukan.' }
      }
      return detail
    },
    { params: uuid, detail: { summary: 'Detail klaster beserta artikel anggota' } },
  )
  .post(
    '/:id/summarize',
    async ({ params, body, set }) => {
      const result = await summarizeCluster(params.id, body?.refresh ?? false)
      if (!result) {
        set.status = 404
        return { error: 'Klaster tidak ditemukan.' }
      }
      return { clusterId: params.id, ...result }
    },
    {
      params: uuid,
      body: t.Optional(t.Object({ refresh: t.Optional(t.Boolean()) })),
      detail: { summary: 'Buat executive briefing via Ollama / local LLM' },
    },
  )
