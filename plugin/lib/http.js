/**
 * LifePM HTTP surface.
 *
 * One prefix route (`/lifepm`) registered on the Host web server serves three
 * audiences:
 *
 *   - the dashboard page, same-origin from the GUI, calling /lifepm/api/*
 *   - external channels (WeChat bridges, Feishu, n8n, curl, iOS Shortcuts)
 *     posting to /lifepm/inbox with the store's ingest token
 *   - health checks
 *
 * Mutating dashboard calls are same-origin only: a request that carries an
 * `Origin` header must match the request's `Host`. External ingress is guarded
 * by the token stored in `pm.md` (`connectors.token`) and is never reachable
 * with an empty token.
 *
 * @module lifepm/http
 */

import { todayISO, weekLabel, parseQuickAdd } from './store.js'

const PREFIX = '/lifepm'
const MAX_BODY_BYTES = 512 * 1024

/**
 * Build the request handler.
 * @param {{ store: import('./store.js').LifePMStore, connectors: { notify: Function, testTelegram: Function, status: Function } }} deps
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createHttpHandler({ store, connectors }) {
  return async function handle(req, res) {
    try {
      await store.ensure()
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname
      if (!path.startsWith(PREFIX)) return sendJson(res, 404, { error: 'not found' })
      const route = path.slice(PREFIX.length) || '/'
      const method = (req.method ?? 'GET').toUpperCase()

      if (route === '/api/ping' && method === 'GET') {
        return sendJson(res, 200, { ok: true, plugin: 'lifepm', version: '0.1.0', today: todayISO() })
      }

      // External ingress: token-authenticated, no browser session required.
      if ((route === '/inbox' || route === '/api/ingest') && method === 'POST') {
        const meta = await store.meta()
        const expected = meta.connectors.token
        const presented = url.searchParams.get('k') ?? url.searchParams.get('token') ?? headerValue(req, 'x-lifepm-token')
        if (expected === '' || presented !== expected) return sendJson(res, 401, { error: 'invalid lifepm token' })
        const body = await readBody(req)
        const text = typeof body.text === 'string' ? body.text : typeof body.message === 'string' ? body.message : ''
        if (text.trim() === '') return sendJson(res, 400, { error: 'text is required' })
        const channel = String(body.channel ?? body.from ?? 'inbox').slice(0, 32)
        const result = await store.ingest(text, channel)
        if (result.action === 'capture') await connectors.notify(`收到一条新的捕获：${text.slice(0, 80)}`, { silent: true })
        return sendJson(res, 200, { ok: true, reply: result.reply, action: result.action })
      }

      if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin request refused' })

      if (route === '/api/state' && method === 'GET') {
        const state = await store.state()
        const connectorsState = connectors.statusView()
        return sendJson(res, 200, { ...state, connectors: { ...connectorsState, token: state.meta.connectors.token } })
      }

      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      const body = await readBody(req)

      switch (route) {
        case '/api/task':
          return await handleTask(store, body, res)
        case '/api/project':
          return await handleProject(store, body, res)
        case '/api/meta': {
          const meta = await store.updateMeta(body)
          return sendJson(res, 200, { ok: true, meta })
        }
        case '/api/journal': {
          const entry = await store.journalAppend(String(body.text ?? ''), { kind: body.kind, date: body.date })
          return sendJson(res, 200, { ok: true, entry })
        }
        case '/api/inbox':
          return await handleInbox(store, body, res)
        case '/api/review': {
          const week = body.week === undefined ? weekLabel() : String(body.week)
          const review = body.op === 'save' ? await store.saveReview(week, body.body) : await store.writeReview(week)
          return sendJson(res, 200, { ok: true, review })
        }
        case '/api/demo': {
          const result = await store.seedDemo()
          return sendJson(res, 200, { ok: true, ...result })
        }
        case '/api/connectors/test': {
          const result = await connectors.testChannel(body)
          return sendJson(res, 200, { ok: result.ok, detail: result.detail })
        }
        default:
          return sendJson(res, 404, { error: `unknown endpoint ${route}` })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = /找不到|not found/i.test(message) ? 404 : 400
      sendJson(res, status, { error: message })
    }
  }
}

/**
 * Task endpoints.
 * @param {import('./store.js').LifePMStore} store
 * @param {Record<string, any>} body
 * @param {import('node:http').ServerResponse} res
 */
