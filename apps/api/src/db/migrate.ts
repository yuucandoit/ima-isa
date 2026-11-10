import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { DATABASE_URL } from './index'

const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} })

console.log('▸ Memastikan ekstensi pgvector tersedia…')
await sql`CREATE EXTENSION IF NOT EXISTS vector`
await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`

console.log('▸ Menjalankan migrasi Drizzle…')
await migrate(drizzle(sql), { migrationsFolder: './drizzle' })
console.log('✓ Migrasi selesai.')
await sql.end()
