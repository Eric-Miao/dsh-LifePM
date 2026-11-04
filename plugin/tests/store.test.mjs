import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  LifePMStore,
  parseQuickAdd,
  normaliseDate,
  normaliseStatus,
  normaliseOwner,
  slugify,
  weekBoundsFromLabel,
  weekLabel,
} from '../lib/store.js'
import { parseDocument, stringifyDocument } from '../lib/mdoc.js'

async function freshStore(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lifepm-test-'))
  const store = new LifePMStore(dir)
  await store.ensure()
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  return { store, dir }
}

test('mdoc round-trips nested front matter', () => {
  const data = {
    id: 't-1',
    title: '预约 登记: 领证',
    tags: ['legal', '行政'],
    empty: [],
    nested: { me: '我', partner: 'TA' },
    areas: [{ id: 'home', name: '安居' }, { id: 'work', name: '事业' }],
    flag: true,
    when: '2026-11-20',
    nil: null,
  }
  const text = stringifyDocument(data, '# Notes\n\nhello')
  const parsed = parseDocument(text)
  assert.deepEqual(parsed.data, data)
  assert.match(parsed.body, /hello/)
})

test('store skeleton and meta', async (t) => {
  const { store, dir } = await freshStore(t)
  const entries = await readdir(dir)
  assert.ok(entries.includes('pm.md'))
  assert.ok(entries.includes('tasks'))
  const meta = await store.meta()
  assert.equal(meta.people.me, '我')
  assert.ok(meta.areas.length >= 5)
  assert.equal(meta.connectors.digest.hour, 8)
  const updated = await store.updateMeta({ focus: '把生活安顿下来', bet: '先落脚' })
  assert.equal(updated.focus, '把生活安顿下来')
  const stored = await readFile(path.join(dir, 'pm.md'), 'utf8')
  assert.match(stored, /focus: 把生活安顿下来/)
})

test('ingress token is minted once and kept stable', async (t) => {
  const { store } = await freshStore(t)
  const initial = await store.meta()
  assert.match(initial.connectors.token, /^[0-9a-f]{32}$/)
  await store.updateMeta({ connectors: { token: '' } })
  const minted = await store.ensureToken()
  assert.match(minted, /^[0-9a-f]{32}$/)
  assert.equal(await store.ensureToken(), minted)
})

test('task lifecycle including rename and delete', async (t) => {
  const { store, dir } = await freshStore(t)
  const created = await store.createTask({ title: '预约结婚登记', status: 'now', priority: 'p1', owner: 'both', due: '2026-11-20', tags: ['legal'] })
  assert.match(created.id, /^t-/)
  const files = await readdir(path.join(dir, 'tasks'))
  assert.deepEqual(files, ['预约结婚登记.md'])

  const renamed = await store.updateTask(created.id, { title: '预约登记（民政局）' })
  assert.equal(renamed.task.title, '预约登记（民政局）')
  const filesAfter = await readdir(path.join(dir, 'tasks'))
  assert.deepEqual(filesAfter, ['预约登记（民政局）.md'])

  const done = await store.updateTask(created.id, { status: 'done' })
  assert.equal(done.task.status, 'done')
  assert.ok(done.task.done_at)

  const list = await store.listTasks()
  assert.equal(list.length, 1)
  assert.equal(list[0].status, 'done')

  const found = await store.findTask('民政局')
  assert.equal(found.id, created.id)

  await store.deleteTask(created.id)
  assert.equal((await store.listTasks()).length, 0)
})

test('duplicate titles get distinct files', async (t) => {
  const { store, dir } = await freshStore(t)
  await store.createTask({ title: '打电话' })
  await store.createTask({ title: '打电话' })
  const files = await readdir(path.join(dir, 'tasks'))
  assert.equal(files.length, 2)
  assert.deepEqual(files.sort(), ['打电话 2.md', '打电话.md'])
})

test('projects and relinking', async (t) => {
  const { store } = await freshStore(t)
  const project = await store.upsertProject({ name: '婚礼筹备', owner: 'both', area: 'relation', next: '定场地' })
  assert.equal(project.id, '婚礼筹备')
  const task = await store.createTask({ title: '看场地', project: '婚礼筹备' })
  assert.equal(task.project, '婚礼筹备')

  const renamed = await store.upsertProject({ id: '婚礼筹备', name: '我们的婚礼' })
  assert.equal(renamed.id, '我们的婚礼')
  const tasks = await store.listTasks()
  assert.equal(tasks[0].project, '我们的婚礼')
  const projects = await store.listProjects()
  assert.equal(projects.length, 1)
  assert.equal(projects[0].name, '我们的婚礼')
})

