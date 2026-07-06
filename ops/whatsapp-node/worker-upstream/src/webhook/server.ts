// Webhook HTTP server.
//
// Routes:
//   POST /webhook/:instanceId    Evolution event delivery
//   GET  /healthz                Liveness probe (no auth)
//
// Listens on a private internal port (config.webhookPort, default 8090).
// Compose only joins this port to the internal docker network; never
// published to the host or the Caddy edge.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { URL } from 'node:url'
import { config } from '../config.js'
import { log } from '../logger.js'
import { handleEvent } from './handlers.js'
import { SECRET_HEADER, verifyWebhook } from './verify.js'
import type { EvolutionWebhookEnvelope } from './types.js'

// Match the Evolution body cap; their bodies are typically <50KB, but
// history-sync batches can be larger. Reject anything past 5MB.
const MAX_BODY_BYTES = 5 * 1024 * 1024

function uuidish(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      received += c.length
      if (received > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('body too large'))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function reply(res: ServerResponse, status: number, body: object | string): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' })
  res.end(payload)
}

async function handlePost(
  instanceId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const secretHeader = req.headers[SECRET_HEADER]
  const headerVal = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader
  const verifyErr = await verifyWebhook(instanceId, headerVal)
  if (verifyErr) {
    log.warn('webhook.auth_rejected', { instance_id: instanceId, reason: verifyErr })
    reply(res, 401, { ok: false, reason: verifyErr })
    return
  }

  let rawBody: string
  try { rawBody = await readBody(req) }
  catch (err) {
    reply(res, 413, { ok: false, reason: err instanceof Error ? err.message : 'body read failed' })
    return
  }

  let envelope: EvolutionWebhookEnvelope
  try { envelope = JSON.parse(rawBody) as EvolutionWebhookEnvelope }
  catch {
    reply(res, 400, { ok: false, reason: 'invalid json' })
    return
  }
  if (!envelope.event) {
    reply(res, 400, { ok: false, reason: 'missing event' })
    return
  }

  // ACK first, then process. Evolution retries on non-2xx, so we want a fast
  // ack to keep its queue moving. Heavy processing happens off the response
  // path; failures are logged but not re-raised to Evolution.
  reply(res, 200, { ok: true })
  setImmediate(() => {
    handleEvent(instanceId, envelope).catch((err) =>
      log.error('webhook.handle_threw', {
        instance_id: instanceId,
        event: envelope.event,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  })
}

export function startWebhookServer(): { close: () => Promise<void> } {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (!req.url || !req.method) {
          reply(res, 400, { ok: false, reason: 'bad request' })
          return
        }
        const url = new URL(req.url, 'http://localhost')

        if (req.method === 'GET' && url.pathname === '/healthz') {
          reply(res, 200, { ok: true })
          return
        }

        const m = /^\/webhook\/([0-9a-f-]{36})$/i.exec(url.pathname)
        if (m && req.method === 'POST' && uuidish(m[1]!)) {
          await handlePost(m[1]!, req, res)
          return
        }

        reply(res, 404, { ok: false, reason: 'not found' })
      } catch (err) {
        log.error('webhook.server.unhandled', {
          error: err instanceof Error ? err.message : String(err),
          url: req.url,
        })
        try { reply(res, 500, { ok: false }) } catch { /* response may be over */ }
      }
    })()
  })

  server.listen(config.webhookPort, '0.0.0.0', () => {
    log.info('webhook.server.listening', { port: config.webhookPort })
  })

  return {
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve())
    }),
  }
}
