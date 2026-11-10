import { useEffect, useRef, useState } from 'react'
import { sseUrl } from '@/lib/api'

export type SseStatus = 'connecting' | 'connected' | 'disconnected' | 'disabled'

type HandlerMap = Record<string, (payload: unknown) => void>

/**
 * Resilient EventSource hook.
 * Handlers live in a ref so re-renders never tear down a healthy connection.
 */
export function useSSE(topics: string, handlers: HandlerMap, enabled = true): SseStatus {
  const [status, setStatus] = useState<SseStatus>(enabled ? 'connecting' : 'disabled')
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!enabled) {
      setStatus('disabled')
      return
    }

    let source: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let disposed = false

    const connect = () => {
      if (disposed) return
      setStatus((current) => (current === 'connected' ? current : 'connecting'))
      source = new EventSource(sseUrl(topics))

      source.onopen = () => {
        attempt = 0
        setStatus('connected')
      }

      for (const eventName of Object.keys(handlersRef.current)) {
        source.addEventListener(eventName, (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data)
            handlersRef.current[eventName]?.(payload)
          } catch {
            /* ignore malformed frames */
          }
        })
      }

      source.onerror = () => {
        source?.close()
        if (disposed) return
        setStatus('disconnected')
        attempt += 1
        const delay = Math.min(1_000 * 2 ** Math.min(attempt, 4), 15_000)
        retryTimer = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      source?.close()
    }
  }, [topics, enabled])

  return status
}
