import { Elysia, t } from 'elysia'
import { markTrendInterest } from '../../lib/redis'
import { MAX_TRENDING_LIMIT, getFigureTrending, getSocialTrending } from './service'

export const trendingRoutes = new Elysia({ prefix: '/trending', tags: ['Trending'] })
  .get(
    '/social',
    async ({ query }) => {
      const result = await getSocialTrending({
        window: query.window,
        limit: query.limit,
        platform: query.platform,
        sort: query.sort,
        hours: query.hours,
      })
      // Beri sinyal ke worker bahwa ada penonton (hemat bandwidth scrape).
      for (const platform of ['google', 'tiktok', 'x']) {
        markTrendInterest(platform)
      }
      return result
    },
    {
      query: t.Object({
        window: t.Optional(t.Union([t.Literal('24h'), t.Literal('7d')])),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: MAX_TRENDING_LIMIT })),
        platform: t.Optional(
          t.Union([
            t.Literal('TWITTER_X'),
            t.Literal('TIKTOK'),
            t.Literal('GOOGLE_TRENDS'),
          ]),
        ),
        sort: t.Optional(t.Union([t.Literal('volume'), t.Literal('rank')])),
        hours: t.Optional(t.Numeric({ minimum: 4, maximum: 168 })),
      }),
      detail: {
        summary:
          'Trending: X, TikTok, Google Trends + hashtag dari post ter-ingest '
          + '(default urut volume: approx_traffic Google, tayangan TikTok, sebutan hashtag)',
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
            t.Literal('GOOGLE_TRENDS'),
          ]),
        ),
      }),
      detail: {
        summary: 'Tokoh paling banyak disebut (harian/mingguan/bulanan/tahunan)',
      },
    },
  )
