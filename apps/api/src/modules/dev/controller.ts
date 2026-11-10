import { Elysia, t } from 'elysia'
import { env } from '../../lib/env'
import { seedDemoData } from './service'

export const devRoutes = new Elysia({ prefix: '/dev', tags: ['Dev'] }).post(
  '/seed',
  async ({ query, set }) => {
    if (!env.isDev) {
      set.status = 403
      return { error: 'Endpoint demo dinonaktifkan di production.' }
    }
    const result = await seedDemoData({
      generateAlerts: query.generateAlerts !== 'false',
    })
    return {
      success: true,
      message: `Seed demo selesai: ${result.inserted} artikel baru.`,
      ...result,
    }
  },
  {
    query: t.Object({ generateAlerts: t.Optional(t.String()) }),
    detail: { summary: 'Seed data demo lintas topik untuk dashboard (dev only)' },
  },
)
