import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { LifePMStore } from '../lib/store.js'
import { Connectors } from '../lib/connectors.js'
import { createHttpHandler } from '../lib/http.js'

async function harness(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lifepm-http-'))
  const store = new LifePMStore(dir)
  await store.ensure()
  const connectors = new Connectors(store, { pollSeconds: 60 })
  const handler = createHttpHandler({ store, connectors })
  const server = createServer((req, res) => {
    void handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}/lifepm`
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  })
  return { store, base, dir }
}

async function get(base, path) {
  const response = await fetch(`${base}${path}`)
  return { status: response.status, body: await response.json() }
}

async function post(base, path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

test('ping and state', async (t) => {
  const { base } = await harness(t)
  const ping = await get(base, '/api/ping')
  assert.equal(ping.status, 200)
  assert.equal(ping.body.ok, true)

  const state = await get(base, '/api/state')
  assert.equal(state.status, 200)
  assert.ok(Array.isArray(state.body.tasks))
  assert.ok(state.body.meta.areas.length > 0)
  assert.equal(state.body.connectors.telegram.enabled, false)
})

test('task create, update, delete through the API', async (t) => {
  const { base, store } = await harness(t)
  const created = await post(base, '/api/task', { op: 'create', title: '预约登记', status: 'now', owner: 'both', due: '2026-11-20' })
  assert.equal(created.status, 200)
  const id = created.body.task.id
  assert.ok(id)

  const updated = await post(base, '/api/task', { op: 'update', id, status: 'done' })
  assert.equal(updated.body.task.status, 'done')

  const state = await get(base, '/api/state')
  assert.equal(state.body.tasks[0].status, 'done')

  const removed = await post(base, '/api/task', { op: 'delete', id })
  assert.equal(removed.status, 200)
  assert.equal((await store.listTasks()).length, 0)
})

test('quick add through the API', async (t) => {
  const { base } = await harness(t)
  const created = await post(base, '/api/task', { op: 'create', quickAdd: '给爸妈打电话 #家人 @我们 !p1' })
  assert.equal(created.body.task.title, '给爸妈打电话')
  assert.equal(created.body.task.owner, 'both')
  assert.equal(created.body.task.priority, 'p1')
})

test('inbox flow', async (t) => {
  const { base } = await harness(t)
  const added = await post(base, '/api/inbox', { op: 'add', text: '想到一个婚礼场地', channel: '微信' })
  assert.equal(added.status, 200)
  let state = await get(base, '/api/state')
  assert.equal(state.body.inbox.length, 1)
  assert.equal(state.body.inbox[0].channel, '微信')

  const promoted = await post(base, '/api/inbox', { op: 'promote', index: 0, status: 'next' })
  assert.equal(promoted.body.task.title, '想到一个婚礼场地')
  state = await get(base, '/api/state')
  assert.equal(state.body.inbox.length, 0)
  assert.equal(state.body.tasks.length, 1)
})

test('meta, journal, review', async (t) => {
  const { base } = await harness(t)
  const meta = await post(base, '/api/meta', { focus: '把生活安顿下来', people: { partner: '小林' } })
  assert.equal(meta.body.meta.focus, '把生活安顿下来')
  assert.equal(meta.body.meta.people.partner, '小林')

  const journal = await post(base, '/api/journal', { text: '今天想清楚了一件事', kind: 'decision' })
  assert.equal(journal.status, 200)

  const review = await post(base, '/api/review', {})
  assert.equal(review.status, 200)
  assert.match(review.body.review.body, /我的复盘/)
})

test('focus-today fills the pin set', async (t) => {
  const { base } = await harness(t)
  await post(base, '/api/task', { op: 'create', title: 'A', status: 'now', priority: 'p1' })
  await post(base, '/api/task', { op: 'create', title: 'B', status: 'now', priority: 'p0' })
  await post(base, '/api/task', { op: 'create', title: 'C', status: 'next' })
  const focus = await post(base, '/api/focus-today', {})
  assert.equal(focus.status, 200)
  assert.equal(focus.body.picked.length, 3)
  const state = await get(base, '/api/state')
  assert.equal(state.body.tasks.filter((task) => task.pin).length, 3)
})

test('external ingest requires the token and writes the inbox', async (t) => {
  const { base, store } = await harness(t)
  const unauthorised = await post(base, '/inbox', { text: 'hi' })
  assert.equal(unauthorised.status, 401)

  await store.updateMeta({ connectors: { token: 'secret-token' } })
  const rejected = await post(base, '/inbox', { text: 'hi' }, { 'x-lifepm-token': 'wrong' })
  assert.equal(rejected.status, 401)

  const accepted = await post(base, '/inbox', { text: '从微信来的一条', channel: 'wechat' }, { 'x-lifepm-token': 'secret-token' })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.action, 'capture')

  const withQuery = await fetch(`${base}/inbox?k=secret-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '/task 直接建一个任务' }),
  })
  const payload = await withQuery.json()
  assert.equal(payload.action, 'task')
  assert.equal((await store.listTasks()).length, 1)
})

test('cross-origin writes are refused', async (t) => {
  const { base } = await harness(t)
  const response = await post(base, '/api/task', { title: 'x' }, { origin: 'https://evil.example' })
  assert.equal(response.status, 403)
})

test('demo seed endpoint', async (t) => {
  const { base } = await harness(t)
  const seeded = await post(base, '/api/demo', {})
  assert.equal(seeded.status, 200)
  assert.ok(seeded.body.created > 0)
  const state = await get(base, '/api/state')
  assert.ok(state.body.projects.length > 0)
})
