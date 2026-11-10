import { Elysia } from 'elysia'
import { getSystemStatus } from './service'

export const systemRoutes = new Elysia({ prefix: '/system', tags: ['System'] }).get(
  '/status',
  () => getSystemStatus(),
  { detail: { summary: 'Status database, Redis, Ollama, dan pipeline worker' } },
)
