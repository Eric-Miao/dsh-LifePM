import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { computeStats, todayISO, weekLabel } from '../lib/store.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const bundlePath = path.resolve(here, '..', 'lib', 'client.js')

// The browser globals must exist before react-dom is imported: its module scope
// decides once whether a DOM is available, and events never dispatch otherwise.
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://127.0.0.1:19387/' })
const define = (name, value) => {
  try {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  } catch {
    globalThis[name] = value
  }
}
define('window', dom.window)
define('document', dom.window.document)
define('navigator', dom.window.navigator)
define('localStorage', dom.window.localStorage)
define('HTMLElement', dom.window.HTMLElement)
define('Node', dom.window.Node)
define('IS_REACT_ACT_ENVIRONMENT', true)

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { act } = React

/** Load the built plugin bundle into the shared window. */
function loadBundle() {
  const { window } = dom

  let registration = null
  window.__ModuleLoader__ = {
    load(value) {
      registration = value
    },
  }
  window.document.body.innerHTML = ''
  window.document.head.innerHTML = ''
  const source = readFileSync(bundlePath, 'utf8')
  const run = new Function('window', 'document', 'navigator', 'localStorage', 'crypto', source)
  run(window, window.document, window.navigator, window.localStorage, window.crypto)
  assert.ok(registration !== null, 'bundle must register a module factory')
  const exports = registration.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected external ${name}`)
  })
  return { dom, registration, exports }
}

/** A representative dashboard payload. */
function fixture() {
  const today = todayISO()
  const tasks = [
    { id: 't-1', title: '确认领证需要的材料清单', status: 'now', priority: 'p1', owner: 'both', project: '婚礼筹备', area: 'relation', due: today, pin: true, tags: [], created: today, updated: today, notes: '民政局网站', file: '确认领证需要的材料清单.md' },
    { id: 't-2', title: '约两家场地这周末去看', status: 'now', priority: 'p2', owner: 'partner', project: '婚礼筹备', area: 'relation', due: today, pin: false, tags: [], created: today, updated: today, notes: '', file: '约两家场地这周末去看.md' },
    { id: 't-3', title: '算一遍年度预算', status: 'next', priority: 'p2', owner: 'me', project: '换一座城市', area: 'money', due: undefined, pin: false, tags: [], created: today, updated: today, notes: '', file: '算一遍年度预算.md' },
    { id: 't-4', title: '给爸妈打电话', status: 'waiting', owner: 'both', waiting_on: '等我们俩先对齐', tags: [], created: today, updated: today, notes: '', file: '给爸妈打电话.md' },
    { id: 't-5', title: '整理想尝试的清单', status: 'someday', owner: 'both', tags: [], created: today, updated: today, notes: '', file: '整理想尝试的清单.md' },
    { id: 't-6', title: '把租房合同续约条件问清楚', status: 'done', owner: 'me', done_at: `${today}T10:00:00+08:00`, tags: [], created: today, updated: today, notes: '', file: '把租房合同续约条件问清楚.md' },
    { id: 't-7', title: '拖进来的一件事', status: 'inbox', tags: [], created: today, updated: today, notes: '', file: '拖进来的一件事.md' },
  ]
  const projects = [
    { id: '婚礼筹备', name: '婚礼筹备', status: 'active', area: 'relation', owner: 'both', target: '2027-05', next: '定下场地和日期', why: '一场属于我们两个人的仪式', created: today, updated: today, notes: '', file: '婚礼筹备.md' },
    { id: '换一座城市', name: '换一座城市', status: 'active', area: 'home', owner: 'both', target: '2027-Q1', next: '列出三个候选城市', created: today, updated: today, notes: '', file: '换一座城市.md' },
  ]
  const inbox = [
    { index: 0, line: 3, createdAt: `${today} 09:12`, channel: '微信', text: '想到一个婚礼场地：海边的那个' },
  ]
  const meta = {
    focus: '把生活安顿下来',
    bet: '先落脚：定下城市和住处',
    quarter: '2026-Q4',
    people: { me: '我', partner: 'TA' },
    areas: [
      { id: 'home', name: '安居' },
      { id: 'relation', name: '关系' },
      { id: 'money', name: '财务' },
    ],
    connectors: {
      token: 'abc123',
      telegram: { enabled: false, token: '', chatId: '', apiBase: 'https://api.telegram.org' },
      notify: [],
      digest: { enabled: false, hour: 8 },
    },
    body: '',
  }
  return {
    meta,
    tasks,
    projects,
    inbox,
    journal: [
      { date: today, entries: [{ time: '09:12', kind: 'note', text: '把清单倒空了。' }] },
    ],
    reviews: [],
    stats: computeStats(tasks, inbox),
    today,
    week: weekLabel(),
    dataDir: '/tmp/lifepm-fixture',
    generatedAt: `${today}T09:00:00+08:00`,
    connectors: {
      telegram: { enabled: false, running: false, ok: false, chatId: '' },
      notify: 0,
      digest: { enabled: false, hour: 8 },
      pollSeconds: 3,
    },
  }
}

/** A fetch stub that serves the fixture and accepts mutations. */
function installFetch(data) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url), 'http://127.0.0.1:19387/')
    const method = (init.method ?? 'GET').toUpperCase()
    calls.push({ path: parsed.pathname, method, body: init.body === undefined ? undefined : JSON.parse(init.body) })
    const payload = method === 'GET'
      ? data
      : { ok: true, task: { id: 't-1' }, meta: data.meta, review: { week: data.week, body: '# review' } }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
    }
  }
  return calls
}

test('the bundle registers a plugin factory with apply/inject', () => {
  const { exports, registration } = loadBundle()
  assert.equal(registration.id, 'lifepm')
  assert.deepEqual(exports.inject, ['slots'])
  assert.equal(typeof exports.apply, 'function')
})

test('apply registers the sidebar entry and the main panel', () => {
  const { exports, dom } = loadBundle()
  const registrations = []
  const injected = []
  const ctx = {
    slots: {
      inject(name, register) {
        injected.push(name)
        register()
      },
      register(spec, component) {
        registrations.push({ spec, component })
        return () => undefined
      },
    },
  }
  exports.apply(ctx)
  assert.deepEqual(injected, ['main', 'sidebar.panellist'])
  const main = registrations.find((entry) => entry.spec.name === 'main')
  assert.equal(main.spec.key, 'lifepm')
  const side = registrations.find((entry) => entry.spec.name === 'sidebar.panellist')
  assert.equal(side.spec.id, 'lifepm')
  assert.equal(side.spec.label, '人生 PM')
  const style = dom.window.document.querySelector('style[data-lifepm-css]')
  assert.ok(style !== null, 'stylesheet is injected once')
  assert.match(style.textContent, /lpm-board/)
})

/** Mount the panel with the fixture and always unmount. */
async function mountApp(t, data) {
  const { exports, dom } = loadBundle()
  const calls = installFetch(data)
  const container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => {
    await act(async () => {
      root.unmount()
    })
  })
  await act(async () => {
    root.render(React.createElement(exports.App))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return { container, root, dom, calls }
}

test('renders the board, today strip and task cards', async (t) => {
  const { container } = await mountApp(t, fixture())

  const text = container.textContent
  assert.match(text, /把生活安顿下来/)
  assert.match(text, /确认领证需要的材料清单/)
  assert.match(text, /收件箱/)
  assert.match(text, /想到一个婚礼场地/)
  assert.match(text, /你说今天要碰的 1 件/)

  const cards = container.querySelectorAll('.lpm-card')
  assert.ok(cards.length >= 5, `expected task cards, got ${cards.length}`)

  const columns = container.querySelectorAll('.lpm-col')
  assert.equal(columns.length, 5, 'five open columns by default')
})

test('opening a card shows the drawer and saving posts an update', async (t) => {
  const { container, dom, calls } = await mountApp(t, fixture())

  const card = container.querySelector('.lpm-card')
  await act(async () => {
    card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  assert.ok(container.querySelector('.lpm-drawer') !== null, 'drawer opens')
  assert.match(container.querySelector('.lpm-drawer').textContent, /事项/)

  const title = container.querySelector('.lpm-title-input')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(title, '确认领证材料（新）')
    title.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })

  const save = [...container.querySelectorAll('.lpm-drawer-foot button')].find((button) => button.textContent.includes('保存'))
  assert.ok(save !== undefined, 'save button present')
  await act(async () => {
    save.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const update = calls.find((call) => call.method === 'POST' && call.path.endsWith('/api/task'))
  assert.ok(update !== undefined, 'task update posted')
  assert.equal(update.body.op, 'update')
  assert.equal(update.body.patch.title, '确认领证材料（新）')
})

test('switching to the projects tab renders the portfolio', async (t) => {
  const { container, dom } = await mountApp(t, fixture())

  const tab = [...container.querySelectorAll('.lpm-tab')].find((button) => button.textContent.startsWith('项目'))
  await act(async () => {
    tab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  assert.match(container.textContent, /项目组合/)
  assert.match(container.textContent, /婚礼筹备/)
})

test('journal, review and settings tabs render without crashing', async (t) => {
  const { container, dom } = await mountApp(t, fixture())

  const click = async (label) => {
    const tab = [...container.querySelectorAll('.lpm-tab')].find((button) => button.textContent.startsWith(label))
    assert.ok(tab !== undefined, `tab ${label} present`)
    await act(async () => {
      tab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
  }

  await click('日记')
  assert.match(container.textContent, /日记与决定/)
  assert.match(container.textContent, /把清单倒空了/)

  await click('复盘')
  assert.match(container.textContent, /每周复盘/)
  assert.match(container.textContent, /这一周还没有复盘/)

  await click('设置')
  assert.match(container.textContent, /这一季/)
  assert.match(container.textContent, /连接器/)
  assert.match(container.textContent, /\/lifepm\/inbox/)
  assert.match(container.textContent, /每日摘要/)
})