test('inbox capture, promote, remove', async (t) => {
  const { store, dir } = await freshStore(t)
  await store.capture('想到一个婚礼场地：海边', 'tg')
  await store.capture('问一下房租续约', 'feishu')
  const items = await store.inbox()
  assert.equal(items.length, 2)
  assert.equal(items[0].channel, 'tg')
  assert.match(items[0].text, /海边/)

  const task = await store.promoteInbox(0, { status: 'now' })
  assert.equal(task.title, '想到一个婚礼场地：海边')
  const after = await store.inbox()
  assert.equal(after.length, 1)
  assert.match(after[0].text, /房租/)

  await store.removeInbox(0)
  assert.equal((await store.inbox()).length, 0)
  const text = await readFile(path.join(dir, 'inbox.md'), 'utf8')
  assert.match(text, /收件箱/)
})

test('journal append and read', async (t) => {
  const { store } = await freshStore(t)
  await store.journalAppend('今天把清单倒空了', { kind: 'note', time: '09:10' })
  await store.journalAppend('决定先定场地', { kind: 'decision', time: '14:20' })
  const day = await store.journal()
  assert.equal(day.entries.length, 2)
  assert.equal(day.entries[1].kind, 'decision')
  assert.match(day.entries[0].text, /倒空/)
  const days = await store.journalDays(5)
  assert.equal(days.length, 1)
})

test('weekly review scaffold preserves prose', async (t) => {
  const { store } = await freshStore(t)
  await store.createTask({ title: '做完了的事', status: 'done' })
  await store.createTask({ title: '还在做的事', status: 'now' })
  const first = await store.writeReview()
  assert.match(first.body, /快照/)
  assert.match(first.body, /我的复盘/)
  const edited = first.body.replace('（在这里写下你的判断、感受和下周的决定）', '这周想清楚了一件事。')
  await store.write(store.reviewFile(first.week), stringifyDocument({ week: first.week, created: first.createdAt }, edited))
  const second = await store.writeReview()
  assert.match(second.body, /这周想清楚了一件事/)
  assert.equal(second.week, first.week)
})

test('ingest commands', async (t) => {
  const { store } = await freshStore(t)
  const captured = await store.ingest('想到一个婚礼场地：海边', 'tg')
  assert.equal(captured.action, 'capture')
  assert.equal((await store.inbox()).length, 1)

  const task = await store.ingest('/task 看两家场地 #婚礼 due:周五', 'tg')
  assert.equal(task.action, 'task')
  const tasks = await store.listTasks()
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].status, 'now')
  assert.ok(tasks[0].due)

  const listed = await store.ingest('/today', 'tg')
  assert.equal(listed.action, 'brief')
  assert.match(listed.reply, /LifePM/)

  const done = await store.ingest('/done 场地', 'tg')
  assert.equal(done.action, 'done')
  assert.equal((await store.listTasks())[0].status, 'done')

  const note = await store.ingest('/note 今天很累但值得', 'tg')
  assert.equal(note.action, 'note')
  assert.match((await store.journal()).entries[0].text, /值得/)

  const help = await store.ingest('/help', 'tg')
  assert.equal(help.action, 'help')
})

test('state and stats', async (t) => {
  const { store } = await freshStore(t)
  await store.createTask({ title: 'A', status: 'now', pin: true })
  await store.createTask({ title: 'B', status: 'waiting' })
  await store.createTask({ title: 'C', status: 'done' })
  await store.capture('一条收件', 'app')
  const state = await store.state()
  assert.equal(state.tasks.length, 3)
  assert.equal(state.stats.now, 1)
  assert.equal(state.stats.inbox, 1)
  assert.equal(state.stats.pinned, 1)
  assert.ok(state.dataDir)
  assert.ok(state.today.match(/^\d{4}-\d{2}-\d{2}$/))
})

test('quick add parsing', () => {
  const parsed = parseQuickAdd('给爸妈打电话 #家人 @我们 !p1 due:周五 今天', { projectNames: ['家人'] })
  assert.equal(parsed.title, '给爸妈打电话')
  assert.equal(parsed.project, '家人')
  assert.equal(parsed.owner, 'both')
  assert.equal(parsed.priority, 'p1')
  assert.equal(parsed.pin, true)
  assert.ok(parsed.due)

  const plain = parseQuickAdd('随便写点什么')
  assert.equal(plain.title, '随便写点什么')
  assert.equal(plain.owner, undefined)
})

test('normalisers and dates', () => {
  assert.equal(normaliseStatus('进行中'), 'now')
  assert.equal(normaliseStatus('等待'), 'waiting')
  assert.equal(normaliseOwner('我们'), 'both')
  assert.equal(normaliseDate('11-20'), `${new Date().getFullYear()}-11-20`)
  assert.equal(slugify('a/b:c'), 'a b c')
  assert.match(weekLabel(new Date(2026, 10, 4)), /^2026-W\d{2}$/)
  const bounds = weekBoundsFromLabel('2026-W45')
  assert.equal(bounds.start.length, 10)
  assert.ok(bounds.start <= bounds.end)
})

test('seed demo fills an empty store once', async (t) => {
  const { store } = await freshStore(t)
  const first = await store.seedDemo()
  assert.ok(first.created > 0)
  const second = await store.seedDemo()
  assert.equal(second.skipped, true)
  const tasks = await store.listTasks()
  assert.ok(tasks.length >= 8)
  assert.ok(tasks.some((task) => task.pin))
})
