/**
 * LifePM Host plugin.
 *
 * Wires four pieces onto one Markdown store:
 *
 *   store      — filesystem CRUD over hand-editable Markdown
 *   tools      — 8 semantic tools the agent uses to read and update the board
 *   http       — /lifepm dashboard API + /lifepm/inbox channel ingress
 *   connectors — Telegram long polling, outbound webhooks, daily digest
 *
 * The plugin intentionally imports nothing outside Node built-ins and its own
 * modules, so it installs into a profile from a local path without a dependency
 * graph of its own.
 *
 * @module lifepm
 */

import path from 'node:path'
import { LifePMStore } from './store.js'
import { Connectors } from './connectors.js'
import { createHttpHandler } from './http.js'
import { createTools } from './tools.js'

export const name = 'lifepm'
export const inject = ['tools']

/** Default store directory when the profile config omits `dataDir`. */
const DEFAULT_DATA_DIR = '~/.dsh/lifepm'

/**
 * Mount the plugin.
 * @param {any} ctx cordis context
 * @param {{ dataDir?: string, pollSeconds?: number }} [config] profile configuration
 */
export function apply(ctx, config = {}) {
  const dataDir = typeof config.dataDir === 'string' && config.dataDir.trim() !== ''
    ? path.resolve(expand(config.dataDir))
    : DEFAULT_DATA_DIR
  const logger = createLogger(ctx)
  const store = new LifePMStore(dataDir, { logger })
  const connectors = new Connectors(store, { logger, pollSeconds: config.pollSeconds })

  ctx.effect(() => {
    store.ensure()
      .then(() => store.ensureToken())
      .catch((error) => logger.warn(`cannot initialise ${dataDir}: ${message(error)}`))
    logger.info(`store at ${store.dir}`)
    return () => undefined
  }, 'lifepm: store')

  for (const definition of createTools({ store })) {
    ctx.effect(() => ctx.tools.register(definition), `lifepm: tool ${definition.name}`)
  }

  ctx.inject(['webServer'], (webCtx) => {
    const handler = createHttpHandler({ store, connectors })
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/lifepm',
      handler: (req, res) => {
        void handler(req, res).catch((error) => {
          logger.warn(`http handler crashed: ${message(error)}`)
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: 'internal error' }))
          } else {
            res.end()
          }
        })
      },
    }), 'lifepm: http route')
  })

  ctx.effect(() => {
    const started = connectors.start().catch((error) => logger.warn(`connectors failed to start: ${message(error)}`))
    return () => {
      void started.then(() => connectors.stop()).catch(() => undefined)
    }
  }, 'lifepm: connectors')
}

/** @param {string} input */
function expand(input) {
  if (input === '~') return process.env.HOME ?? input
  if (input.startsWith('~/')) return path.join(process.env.HOME ?? '~', input.slice(2))
  return input
}

/**
 * Adapt the cordis logger (callable or plain) without assuming which shape the
 * running composition provides.
 * @param {any} ctx
 */
function createLogger(ctx) {
  const call = (level, text) => {
    try {
      const logger = ctx.logger
      if (logger === undefined || logger === null) return
      const target = typeof logger === 'function' ? logger('lifepm') : logger
      const method = typeof target?.[level] === 'function' ? target[level] : target?.log
      if (typeof method === 'function') method.call(target, `lifepm: ${text}`)
    } catch {
      // Logging must never take the plugin down.
    }
  }
  return {
    info: (text) => call('info', text),
    warn: (text) => call('warn', text),
    error: (text) => call('error', text),
  }
}

/** @param {unknown} error */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
