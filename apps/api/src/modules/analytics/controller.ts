import { Elysia, t } from 'elysia'
import { getLocationAnalytics, getOverview } from './service'
import { getKeywordQuery } from '../keywords/service'

const optionalUuid = t.Optional(t.String({ pattern: '^[0-9a-fA-F-]{36}$' }))

export const analyticsRoutes = new Elysia({ prefix: '/analytics', tags: ['Analytics'] })
  .get(
    '/locations',
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
      return getLocationAnalytics({ ...query, keywordQuery })
    },
    {
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        keywordId: optionalUuid,
        sourceId: optionalUuid,
        platform: t.Optional(
          t.Union([
            t.Literal('NEWS_MEDIA'),
            t.Literal('TWITTER_X'),
            t.Literal('YOUTUBE'),
            t.Literal('TIKTOK'),
          ]),
        ),
      }),
      detail: { summary: 'Agregasi sebaran lokasi pemberitaan + koordinat peta' },
    },
  )
  .get(
  '/overview',
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
    return getOverview({ ...query, keywordQuery })
  },
  {
    query: t.Object({
      from: t.Optional(t.String()),
      to: t.Optional(t.String()),
      keywordId: optionalUuid,
      sourceId: optionalUuid,
      platform: t.Optional(
        t.Union([
          t.Literal('NEWS_MEDIA'),
          t.Literal('TWITTER_X'),
          t.Literal('YOUTUBE'),
          t.Literal('TIKTOK'),
        ]),
      ),
      bucket: t.Optional(t.Union([t.Literal('hour'), t.Literal('day')])),
    }),
    detail: { summary: 'Agregasi tren sentimen, share of voice, entitas, dan heatmap' },
  },
)
