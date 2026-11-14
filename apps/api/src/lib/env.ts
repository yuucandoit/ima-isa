import { parseBool } from './auth-helpers'

export const env = {
  port: Number(process.env.PORT ?? 3001),
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  apiKey: process.env.API_KEY?.trim() || null,
  /**
   * Apakah dashboard wajib login. Default aktif; set `AUTH_REQUIRED=false`
   * hanya untuk eksperimen lokal. Otomasi tetap bisa memakai `x-api-key`.
   */
  authRequired: parseBool(process.env.AUTH_REQUIRED, true),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  /** URL LLM eksternal (OpenAI-compatible). Kosong = briefing memakai fallback ekstraktif. */
  llmUrl: process.env.LLM_URL?.trim() || null,
  llmApiKey: process.env.LLM_API_KEY?.trim() || null,
  llmModel: process.env.LLM_MODEL?.trim() || '',
  llmProvider: (process.env.LLM_PROVIDER ?? 'auto').trim().toLowerCase(),
  llmAuthHeader: process.env.LLM_AUTH_HEADER?.trim() || 'Authorization',
  llmAuthPrefix: process.env.LLM_AUTH_PREFIX ?? 'Bearer',
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 60_000),
  llmMaxTokens: Number(process.env.LLM_MAX_TOKENS ?? 2000),
  alertScanEnabled: (process.env.ALERT_SCAN_ENABLED ?? 'true') !== 'false',
  alertScanIntervalMs: Number(process.env.ALERT_SCAN_INTERVAL_MS ?? 300_000),
  alertVolumeMultiplier: Number(process.env.ALERT_VOLUME_MULTIPLIER ?? 2.5),
  alertNegativeRatio: Number(process.env.ALERT_NEGATIVE_RATIO ?? 0.65),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || null,
  telegramChatId: process.env.TELEGRAM_CHAT_ID?.trim() || null,
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL?.trim() || null,
  workerGroup: process.env.CONSUMER_GROUP ?? 'ai-workers',
  webDist: process.env.WEB_DIST?.trim() || null,
  isDev: (process.env.NODE_ENV ?? 'development') !== 'production',
} as const

export function assertApiKey(headers: Record<string, string | undefined>): void {
  if (!env.apiKey) return
  const provided = headers['x-api-key']
  if (provided !== env.apiKey) {
    throw Object.assign(new Error('API key tidak valid.'), { status: 401 })
  }
}
