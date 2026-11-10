import { describe, expect, test } from 'bun:test'
import { llmHealthUrl, resolveLlm } from './llm'

const MODEL = 'test-model'

function resolve(url: string, provider = 'auto') {
  return resolveLlm({ url, model: MODEL, provider })
}

describe('resolveLlm', () => {
  test('accepts a full OpenAI-compatible URL verbatim', () => {
    const llm = resolve('https://api.commandcode.ai/provider/v1/chat/completions')
    expect(llm.provider).toBe('openai')
    expect(llm.chatUrl).toBe('https://api.commandcode.ai/provider/v1/chat/completions')
    expect(llm.rootUrl).toBe('https://api.commandcode.ai/provider/v1')
    expect(llm.model).toBe(MODEL)
  })

  test('appends /chat/completions to a /v1 base', () => {
    const llm = resolve('https://api.openai.com/v1/')
    expect(llm.provider).toBe('openai')
    expect(llm.chatUrl).toBe('https://api.openai.com/v1/chat/completions')
    expect(llm.rootUrl).toBe('https://api.openai.com/v1')
  })

  test('detects commandcode base URL without /v1', () => {
    const llm = resolve('https://api.commandcode.ai/provider')
    expect(llm.provider).toBe('openai')
    expect(llm.chatUrl).toBe('https://api.commandcode.ai/provider/v1/chat/completions')
  })

  test('accepts a full Ollama chat URL', () => {
    const llm = resolve('http://localhost:11434/api/chat')
    expect(llm.provider).toBe('ollama')
    expect(llm.chatUrl).toBe('http://localhost:11434/api/chat')
    expect(llm.rootUrl).toBe('http://localhost:11434')
  })

  test('treats an unknown bare host as OpenAI-compatible', () => {
    const llm = resolve('https://gateway.example.com')
    expect(llm.provider).toBe('openai')
    expect(llm.chatUrl).toBe('https://gateway.example.com/v1/chat/completions')
  })

  test('is disabled when LLM_URL is empty', () => {
    const llm = resolveLlm({ url: '', model: 'm', provider: 'auto' })
    expect(llm.provider).toBe('none')
    expect(llm.chatUrl).toBe('')
  })

  test('respects an explicit provider override', () => {
    const openai = resolve('https://gateway.example.com', 'openai')
    expect(openai.provider).toBe('openai')
    expect(openai.chatUrl).toBe('https://gateway.example.com/v1/chat/completions')

    const ollama = resolve('https://gateway.example.com', 'ollama')
    expect(ollama.provider).toBe('ollama')
    expect(ollama.chatUrl).toBe('https://gateway.example.com/api/chat')
  })

  test('builds provider-specific health URLs', () => {
    expect(llmHealthUrl(resolve('https://api.openai.com/v1'))).toBe(
      'https://api.openai.com/v1/models',
    )
    expect(llmHealthUrl(resolve('http://localhost:11434/api/chat'))).toBe(
      'http://localhost:11434/api/tags',
    )
  })
})
