import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { apply, inject, name } from '../lib/index.js'

/** A minimal cordis context that records what the plugin registers. */
function fakeContext() {
  const tools = []
  const routes = []
  const disposers = []
  const record = (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    effect(fn) {
      record(fn)
      return () => undefined
    },
    tools: {
      register(definition) {
        tools.push(definition)
        return () => undefined
      },
    },
    inject(_services, callback) {
      callback({
        effect(fn) {
          record(fn)
        },
        webServer: {
          register(route) {
            routes.push(route)
            return () => undefined
          },
        },
      })
    },
  }
  return { ctx, tools, routes, disposers }
}

test('host plugin exports the loader contract', () => {
  assert.equal(name, 'lifepm')
  assert.deepEqual(inject, ['tools'])
  assert.equal(typeof apply, 'function')
})

test('apply registers tools and the /lifepm route', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lifepm-host-'))
  const { ctx, tools, routes, disposers } = fakeContext()
  apply(ctx, { dataDir: dir, pollSeconds: 60 })
  t.after(async () => {
    for (const dispose of disposers) {
      try {
        await dispose()
      } catch {
        // Disposal is best effort in this fake.
      }
    }
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  assert.equal(tools.length, 8, 'eight model-facing tools')
  const names = tools.map((tool) => tool.name).sort()
  assert.deepEqual(names, ['pm_add', 'pm_board', 'pm_capture', 'pm_journal', 'pm_project', 'pm_review', 'pm_triage', 'pm_update'])

  for (const tool of tools) {
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 40, `${tool.name} has a useful description`)
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.execute, 'function')
    assert.equal(tool.output.schema.type, 'object')
  }

  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, '/lifepm')
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(typeof routes[0].handler, 'function')
})

test('tools work against a fresh store', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lifepm-tools-'))
  const { ctx, tools, disposers } = fakeContext()
  apply(ctx, { dataDir: dir, pollSeconds: 60 })
  t.after(async () => {
    for (const dispose of disposers) await dispose()
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))

  const added = await byName.pm_add.execute({ tasks: [{ title: '预约结婚登记', status: 'now', owner: 'both', priority: 'p1' }] })
  assert.match(added.text, /已添加 1 条/)
  assert.equal(added.ids.length, 1)
  const taskId = added.ids[0]

  const board = await byName.pm_board.execute({ view: 'overview' })
  assert.match(board.text, /预约结婚登记/)
  assert.match(board.text, /候选 1/)

  const updated = await byName.pm_update.execute({ id: taskId, status: 'done' })
  assert.match(updated.text, /完成/)

  const project = await byName.pm_project.execute({ name: '婚礼筹备', next: '定场地', why: '一场属于我们的仪式' })
  assert.match(project.text, /婚礼筹备/)

  const captured = await byName.pm_capture.execute({ texts: ['想到一个场地', '问她最在意什么'] })
  assert.match(captured.text, /2 条/)

  const triageList = await byName.pm_triage.execute({ action: 'list' })
  assert.match(triageList.text, /收件箱 2 条/)
  const promoted = await byName.pm_triage.execute({ action: 'promote', index: 0, status: 'next' })
  assert.match(promoted.text, /已转为任务/)

  const journal = await byName.pm_journal.execute({ text: '决定这周先看场地', kind: 'decision' })
  assert.match(journal.text, /已记入/)

  const review = await byName.pm_review.execute({})
  assert.match(review.text, /复盘/)
  assert.match(review.text, /我的复盘/)

  const tasksView = await byName.pm_board.execute({ view: 'tasks', status: 'next' })
  assert.match(tasksView.text, /想到一个场地/)
})
