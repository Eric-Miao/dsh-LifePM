import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { LifePMStore } from '../lib/store.js'
import { Connectors } from '../lib/connectors.js'

/** A local webhook sink that records each request body. */
async function sink(t) {
  const received = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      received.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: 0, errcode: 0 }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return { received, base: `http://127.0.0.1:${server.address().port}` }
}

test('outbound webhooks use each provider payload shape', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lifepm-conn-'))
  const store = new LifePMStore(dir)
  await store.ensure()
  const { received, base } = await sink(t)
  await store.updateMeta({
    connectors: {
      notify: [
        { kind: 'feishu', url: `${base}/feishu` },
        { kind: 'wecom', url: `${base}/wecom` },
        { kind: 'webhook', url: `${base}/generic` },
      ],
    },
  })
  const connectors = new Connectors(store, { pollSeconds: 60 })
  const results = await connectors.notify('今日三件事')
  assert.equal(results.length, 3)
  assert.ok(results.every((result) => result.ok), JSON.stringify(results))

  const feishu = received.find((item) => item.url === '/feishu')
  assert.deepEqual(feishu.body, { msg_type: 'text', content: { text: '今日三件事' } })
  const wecom = received.find((item) => item.url === '/wecom')
  assert.deepEqual(wecom.body, { msgtype: 'text', text: { content: '今日三件事' } })
  const generic = received.find((item) => item.url === '/generic')
  assert.deepEqual(generic.body, { text: '今日三件事' })

  await rm(dir, { recursive: true, force: true, maxRetries: 5 })
})

test('channel test and failure reporting', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lifepm-conn-'))
  const store = new LifePMStore(dir)
  await store.ensure()
  const { base } = await sink(t)
  const connectors = new Connectors(store, { pollSeconds: 60 })

  const ok = await connectors.testChannel({ kind: 'feishu', url: `${base}/hook` })
  assert.equal(ok.ok, true)

  const missing = await connectors.testChannel({ kind: 'telegram' })
  assert.equal(missing.ok, false)
  assert.match(missing.detail, /token|chat id/)

  const unreachable = await connectors.testChannel({ kind: 'webhook', url: 'http://127.0.0.1:1/none' })
  assert.equal(unreachable.ok, false)

  await rm(dir, { recursive: true, force: true, maxRetries: 5 })
})

test('telegram poll is inert without configuration', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lifepm-conn-'))
  const store = new LifePMStore(dir)
  await store.ensure()
  const connectors = new Connectors(store, { pollSeconds: 60 })
  await connectors.start()
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(connectors.statusView().telegram.running, false)
  assert.equal(connectors.statusView().telegram.enabled, false)
  await connectors.stop()
  await rm(dir, { recursive: true, force: true, maxRetries: 5 })
})
