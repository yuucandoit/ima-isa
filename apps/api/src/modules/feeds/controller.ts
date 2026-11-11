import { Elysia, t } from 'elysia'
import { getFeedBreakdown, getFeedById, listFeeds } from './service'
import { getKeywordQuery } from '../keywords/service'
import { sseHub } from '../../lib/sse'

const optionalUuid = t.Optional(t.String({ pattern: '^[0-9a-fA-F-]{36}$' }))
const optionalDate = t.Optional(t.String())

export const feedsRoutes = new Elysia({ prefix: '/feeds', tags: ['Feeds'] })
  .get(
    '/',
    async ({ query, set }) => {
      let keywordQuery: string | undefined
      if (query.keywordId) {
        const resolved = await getKeywordQuery(query.keywordId)
        if (!resolved) {
          set.status = 404
          return { error: 'Kata kunci tidak ditemukan atau tidak aktif.' }
        }
        keywordQuery = resolved
      }
      return listFeeds({ ...query, keywordQuery })
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        search: t.Optional(t.String()),
        sentiment: t.Optional(
          t.Union([t.Literal('POSITIVE'), t.Literal('NEUTRAL'), t.Literal('NEGATIVE')]),
        ),
        platform: t.Optional(
          t.Union([
            t.Literal('NEWS_MEDIA'),
            t.Literal('TWITTER_X'),
            t.Literal('YOUTUBE'),
            t.Literal('TIKTOK'),
            t.Literal('GOOGLE_TRENDS'),
          ]),
        ),
        sourceId: optionalUuid,
        keywordId: optionalUuid,
        from: optionalDate,
        to: optionalDate,
      }),
      detail: { summary: 'Daftar feed artikel dengan filter dan paginasi' },
    },
  )
  .get(
    '/breakdown',
    async ({ query, set }) => {
      let keywordQuery: string | undefined
      if (query.keywordId) {
        const resolved = await getKeywordQuery(query.keywordId)
        if (!resolved) {
          set.status = 404
          return { error: 'Kata kunci tidak ditemukan atau tidak aktif.' }
        }
        keywordQuery = resolved
      }
      return getFeedBreakdown({ ...query, keywordQuery })
    },
    {
      query: t.Object({
        search: t.Optional(t.String()),
        sourceId: optionalUuid,
        keywordId: optionalUuid,
        from: optionalDate,
        to: optionalDate,
      }),
      detail: { summary: 'Breakdown sentimen untuk filter aktif' },
    },
  )
  .get(
    '/stream',
    ({ request, query }) => {
      const topics = (query.topics ?? 'media,alerts,clusters,overview')
        .split(',')
        .map((topic) => topic.trim())
        .filter(Boolean)
      return sseHub.subscribe(request, topics)
    },
    {
      query: t.Object({ topics: t.Optional(t.String()) }),
      detail: { summary: 'Server-Sent Events: media, alert, cluster' },
    },
  )
  .get(
    '/:id',
    async ({ params, set }) => {
      const item = await getFeedById(params.id)
      if (!item) {
        set.status = 404
        return { error: 'Artikel tidak ditemukan.' }
      }
      return item
    },
    {
      params: t.Object({ id: t.String({ pattern: '^[0-9a-fA-F-]{36}$' }) }),
      detail: { summary: 'Detail artikel' },
    },
  )
