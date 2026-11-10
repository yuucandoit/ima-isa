import { Elysia, t } from 'elysia'
import { listSources, setSourceActive } from './service'
import { assertApiKey } from '../../lib/env'

export const sourcesRoutes = new Elysia({ prefix: '/sources', tags: ['Sources'] })
  .get('/', () => listSources(), {
    detail: { summary: 'Daftar sumber media dan jumlah artikel' },
  })
  .patch(
    '/:id',
    async ({ params, body, headers, set }) => {
      assertApiKey(headers as Record<string, string | undefined>)
      const source = await setSourceActive(params.id, body.isActive)
      if (!source) {
        set.status = 404
        return { error: 'Sumber tidak ditemukan.' }
      }
      return source
    },
    {
      params: t.Object({ id: t.String({ pattern: '^[0-9a-fA-F-]{36}$' }) }),
      body: t.Object({ isActive: t.Boolean() }),
      detail: { summary: 'Aktifkan / nonaktifkan sumber (admin)' },
    },
  )