async function handleTask(store, body, res) {
  const op = String(body.op ?? 'create')
  if (op === 'create') {
    const input = { ...body }
    delete input.op
    if (typeof input.quickAdd === 'string') {
      const projects = await store.listProjects()
      const parsed = parseQuickAdd(input.quickAdd, { projectNames: projects.map((project) => project.name) })
      return sendJson(res, 200, { ok: true, task: await store.createTask({ ...parsed, ...stripQuick(input), title: input.title ?? parsed.title }) })
    }
    return sendJson(res, 200, { ok: true, task: await store.createTask(input) })
  }
  if (op === 'update') {
    const id = String(body.id ?? body.key ?? '')
    const patch = { ...(body.patch ?? {}) }
    for (const key of ['title', 'status', 'priority', 'owner', 'project', 'area', 'due', 'focus', 'focus_week', 'notes', 'waiting_on', 'tags']) {
      if (body[key] !== undefined) patch[key] = body[key]
    }
    const result = await store.updateTask(id, patch)
    return sendJson(res, 200, { ok: true, task: result.task })
  }
  if (op === 'delete') {
    const task = await store.deleteTask(String(body.id ?? body.key ?? ''))
    return sendJson(res, 200, { ok: true, task })
  }
  return sendJson(res, 400, { error: `unknown task op ${op}` })
}

/** @param {Record<string, any>} input */
function stripQuick(input) {
  const out = { ...input }
  delete out.quickAdd
  delete out.title
  return out
}

/**
 * Project endpoints.
 * @param {import('./store.js').LifePMStore} store
 * @param {Record<string, any>} body
 * @param {import('node:http').ServerResponse} res
 */
async function handleProject(store, body, res) {
  const op = String(body.op ?? 'upsert')
  if (op === 'upsert') return sendJson(res, 200, { ok: true, project: await store.upsertProject(body) })
  if (op === 'touch') return sendJson(res, 200, { ok: true, project: await store.touchProject(String(body.id ?? body.name ?? '')) })
  if (op === 'delete') return sendJson(res, 200, { ok: true, project: await store.deleteProject(String(body.id ?? body.name ?? ''), { unlinkTasks: body.unlinkTasks === true }) })
  return sendJson(res, 400, { error: `unknown project op ${op}` })
}

/**
 * Inbox endpoints.
 * @param {import('./store.js').LifePMStore} store
 * @param {Record<string, any>} body
 * @param {import('node:http').ServerResponse} res
 */
async function handleInbox(store, body, res) {
  const op = String(body.op ?? 'add')
  if (op === 'add') {
    const item = await store.capture(String(body.text ?? ''), String(body.channel ?? 'app'))
    return sendJson(res, 200, { ok: true, item })
  }
  if (op === 'remove') return sendJson(res, 200, { ok: true, item: await store.removeInbox(Number(body.index)) })
  if (op === 'promote') {
    const task = await store.promoteInbox(Number(body.index), body)
    return sendJson(res, 200, { ok: true, task })
  }
  return sendJson(res, 400, { error: `unknown inbox op ${op}` })
}

/**
 * Pin the three most deserving open tasks for today.
 * @param {import('./store.js').LifePMStore} store
 * @param {import('node:http').ServerResponse} res
 */
/**
 * Read and decode a JSON body.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Record<string, any>>}
 */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  const contentType = String(req.headers['content-type'] ?? '')
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text))
  }
  if (!contentType.includes('application/json')) {
    // Be forgiving for curl and simple bridges: treat a raw body as `text`.
    return { text }
  }
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed }
  } catch {
    throw new Error('invalid JSON body')
  }
}

/**
 * Reject cross-site browser writes; non-browser clients have no Origin.
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
function sameOrigin(req) {
  const origin = headerValue(req, 'origin')
  if (origin === undefined || origin === '' || origin === 'null') return true
  try {
    return new URL(origin).host === (headerValue(req, 'host') ?? '')
  } catch {
    return false
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {string} name
 * @returns {string | undefined}
 */
function headerValue(req, name) {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * Write a JSON response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} value
 */
export function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}
