type Client = {
  id: string
  controller: ReadableStreamDefaultController<Uint8Array>
  topics: Set<string>
}

const encoder = new TextEncoder()

/**
 * Minimal topic-aware SSE hub. Every dashboard tab opens one connection and
 * subscribes to the topics it cares about (`media`, `alerts`, `clusters`).
 */
class SseHub {
  private clients = new Map<string, Client>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 25_000)
    // Never keep the process alive only because of the heartbeat.
    this.heartbeatTimer.unref?.()
  }

  get size(): number {
    return this.clients.size
  }

  subscribe(request: Request, topics: string[]): Response {
    const id = crypto.randomUUID()
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.clients.set(id, { id, controller, topics: new Set(topics) })
        this.write(controller, 'connected', { clientId: id, topics })
        this.writeComment(controller, 'keep-alive')

        const cleanup = () => {
          this.clients.delete(id)
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        }
        request.signal.addEventListener('abort', cleanup, { once: true })
      },
      cancel: () => {
        this.clients.delete(id)
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': request.headers.get('origin') ?? '*',
      },
    })
  }

  broadcast(event: string, data: unknown, topic?: string): void {
    for (const client of this.clients.values()) {
      if (topic && !client.topics.has(topic)) continue
      try {
        this.write(client.controller, event, data)
      } catch {
        this.clients.delete(client.id)
      }
    }
  }

  private write(
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: string,
    data: unknown,
  ): void {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
  }

  private writeComment(controller: ReadableStreamDefaultController<Uint8Array>, text: string) {
    controller.enqueue(encoder.encode(`: ${text}\n\n`))
  }

  private heartbeat(): void {
    for (const client of this.clients.values()) {
      try {
        this.writeComment(client.controller, 'hb')
      } catch {
        this.clients.delete(client.id)
      }
    }
  }
}

export const sseHub = new SseHub()
