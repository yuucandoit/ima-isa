import { Elysia, t } from 'elysia'
import { getFigureTrending, getSocialTrending } from './service'

export const trendingRoutes = new Elysia({ prefix: '/trending', tags: ['Trending'] })
  .get(
    '/social',
    ({ query }) =>
      getSocialTrending({
        window: query.window,
        limit: query.limit,
      }),
    {
      query: t.Object({
        window: t.Optional(t.Union([t.Literal('24h'), t.Literal('7d')])),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
      }),
      detail: {
        summary: 'Trending sosial: X Trends API + hashtag dari post ter-ingest',
      },
    },
  )
  .get(
    '/figures',
    ({ query }) =>
      getFigureTrending({
        period: query.period,
        limit: query.limit,
        sourceId: query.sourceId,
        platform: query.platform,
      }),
    {
      query: t.Object({
        period: t.Optional(
          t.Union([
            t.Literal('daily'),
            t.Literal('weekly'),
            t.Literal('monthly'),
            t.Literal('yearly'),
          ]),
        ),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        sourceId: t.Optional(t.String({ pattern: '^[0-9a-fA-F-]{36}$' })),
        platform: t.Optional(
          t.Union([
            t.Literal('NEWS_MEDIA'),
            t.Literal('TWITTER_X'),
            t.Literal('YOUTUBE'),
            t.Literal('TIKTOK'),
          ]),
        ),
      }),
      detail: {
        summary: 'Tokoh paling banyak disebut (harian/mingguan/bulanan/tahunan)',
      },
    },
  )
