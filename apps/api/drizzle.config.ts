import { defineConfig } from 'drizzle-kit'

// drizzle-kit dijalankan dari `apps/api`, jadi muat `.env` root secara eksplisit.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url).pathname)
} catch {
  /* .env opsional: fallback ke default di bawah */
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/media_intel',
  },
  verbose: true,
  strict: true,
})
