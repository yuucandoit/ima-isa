import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/media_intel'

/**
 * Single postgres-js pool shared by every API module.
 * `prepare: false` keeps compatibility with transaction poolers (PgBouncer).
 */
export const sqlClient = postgres(DATABASE_URL, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
  onnotice: () => {},
})

export const db = drizzle(sqlClient, { schema })
export { schema }
export type Database = typeof db

export async function checkDatabase(): Promise<boolean> {
  try {
    await sqlClient`SELECT 1`
    return true
  } catch {
    return false
  }
}
