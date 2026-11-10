import { env } from './env'

/**
 * Gateway LLM eksternal (OpenAI-compatible).
 *
 * Ollama lokal tidak lagi dipakai sebagai default karena berat untuk laptop.
 * `LLM_URL` menerima URL penuh `/chat/completions`, base `/v1`, atau (untuk
 * kompatibilitas) endpoint Ollama bila suatu saat diperlukan.
 */
export type LlmProvider = 'openai' | 'ollama' | 'none'

export interface ResolvedLlm {
  provider: LlmProvider
  /** Endpoint chat lengkap siap di-POST (kosong bila belum dikonfigurasi). */
  chatUrl: string
  /** Base URL untuk health check (`/models` atau `/api/tags`). */
  rootUrl: string
  model: string
}

export interface LlmConfigInput {
  url?: string | null
  model?: string | null
  provider?: string | null
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function openAiBase(raw: string): string {
  // `.../v1`, `.../provider/v1`, `.../openai/v1` → pakai apa adanya.
  return /\/v\d+(\/|$)/i.test(raw) ? raw : `${raw}/v1`
}

const DISABLED: ResolvedLlm = { provider: 'none', chatUrl: '', rootUrl: '', model: '' }

/**
 * Terima URL apa pun dari `.env`:
 *   - full OpenAI-compatible : https://api.commandcode.ai/provider/v1/chat/completions
 *   - base OpenAI            : https://api.commandcode.ai/provider/v1
 *   - full Ollama (opsional) : http://localhost:11434/api/chat
 *   - base Ollama (opsional) : http://localhost:11434
 */
export function resolveLlm(overrides: LlmConfigInput = {}): ResolvedLlm {
  const configured = stripTrailingSlash(
    overrides.url !== undefined
      ? (overrides.url ?? '').trim()
      : env.llmUrl?.trim() || '',
  )
  const model =
    overrides.model !== undefined
      ? (overrides.model ?? '').trim()
      : env.llmModel?.trim() || ''
  if (!configured) return { ...DISABLED, model }

  const explicit = (overrides.provider ?? env.llmProvider ?? 'auto').toLowerCase()
  const lower = configured.toLowerCase()

  if (lower.endsWith('/chat/completions')) {
    return {
      provider: 'openai',
      chatUrl: configured,
      rootUrl: configured.slice(0, -'/chat/completions'.length),
      model,
    }
  }

  if (lower.endsWith('/api/chat')) {
    return {
      provider: 'ollama',
      chatUrl: configured,
      rootUrl: configured.slice(0, -'/api/chat'.length),
      model,
    }
  }

  if (lower.endsWith('/v1')) {
    return {
      provider: 'openai',
      chatUrl: `${configured}/chat/completions`,
      rootUrl: configured,
      model,
    }
  }

  if (lower.endsWith('/api')) {
    return {
      provider: 'ollama',
      chatUrl: `${configured}/chat`,
      rootUrl: configured,
      model,
    }
  }

  if (explicit === 'openai' || explicit === 'ollama') {
    if (explicit === 'openai') {
      const base = openAiBase(configured)
      return {
        provider: 'openai',
        chatUrl: `${base}/chat/completions`,
        rootUrl: base,
        model,
      }
    }
    return {
      provider: 'ollama',
      chatUrl: `${configured}/api/chat`,
      rootUrl: configured,
      model,
    }
  }

  // Auto-detect pola URL yang umum.
  if (/\/(v\d+|openai)(\/|$)/i.test(lower) || lower.includes('openai') || lower.includes('commandcode')) {
    const base = openAiBase(configured)
    return {
      provider: 'openai',
      chatUrl: `${base}/chat/completions`,
      rootUrl: base,
      model,
    }
  }

  // Default aman untuk URL tanpa pola: anggap OpenAI-compatible.
  const base = openAiBase(configured)
  return {
    provider: 'openai',
    chatUrl: `${base}/chat/completions`,
    rootUrl: base,
    model,
  }
}

export function isLlmConfigured(): boolean {
  return Boolean(env.llmUrl && env.llmModel)
}

export function llmHealthUrl(llm: ResolvedLlm = resolveLlm()): string {
  if (llm.provider === 'none') return ''
  return llm.provider === 'openai' ? `${llm.rootUrl}/models` : `${llm.rootUrl}/api/tags`
}

export function llmHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (env.llmApiKey) {
    headers[env.llmAuthHeader] = env.llmAuthPrefix
      ? `${env.llmAuthPrefix} ${env.llmApiKey}`
      : env.llmApiKey
  }
  return headers
}

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface ChatResult {
  text: string
  model: string
  provider: LlmProvider
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

function extractText(provider: LlmProvider, payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const body = payload as Record<string, any>
  if (provider === 'openai') {
    const choice = body.choices?.[0]
    const message = choice?.message
    const answer =
      contentToText(message?.content) || contentToText(choice?.text)
    if (answer) return answer

    // Model reasoning bisa hanya mengirim chain-of-thought. Hanya pakai itu
    // bila generasi selesai normal; kalau `length`, jawaban terpotong dan
    // lebih baik fallback daripada menampilkan CoT mentah.
    if (choice?.finish_reason === 'stop') {
      return contentToText(message?.reasoning_content)
    }
    return ''
  }
  return String(body.message?.content ?? body.response ?? '').trim()
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.replace(/\s+/g, ' ').slice(0, 300)
  } catch {
    return ''
  }
}

/** Kirim chat ke provider aktif. Melempar error agar caller bisa fallback. */
export async function chatComplete(messages: ChatMessage[]): Promise<ChatResult> {
  const llm = resolveLlm()
  if (llm.provider === 'none') {
    throw new Error('LLM belum dikonfigurasi: set LLM_URL di .env.')
  }
  if (!llm.model) {
    throw new Error('LLM_MODEL belum diisi di .env.')
  }

  const isOpenAi = llm.provider === 'openai'
  const body = isOpenAi
    ? {
        model: llm.model,
        messages,
        stream: false,
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: env.llmMaxTokens,
      }
    : {
        model: llm.model,
        messages,
        stream: false,
        options: { temperature: 0.2, top_p: 0.9, num_predict: env.llmMaxTokens },
      }

  const response = await fetch(llm.chatUrl, {
    method: 'POST',
    headers: llmHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(env.llmTimeoutMs),
  })

  if (!response.ok) {
    throw new Error(
      `LLM HTTP ${response.status} (${llm.provider}) ${await errorDetail(response)}`.trim(),
    )
  }

  const payload = await response.json()
  const text = extractText(llm.provider, payload)
  if (!text) throw new Error(`Respons LLM kosong (${llm.provider})`)

  return { text, model: llm.model, provider: llm.provider }
}

/** Cek ketersediaan provider aktif. Tidak pernah melempar. */
export async function llmHealth(): Promise<boolean> {
  if (!env.llmUrl) return false
  try {
    const llm = resolveLlm()
    const url = llmHealthUrl(llm)
    if (!url) return false
    const response = await fetch(url, {
      headers: llmHeaders(),
      signal: AbortSignal.timeout(2_500),
    })
    return response.ok
  } catch {
    return false
  }
}

export type LlmStatus = 'ok' | 'error' | 'disabled'

export async function llmStatus(): Promise<LlmStatus> {
  if (!env.llmUrl) return 'disabled'
  if (!env.llmModel) return 'error'
  return (await llmHealth()) ? 'ok' : 'error'
}

export function llmSummary(): { provider: LlmProvider; model: string; chatUrl: string } {
  const llm = resolveLlm()
  return { provider: llm.provider, model: llm.model, chatUrl: llm.chatUrl }
}
