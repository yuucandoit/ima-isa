import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Muat `.env` tanpa dependensi tambahan.
 *
 * `bun run --cwd apps/api …` menjalankan proses dengan cwd `apps/api`, sehingga
 * Bun TIDAK menemukan `.env` di root repo. Akibatnya `LLM_URL`, `LLM_API_KEY`,
 * dan `TELEGRAM_*` diam-diam kosong: briefing selalu jatuh ke fallback
 * ekstraktif dan notifikasi tidak pernah terkirim, tanpa pesan yang jelas.
 *
 * Urutan prioritas (yang pertama menang — `loadEnvFile` tidak menimpa variabel
 * yang sudah ada):
 *   1. environment proses (systemd `EnvironmentFile`, docker compose, shell)
 *   2. `apps/api/.env`
 *   3. `.env` root repo
 *
 * Modul ini harus diimpor paling awal, sebelum `db/index.ts` mengevaluasi
 * `DATABASE_URL` saat modul dimuat.
 */
const HERE = dirname(fileURLToPath(import.meta.url))

const CANDIDATES = [
  resolve(HERE, '../../.env'), // apps/api/.env
  resolve(HERE, '../../../../.env'), // <repo>/.env
]

let loadedFile: string | null = null

for (const candidate of CANDIDATES) {
  if (!existsSync(candidate)) continue
  try {
    process.loadEnvFile(candidate)
    loadedFile = candidate
    break
  } catch (error) {
    console.warn(
      `[env] gagal memuat ${candidate}:`,
      error instanceof Error ? error.message : error,
    )
  }
}

/** Path `.env` yang dipakai, atau `null` bila konfigurasi hanya dari process env. */
export const loadedEnvFile = loadedFile

export function envSourceHint(): string {
  return loadedFile ? `file ${loadedFile}` : 'process environment'
}
