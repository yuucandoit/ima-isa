import { Elysia, t } from 'elysia'
import {
  createKeyword,
  deleteKeyword,
  getKeywordRow,
  listKeywords,
  updateKeyword,
} from './service'
import { assertApiKey } from '../../lib/env'
import { collectTerms, tryParseBooleanQuery } from '../../lib/boolean'

const uuid = t.Object({ id: t.String({ pattern: '^[0-9a-fA-F-]{36}$' }) })

const keywordBody = t.Object({
  label: t.String({ minLength: 1, maxLength: 100 }),
  booleanQuery: t.String({ minLength: 1, maxLength: 1000 }),
  isActive: t.Optional(t.Boolean()),
})

export const keywordsRoutes = new Elysia({ prefix: '/keywords', tags: ['Keywords'] })
  .get(
    '/',
    ({ query }) => listKeywords(query.withMatches === 'true'),
    {
      query: t.Object({ withMatches: t.Optional(t.String()) }),
      detail: { summary: 'Daftar kata kunci pantauan' },
    },
  )
  .post(
    '/validate',
    ({ body }) => {
      const parsed = tryParseBooleanQuery(body.query)
      if (!parsed.ok) return { ok: false, error: parsed.error, terms: [] }
      return { ok: true, error: null, terms: collectTerms(parsed.ast) }
    },
    {
      body: t.Object({ query: t.String({ minLength: 1 }) }),
      detail: { summary: 'Validasi sintaks Boolean query' },
    },
  )
  .post(
    '/',
    async ({ body, headers, set }) => {
      assertApiKey(headers as Record<string, string | undefined>)
      const parsed = tryParseBooleanQuery(body.booleanQuery)
      if (!parsed.ok) {
        set.status = 422
        return { error: `Query Boolean tidak valid: ${parsed.error}` }
      }
      return createKeyword(body)
    },
    { body: keywordBody, detail: { summary: 'Buat kata kunci pantauan' } },
  )
  .get(
    '/:id',
    async ({ params, set }) => {
      const keyword = await getKeywordRow(params.id)
      if (!keyword) {
        set.status = 404
        return { error: 'Kata kunci tidak ditemukan.' }
      }
      return keyword
    },
    { params: uuid },
  )
  .patch(
    '/:id',
    async ({ params, body, headers, set }) => {
      assertApiKey(headers as Record<string, string | undefined>)
      if (body.booleanQuery) {
        const parsed = tryParseBooleanQuery(body.booleanQuery)
        if (!parsed.ok) {
          set.status = 422
          return { error: `Query Boolean tidak valid: ${parsed.error}` }
        }
      }
      const keyword = await updateKeyword(params.id, body)
      if (!keyword) {
        set.status = 404
        return { error: 'Kata kunci tidak ditemukan.' }
      }
      return keyword
    },
    {
      params: uuid,
      body: t.Partial(keywordBody),
      detail: { summary: 'Perbarui kata kunci pantauan' },
    },
  )
  .delete(
    '/:id',
    async ({ params, headers, set }) => {
      assertApiKey(headers as Record<string, string | undefined>)
      const deleted = await deleteKeyword(params.id)
      if (!deleted) {
        set.status = 404
        return { error: 'Kata kunci tidak ditemukan.' }
      }
      return { success: true }
    },
    { params: uuid, detail: { summary: 'Hapus kata kunci pantauan' } },
  )
