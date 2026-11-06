/**
 * LifePM Markdown store.
 *
 * The filesystem is the database. One directory holds every entity as a
 * hand-editable Markdown file:
 *
 *   life-pm/
 *     pm.md                     meta: focus / bet / people / areas / connectors
 *     README.md                 how the store works
 *     tasks/<标题>.md            one task per file (front matter + notes)
 *     projects/<名称>.md         one project per file
 *     inbox.md                  raw captures, one line each
 *     journal/YYYY-MM-DD.md     daily log, append-only entries
 *     reviews/YYYY-Www.md       weekly review scaffold
 *
 * Reads are tolerant: a malformed or hand-edited file still produces a record.
 * Writes are atomic (temp file + rename) and serialised through one promise
 * chain so a UI click, an agent tool call, and a connector message cannot
 * interleave partial writes.
 *
 * @module lifepm/store
 */

import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  PROJECT_KEYS,
  TASK_KEYS,
  META_KEYS,
  parseDocument,
  stringifyDocument,
  isPlainObject,
} from './mdoc.js'

/** Task lifecycle columns, in board order. */
export const STATUSES = ['inbox', 'now', 'next', 'waiting', 'someday', 'done', 'dropped']
/** Columns a task may be moved to from the board. */
export const OPEN_STATUSES = ['inbox', 'now', 'next', 'waiting', 'someday']
/** Project lifecycle values. */
export const PROJECT_STATUSES = ['active', 'paused', 'idea', 'done', 'dropped']
/** Priorities, highest first. */
export const PRIORITIES = ['p0', 'p1', 'p2', 'p3']
/** Owners. */
export const OWNERS = ['me', 'partner', 'both']
/** Journal entry kinds. */
export const JOURNAL_KINDS = ['note', 'decision', 'win', 'worry']

const STATUS_SET = new Set(STATUSES)
const PROJECT_STATUS_SET = new Set(PROJECT_STATUSES)
const OWNER_SET = new Set(OWNERS)
const PRIORITY_SET = new Set(PRIORITIES)
const KIND_SET = new Set(JOURNAL_KINDS)
const PRIORITY_RANK = { p0: 0, p1: 1, p2: 2, p3: 3 }
const DEFAULT_AREAS = [
  { id: 'home', name: '安居' },
  { id: 'work', name: '事业' },
  { id: 'relation', name: '关系' },
  { id: 'health', name: '身心' },
  { id: 'family', name: '家人' },
  { id: 'explore', name: '探索' },
  { id: 'money', name: '财务' },
]

/** @typedef {Record<string, any>} Json */

/** A local calendar date as `YYYY-MM-DD`. */
export function todayISO(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** A local clock time as `HH:MM`. */
export function clockHM(date = new Date()) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** A local timestamp as `YYYY-MM-DD HH:MM`. */
export function stamp(date = new Date()) {
  return `${todayISO(date)} ${clockHM(date)}`
}

/** A local ISO-8601 timestamp with offset, stored in front matter. */
export function isoNow(date = new Date()) {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const absolute = Math.abs(offset)
  return `${todayISO(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`
}

/** ISO-week label (`2026-W45`) for a date. */
export function weekLabel(date = new Date()) {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = (target.getDay() + 6) % 7
  target.setDate(target.getDate() - day + 3)
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  const firstDay = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3)
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000))
  return `${target.getFullYear()}-W${pad2(week)}`
}

/** Monday..Sunday bounds of the ISO week containing `date`, as local dates. */
export function weekBounds(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - day)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start: todayISO(start), end: todayISO(end) }
}

/** Monday..Sunday bounds for a stored `YYYY-Www` label, falling back to the current week. */
export function weekBoundsFromLabel(label) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(label ?? ''))
  if (match === null) return weekBounds()
  const year = Number(match[1])
  const week = Number(match[2])
  const january4 = new Date(year, 0, 4)
  const monday = new Date(year, 0, 4 - ((january4.getDay() + 6) % 7) + (week - 1) * 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { start: todayISO(monday), end: todayISO(sunday) }
}

/** @param {number} value @returns {string} */
function pad2(value) {
  return String(value).padStart(2, '0')
}

/** Expand a leading `~` against the home directory. */
export function expandHome(input) {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return path.join(homedir(), input.slice(2))
  return input
}

/** Strip characters a filename cannot hold and cap the length. */
export function slugify(title, fallback = '未命名') {
  const cleaned = String(title ?? '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 48)
    .trim()
  return cleaned.length > 0 ? cleaned : fallback
}

/**
 * Resolve the week a task is softly focused on. There is no quota: the value
 * is a lens, not a commitment, and it expires by comparing against the current
 * week label.
 * @param {Json} input task input
 * @returns {string | undefined} YYYY-Www
 */
function resolveFocusWeek(input) {
  if (input.focus === true) return weekLabel()
  if (typeof input.focus_week === 'string' && input.focus_week !== '') return input.focus_week
  return undefined
}

/** @param {string} prefix @returns {string} a short random id */
function shortId(prefix) {
  const random = Math.random().toString(36).slice(2, 6)
  return `${prefix}-${Date.now().toString(36)}-${random}`
}

/** Rank helper: lower sorts first. */
function priorityRank(priority) {
  return PRIORITY_RANK[priority] ?? 9
}

/** Sort open tasks the way the board should read. */
export function compareTasks(left, right) {
  const byPriority = priorityRank(left.priority) - priorityRank(right.priority)
  if (byPriority !== 0) return byPriority
  const leftDue = left.due || '9999-12-31'
  const rightDue = right.due || '9999-12-31'
  if (leftDue !== rightDue) return leftDue < rightDue ? -1 : 1
  return String(right.updated ?? '').localeCompare(String(left.updated ?? ''))
}

/** Normalise user input into a valid task status. */
export function normaliseStatus(value, fallback = 'inbox') {
  const raw = String(value ?? '').trim().toLowerCase()
  if (STATUS_SET.has(raw)) return raw
  const aliases = {
    '现在': 'now', 'doing': 'now', '进行中': 'now', 'today': 'now', '本周': 'now',
    '接下来': 'next', 'backlog': 'next', '计划': 'next', 'later': 'next',
    '等待': 'waiting', 'wait': 'waiting', 'blocked': 'waiting', '等回复': 'waiting',
    '也许': 'someday', 'someday': 'someday', 'idea': 'someday', '想法': 'someday', '将来': 'someday',
    '收件箱': 'inbox', 'inbox': 'inbox', '待整理': 'inbox',
    '完成': 'done', 'done': 'done', 'completed': 'done', '已完成': 'done',
    '放下': 'dropped', 'dropped': 'dropped', 'drop': 'dropped', '放弃': 'dropped',
  }
  return aliases[raw] ?? fallback
}

/** Normalise an owner string; unknown values become undefined. */
export function normaliseOwner(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  const aliases = {
    me: 'me', '我': 'me', i: 'me', self: 'me',
    partner: 'partner', '她': 'partner', '他': 'partner', '对方': 'partner', 'ta': 'partner',
    both: 'both', '我们': 'both', '一起': 'both', '共': 'both', we: 'both', us: 'both',
  }
  return aliases[raw] ?? (OWNER_SET.has(raw) ? raw : undefined)
}

/** Normalise a priority string; unknown values become undefined. */
export function normalisePriority(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === '') return undefined
  if (PRIORITY_SET.has(raw)) return raw
  if (/^[0-3]$/.test(raw)) return `p${raw}`
  const aliases = { '高': 'p1', high: 'p1', '中': 'p2', medium: 'p2', '低': 'p3', low: 'p3', urgent: 'p0', '紧急': 'p0' }
  return aliases[raw]
}

/** Normalise a date input against `today`; supports 今天/明天/周X and MM-DD. */
export function normaliseDate(value, today = new Date()) {
  const raw = String(value ?? '').trim()
  if (raw === '') return undefined
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const shift = (days) => {
    const next = new Date(base)
    next.setDate(base.getDate() + days)
    return todayISO(next)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  if (/^\d{1,2}[-/]\d{1,2}$/.test(raw)) {
    const [month, day] = raw.split(/[-/]/).map(Number)
    const candidate = `${base.getFullYear()}-${pad2(month)}-${pad2(day)}`
    const gap = (Date.parse(candidate) - base.getTime()) / 86400000
    return gap < -30 ? `${base.getFullYear() + 1}-${pad2(month)}-${pad2(day)}` : candidate
  }
  if (raw === '今天' || raw === 'today') return todayISO(base)
  if (raw === '明天' || raw === 'tomorrow') return shift(1)
  if (raw === '后天') return shift(2)
  if (raw === '下周') return shift(7)
  if (raw === '本周' || raw === '这周') return shift(7 - ((base.getDay() + 6) % 7))
  const weekday = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }
  const match = /^(下?)周([一二三四五六日天])$/.exec(raw)
  if (match !== null) {
    const target = weekday[match[2]]
    const current = ((base.getDay() + 6) % 7) + 1
    let delta = target - current
    if (delta <= 0) delta += 7
    if (match[1] === '下') delta += delta <= 7 ? 7 : 0
    return shift(delta)
  }
  const parsed = Date.parse(raw)
  if (Number.isFinite(parsed)) return todayISO(new Date(parsed))
  return undefined
}

/**
 * Parse a quick-capture line: `#project @owner !p1 due:周五 买花`.
 * Unknown fragments stay in the title, so a false positive is harmless.
 * @param {string} input raw line
 * @param {{ projectNames?: string[], people?: Record<string,string> }} [context]
 * @returns {{ title: string, project?: string, owner?: string, priority?: string, due?: string, pin?: boolean }}
 */
export function parseQuickAdd(input, context = {}) {
  const text = String(input ?? '').trim()
  const result = { title: '' }
  const words = text.split(/\s+/).filter((word) => word !== '')
  const titleParts = []
  const byName = new Map()
  for (const name of context.projectNames ?? []) byName.set(name.toLowerCase(), name)
  for (const word of words) {
    if (word.startsWith('#') && word.length > 1) {
      const wanted = word.slice(1).toLowerCase()
      result.project = byName.get(wanted) ?? word.slice(1)
      continue
    }
    if (word.startsWith('@') && word.length > 1) {
      const owner = normaliseOwner(word.slice(1))
      if (owner !== undefined) {
        result.owner = owner
        continue
      }
    }
    if (/^!p[0-3]$/i.test(word)) {
      result.priority = word.slice(1).toLowerCase()
      continue
    }
    const due = /^(?:due|截止):(.+)$/i.exec(word)
    if (due !== null) {
      const parsed = normaliseDate(due[1])
      if (parsed !== undefined) {
        result.due = parsed
        continue
      }
    }
    if (word === '今天' || word === 'today!') {
      result.focus = true
      continue
    }
    titleParts.push(word)
  }
  result.title = titleParts.join(' ').trim()
  return result
}

/** @param {unknown} value @returns {string[]} */
function stringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter((item) => item !== '')
  if (typeof value === 'string' && value.trim() !== '') return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
  return []
}

/** @param {string} text @returns {string[]} */
function nonEmptyLines(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '')
}

export class LifePMStore {
  /**
   * @param {string} dataDir absolute or `~`-prefixed store directory
   * @param {{ logger?: { warn: (message: string) => void } }} [options]
   */
  constructor(dataDir, options = {}) {
    this.dir = path.resolve(expandHome(dataDir))
    this.logger = options.logger
    this.queue = Promise.resolve()
    this.metaCache = null
    this.metaCacheAt = 0
  }

  /** Absolute path of a store-relative file. */
  file(...parts) {
    return path.join(this.dir, ...parts)
  }

  /** Run a write exclusively; reads stay lock-free. */
  async exclusive(work) {
    const run = this.queue.then(work, work)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Create the directory skeleton and default meta when absent. */
  async ensure() {
    await fs.mkdir(this.file('tasks'), { recursive: true })
    await fs.mkdir(this.file('projects'), { recursive: true })
    await fs.mkdir(this.file('journal'), { recursive: true })
    await fs.mkdir(this.file('reviews'), { recursive: true })
    if (!existsSync(this.file('pm.md'))) {
      const meta = defaultMeta()
      meta.connectors.token = newToken()
      await fs.writeFile(this.file('pm.md'), stringifyDocument(meta, defaultMetaBody(), META_KEYS), 'utf8')
    }
    if (!existsSync(this.file('inbox.md'))) await fs.writeFile(this.file('inbox.md'), inboxTemplate(), 'utf8')
    if (!existsSync(this.file('README.md'))) await fs.writeFile(this.file('README.md'), storeReadme(this.dir), 'utf8')
    return this
  }

  /**
   * Make sure the store has an ingress token. An empty token would make
   * `/lifepm/inbox` reject every bridge, so the first activation mints one.
   * @returns {Promise<string>} the token now stored
   */
  async ensureToken() {
    const meta = await this.meta()
    if (meta.connectors.token !== '') return meta.connectors.token
    const token = newToken()
    await this.updateMeta({ connectors: { token } })
    return token
  }

  /** Atomic text write. */
  async write(file, text) {
    const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(temp, text, 'utf8')
    await fs.rename(temp, file)
  }

  /** Read text, or undefined when the file is absent. */
  async read(file) {
    try {
      return await fs.readFile(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
  }

  // ---------------------------------------------------------------- meta ---

  /** Read `pm.md`, falling back to defaults for anything missing. */
  async meta() {
    const text = await this.read(this.file('pm.md'))
    const parsed = text === undefined ? { data: {}, body: '' } : parseDocument(text)
    const data = parsed.data
    const people = isPlainObject(data.people)
      ? Object.fromEntries(Object.entries(data.people).map(([key, value]) => [key, String(value)]))
      : { me: '我', partner: 'TA' }
    const areas = Array.isArray(data.areas)
      ? data.areas
          .filter(isPlainObject)
          .map((area) => ({ id: String(area.id ?? area.name ?? ''), name: String(area.name ?? area.id ?? '') }))
          .filter((area) => area.id !== '')
      : DEFAULT_AREAS
    return {
      focus: typeof data.focus === 'string' ? data.focus : '',
      bet: typeof data.bet === 'string' ? data.bet : '',
      quarter: typeof data.quarter === 'string' ? data.quarter : currentQuarter(),
      people: { me: people.me ?? '我', partner: people.partner ?? 'TA' },
      areas: areas.length > 0 ? areas : DEFAULT_AREAS,
      connectors: normaliseConnectors(data.connectors),
      body: parsed.body,
      created: data.created ?? undefined,
    }
  }

  /** Persist a meta patch and return the new meta. */
  async updateMeta(patch) {
    return this.exclusive(async () => {
      const current = await this.meta()
      const next = {
        ...current,
        ...(patch.focus !== undefined ? { focus: String(patch.focus).trim() } : {}),
        ...(patch.bet !== undefined ? { bet: String(patch.bet).trim() } : {}),
        ...(patch.quarter !== undefined ? { quarter: String(patch.quarter).trim() } : {}),
        ...(patch.people !== undefined ? { people: { ...current.people, ...sanitisePeople(patch.people) } } : {}),
        ...(patch.areas !== undefined ? { areas: sanitiseAreas(patch.areas) } : {}),
        ...(patch.connectors !== undefined ? { connectors: normaliseConnectors({ ...current.connectors, ...patch.connectors }) } : {}),
      }
      const data = {
        focus: next.focus,
        bet: next.bet,
        quarter: next.quarter,
        people: next.people,
        areas: next.areas,
        connectors: connectorRecord(next.connectors),
        created: current.created ?? isoNow(),
        updated: isoNow(),
      }
      await this.write(this.file('pm.md'), stringifyDocument(data, patch.body ?? current.body, META_KEYS))
      return this.meta()
    })
  }

  // --------------------------------------------------------------- tasks ---

  /** Read every task file. */
  async listTasks() {
    const files = await safeReaddir(this.file('tasks'))
    const tasks = []
    for (const name of files) {
      if (!name.endsWith('.md')) continue
      const text = await this.read(this.file('tasks', name))
      if (text === undefined) continue
      const task = taskFromDocument(name, text)
      if (task !== null) tasks.push(task)
    }
    tasks.sort(compareTasks)
    return tasks
  }

  /** Resolve a task by id, id prefix, filename, or title fragment. */
  async findTask(key) {
    const needle = String(key ?? '').trim()
    if (needle === '') return undefined
    const tasks = await this.listTasks()
    const exact = tasks.find((task) => task.id === needle)
    if (exact !== undefined) return exact
    const byPrefix = tasks.find((task) => task.id.startsWith(needle))
    if (byPrefix !== undefined) return byPrefix
    const byFile = tasks.find((task) => task.file === needle || task.file === `${needle}.md`)
    if (byFile !== undefined) return byFile
    const lowered = needle.toLowerCase()
    const byTitle = tasks.find((task) => task.title.toLowerCase() === lowered)
    if (byTitle !== undefined) return byTitle
    return tasks.find((task) => task.title.toLowerCase().includes(lowered))
  }

  /** Create one task; returns the stored record. */
  async createTask(input = {}) {
    return this.exclusive(async () => {
      const projects = await this.listProjects()
      const now = isoNow()
      const title = String(input.title ?? '').trim()
      if (title === '') throw new Error('task title is required')
      const project = resolveProjectRef(input.project, projects)
      const task = {
        id: shortId('t'),
        title,
        status: normaliseStatus(input.status, 'inbox'),
        priority: normalisePriority(input.priority),
        owner: normaliseOwner(input.owner),
        project,
        area: input.area === undefined ? undefined : String(input.area),
        due: normaliseDate(input.due),
        focus_week: resolveFocusWeek(input),
        waiting_on: input.waiting_on === undefined ? undefined : String(input.waiting_on),
        tags: stringArray(input.tags),
        created: now,
        updated: now,
        notes: String(input.notes ?? '').trim(),
      }
      if (task.status === 'done') {
        task.done_at = now
        task.focus_week = undefined
      }
      await this.write(this.file('tasks', await this.freeTaskFilename(slugify(title))), renderTask(task))
      await this.touchProjectRef(task.project, now)
      return task
    })
  }

  /** Update one task by key; returns `{ task, changed }`. */
  async updateTask(key, patch = {}) {
    return this.exclusive(async () => {
      const task = await this.findTask(key)
      if (task === undefined) throw new Error(`找不到任务：${key}`)
      const projects = await this.listProjects()
      const next = { ...task }
      if (patch.title !== undefined && String(patch.title).trim() !== '') next.title = String(patch.title).trim()
      if (patch.status !== undefined) next.status = normaliseStatus(patch.status, next.status)
      if (patch.priority !== undefined) next.priority = patch.priority === null ? undefined : normalisePriority(patch.priority)
      if (patch.owner !== undefined) next.owner = patch.owner === null ? undefined : normaliseOwner(patch.owner)
      if (patch.project !== undefined) next.project = patch.project === null || patch.project === '' ? undefined : resolveProjectRef(patch.project, projects)
      if (patch.area !== undefined) next.area = patch.area === null || patch.area === '' ? undefined : String(patch.area)
      if (patch.due !== undefined) next.due = patch.due === null || patch.due === '' ? undefined : normaliseDate(patch.due)
      if (patch.waiting_on !== undefined) next.waiting_on = patch.waiting_on === null || patch.waiting_on === '' ? undefined : String(patch.waiting_on)
      if (patch.tags !== undefined) next.tags = stringArray(patch.tags)
      if (patch.focus !== undefined) next.focus_week = patch.focus === true ? weekLabel() : undefined
      if (patch.focus_week !== undefined) next.focus_week = patch.focus_week === null || patch.focus_week === '' ? undefined : String(patch.focus_week)
      if (patch.pin !== undefined) next.focus_week = patch.pin === true ? weekLabel() : undefined
      if (patch.notes !== undefined) next.notes = String(patch.notes ?? '').trim()
      if (next.status === 'done' && task.status !== 'done') next.done_at = isoNow()
      if (next.status !== 'done') next.done_at = undefined
      if (next.status === 'done' || next.status === 'dropped') next.focus_week = undefined
      next.updated = isoNow()
      const previousFile = this.file('tasks', task.file)
      const targetFile = this.file('tasks', await this.freeTaskFilename(slugify(next.title), task.file))
      await this.write(targetFile, renderTask(next))
      if (previousFile !== targetFile && existsSync(previousFile)) await fs.unlink(previousFile)
      await this.touchProjectRef(next.project, next.updated)
      return { task: next, changed: Object.keys(patch) }
    })
  }

  /**
   * Record activity on the project a task belongs to. Missing or free-form
   * project references are ignored: a task never fails because of its tag.
   * @param {string | undefined} reference project id or name
   * @param {string} [when] ISO timestamp
   */
  async touchProjectRef(reference, when = isoNow()) {
    if (reference === undefined || reference === '') return
    const projects = await this.listProjects()
    const project = projects.find((item) => item.id === reference || item.name === reference)
    if (project === undefined) return
    project.last_active = when
    project.updated = when
    await this.write(this.file('projects', project.file), renderProject(project))
  }

  /**
   * Mark a project as touched without changing any other field.
   * @param {string} key project id or name
   * @returns {Promise<Json>} the updated project
   */
  async touchProject(key) {
    return this.exclusive(async () => {
      const projects = await this.listProjects()
      const project = projects.find((item) => item.id === key || item.name === key)
      if (project === undefined) throw new Error(`找不到项目：${key}`)
      const now = isoNow()
      project.last_active = now
      project.updated = now
      await this.write(this.file('projects', project.file), renderProject(project))
      return project
    })
  }

  /** Delete a task file. */
  async deleteTask(key) {
    const task = await this.findTask(key)
    if (task === undefined) throw new Error(`找不到任务：${key}`)
    await fs.unlink(this.file('tasks', task.file))
    return task
  }

  /** Find an unused task filename. */
  async freeTaskFilename(base, keep) {
    const wanted = `${base}.md`
    if (keep === wanted) return wanted
    if (!existsSync(this.file('tasks', wanted))) return wanted
    for (let index = 2; index < 999; index += 1) {
      const candidate = `${base} ${index}.md`
      if (candidate === keep || !existsSync(this.file('tasks', candidate))) return candidate
    }
    return `${base} ${Date.now()}.md`
  }

  // ------------------------------------------------------------ projects ---

  /** Read every project file. */
  async listProjects() {
    const files = await safeReaddir(this.file('projects'))
    const projects = []
    for (const name of files) {
      if (!name.endsWith('.md')) continue
      const text = await this.read(this.file('projects', name))
      if (text === undefined) continue
      const project = projectFromDocument(name, text)
      if (project !== null) projects.push(project)
    }
    projects.sort((left, right) => projectRank(left.status) - projectRank(right.status) || left.name.localeCompare(right.name, 'zh'))
    return projects
  }

  /** Create or update a project by name/id. */
  async upsertProject(input = {}) {
    return this.exclusive(async () => {
      const name = String(input.name ?? input.id ?? '').trim()
      if (name === '') throw new Error('project name is required')
      const projects = await this.listProjects()
      const existing = input.id === undefined ? projects.find((project) => project.name === name || project.id === name) : projects.find((project) => project.id === input.id)
      const now = isoNow()
      if (existing === undefined) {
        const project = {
          id: slugify(name),
          name,
          status: PROJECT_STATUS_SET.has(String(input.status)) ? String(input.status) : 'active',
          area: input.area === undefined ? undefined : String(input.area),
          owner: normaliseOwner(input.owner),
          target: input.target === undefined ? undefined : String(input.target),
          next: input.next === undefined ? undefined : String(input.next),
          why: input.why === undefined ? undefined : String(input.why),
          last_active: now,
          created: now,
          updated: now,
          notes: String(input.notes ?? '').trim(),
        }
        await this.write(this.file('projects', await this.freeProjectFilename(project.id)), renderProject(project))
        return project
      }
      const next = { ...existing }
      if (input.name !== undefined && String(input.name).trim() !== '') next.name = String(input.name).trim()
      if (input.status !== undefined && PROJECT_STATUS_SET.has(String(input.status))) next.status = String(input.status)
      if (input.area !== undefined) next.area = input.area === null || input.area === '' ? undefined : String(input.area)
      if (input.owner !== undefined) next.owner = input.owner === null ? undefined : normaliseOwner(input.owner)
      if (input.target !== undefined) next.target = input.target === null || input.target === '' ? undefined : String(input.target)
      if (input.next !== undefined) next.next = input.next === null || input.next === '' ? undefined : String(input.next)
      if (input.why !== undefined) next.why = String(input.why ?? '')
      if (input.notes !== undefined) next.notes = String(input.notes ?? '').trim()
      next.updated = now
      next.last_active = now
      const previousId = existing.id
      const nextId = existing.id === slugify(existing.name) ? slugify(next.name) : existing.id
      next.id = nextId
      const previousFile = this.file('projects', existing.file)
      const targetFile = this.file('projects', await this.freeProjectFilename(nextId, existing.file))
      await this.write(targetFile, renderProject(next))
      if (previousFile !== targetFile && existsSync(previousFile)) await fs.unlink(previousFile)
      if (previousId !== nextId || existing.name !== next.name) await this.relinkProject(previousId, existing.name, nextId, next.name)
      return next
    })
  }

  /** Rewrite task references after a project rename. */
  async relinkProject(previousId, previousName, nextId, nextName) {
    const tasks = await this.listTasks()
    for (const task of tasks) {
      const matchesId = task.project === previousId
      const matchesName = task.project === previousName
      if (!matchesId && !matchesName) continue
      const next = { ...task, project: nextId, updated: isoNow() }
      await this.write(this.file('tasks', task.file), renderTask(next))
    }
    void nextName
  }

  /** Find an unused project filename. */
  async freeProjectFilename(base, keep) {
    const wanted = `${base}.md`
    if (keep === wanted) return wanted
    if (!existsSync(this.file('projects', wanted))) return wanted
    for (let index = 2; index < 999; index += 1) {
      const candidate = `${base} ${index}.md`
      if (candidate === keep || !existsSync(this.file('projects', candidate))) return candidate
    }
    return `${base} ${Date.now()}.md`
  }

  /** Delete a project; tasks keeping the reference are asked to unlink first. */
  async deleteProject(key, { unlinkTasks = false } = {}) {
    const projects = await this.listProjects()
    const project = projects.find((item) => item.id === key || item.name === key)
    if (project === undefined) throw new Error(`找不到项目：${key}`)
    if (unlinkTasks) {
      const tasks = await this.listTasks()
      for (const task of tasks) {
        if (task.project !== project.id && task.project !== project.name) continue
        await this.write(this.file('tasks', task.file), renderTask({ ...task, project: undefined, updated: isoNow() }))
      }
    }
    await fs.unlink(this.file('projects', project.file))
    return project
  }

  // --------------------------------------------------------------- inbox ---

  /** Read inbox lines with their positions. */
  async inbox() {
    const text = (await this.read(this.file('inbox.md'))) ?? ''
    return parseInbox(text)
  }

  /** Append a capture line to the inbox. */
  async capture(text, channel = 'app', meta = {}) {
    const body = String(text ?? '').replace(/\s*\n\s*/g, ' ').trim()
    if (body === '') throw new Error('capture text is required')
    return this.exclusive(async () => {
      const current = (await this.read(this.file('inbox.md'))) ?? inboxTemplate()
      const line = `- [ ] ${stamp()} · ${slugChannel(channel)} · ${body}`
      const separator = current.endsWith('\n') ? '' : '\n'
      await this.write(this.file('inbox.md'), `${current}${separator}${line}\n`)
      return { text: body, channel: slugChannel(channel), createdAt: stamp(), meta }
    })
  }

  /** Remove one inbox item by index (the order `inbox()` returns). */
  async removeInbox(index) {
    return this.exclusive(async () => {
      const text = (await this.read(this.file('inbox.md'))) ?? inboxTemplate()
      const items = parseInbox(text)
      const item = items[index]
      if (item === undefined) throw new Error('收件箱条目不存在')
      const lines = text.split('\n')
      lines.splice(item.line, 1)
      await this.write(this.file('inbox.md'), lines.join('\n'))
      return item
    })
  }

  /** Promote one inbox item into a task and remove it from the inbox. */
  async promoteInbox(index, input = {}) {
    const items = await this.inbox()
    const item = items[index]
    if (item === undefined) throw new Error('收件箱条目不存在')
    const task = await this.createTask({
      title: input.title ?? item.text,
      status: input.status ?? 'now',
      priority: input.priority,
      owner: input.owner,
      project: input.project,
      area: input.area,
      due: input.due,
      notes: `来自 ${item.channel} · ${item.createdAt ?? '未知时间'}`,
    })
    await this.removeInbox(index)
    return task
  }

  // ------------------------------------------------------------- journal ---

  /** Read one journal day. */
  async journal(date = todayISO()) {
    const text = (await this.read(this.file('journal', `${date}.md`))) ?? ''
    return { date, entries: parseJournal(text), raw: text }
  }

  /** Recent journal days, newest first. */
  async journalDays(limit = 14) {
    const files = (await safeReaddir(this.file('journal')))
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .sort()
      .slice(-limit)
      .reverse()
    const days = []
    for (const name of files) {
      const date = name.slice(0, -3)
      const text = (await this.read(this.file('journal', name))) ?? ''
      days.push({ date, entries: parseJournal(text), raw: text })
    }
    return days
  }

  /** Append one entry to a day, creating the file when needed. */
  async journalAppend(text, { kind = 'note', date = todayISO(), time = clockHM() } = {}) {
    const body = String(text ?? '').trim()
    if (body === '') throw new Error('journal text is required')
    const safeKind = KIND_SET.has(kind) ? kind : 'note'
    return this.exclusive(async () => {
      const existing = (await this.read(this.file('journal', `${date}.md`))) ?? `# ${date}\n`
      const block = `\n## ${time} · ${safeKind}\n\n${body}\n`
      await this.write(this.file('journal', `${date}.md`), `${existing.replace(/\n*$/, '')}\n${block}`)
      return { date, time, kind: safeKind, text: body }
    })
  }

  // -------------------------------------------------------------- review ---

  /** Weekly review file name. */
  reviewFile(week = weekLabel()) {
    return this.file('reviews', `${week}.md`)
  }

  /** Read a review. */
  async review(week = weekLabel()) {
    const raw = (await this.read(this.reviewFile(week))) ?? ''
    const parsed = raw === '' ? { data: {}, body: '' } : parseDocument(raw)
    return { week, raw, body: parsed.body, createdAt: parsed.data.created }
  }

  /** Recent reviews, newest first. */
  async reviewList(limit = 12) {
    const files = (await safeReaddir(this.file('reviews')))
      .filter((name) => /^\d{4}-W\d{2}\.md$/.test(name))
      .sort()
      .slice(-limit)
      .reverse()
    const reviews = []
    for (const name of files) {
      const week = name.slice(0, -3)
      reviews.push(await this.review(week))
    }
    return reviews
  }

  /** Write a deterministic review scaffold, preserving any user prose. */
  async writeReview(week = weekLabel()) {
    const tasks = await this.listTasks()
    const projects = await this.listProjects()
    const inbox = await this.inbox()
    const bounds = weekBoundsFromLabel(week)
    const existing = await this.review(week)
    const generated = buildReviewMarkdown({ week, tasks, projects, inbox, bounds })
    const readmeBlock = existing.body.includes('## 我的复盘') ? existing.body.slice(existing.body.indexOf('## 我的复盘')) : '## 我的复盘\n\n（在这里写下你的判断、感受和下周的决定）\n'
    const head = generated.slice(0, generated.indexOf('## 我的复盘'))
    const body = `${head}${readmeBlock}`
    await this.write(this.reviewFile(week), stringifyDocument({ week, created: existing.createdAt ?? isoNow(), updated: isoNow() }, body, ['week', 'created', 'updated']))
    return this.review(week)
  }

  /** Save the review body verbatim (the editor in the dashboard). */
  async saveReview(week, body) {
    const existing = await this.review(week)
    const text = String(body ?? '')
    await this.write(this.reviewFile(week), stringifyDocument({
      week,
      created: existing.createdAt ?? isoNow(),
      updated: isoNow(),
    }, text, ['week', 'created', 'updated']))
    return this.review(week)
  }

  // ---------------------------------------------------------------- read ---

  /** Everything the dashboard renders, in one read. */
  async state() {
    const [meta, tasks, projects, inbox, journal, reviews] = await Promise.all([
      this.meta(),
      this.listTasks(),
      this.listProjects(),
      this.inbox(),
      this.journalDays(20),
      this.reviewList(8),
    ])
    const currentWeek = weekLabel()
    const focus = tasks
      .filter((task) => task.focus_week === currentWeek && task.status !== 'done' && task.status !== 'dropped')
      .sort(compareTasks)
    return {
      meta,
      tasks,
      projects,
      inbox,
      journal,
      reviews,
      focus,
      stats: computeStats(tasks, inbox),
      today: todayISO(),
      week: currentWeek,
      dataDir: this.dir,
      generatedAt: isoNow(),
    }
  }

  /** Counts used by the header strip and the model tools. */
  async stats() {
    const [tasks, inbox] = await Promise.all([this.listTasks(), this.inbox()])
    return computeStats(tasks, inbox)
  }

  /** A short plain-text brief for connectors and the UI header. */
  async brief(options = {}) {
    const [tasks, meta, inbox] = await Promise.all([this.listTasks(), this.meta(), this.inbox()])
    return renderBrief(tasks, meta, { ...options, inboxCount: inbox.length })
  }

  // --------------------------------------------------------------- ingest ---

  /**
   * Turn an inbound channel message into store work.
   * Commands start with `/` (or are bare `today` / `done …`); anything else
   * becomes an inbox capture. Returns `{ reply, action }`.
   */
  async ingest(rawText, channel = 'inbox', options = {}) {
    const text = String(rawText ?? '').trim()
    if (text === '') throw new Error('empty message')
    const lower = text.toLowerCase()
    if (/^\/(help|start)$|^帮助$|^\?$/.test(lower)) return { action: 'help', reply: helpText() }
    if (/^\/(today|brief)$|^(今天|今日|简报)$/.test(lower)) return { action: 'brief', reply: await this.brief() }
    if (/^\/(done|complete)\s+/i.test(text) || /^(完成|done)\s+/i.test(text)) {
      const query = text.replace(/^\/(done|complete)\s+/i, '').replace(/^(完成|done)\s+/i, '').trim()
      const task = await this.findTask(query)
      if (task === undefined) return { action: 'done-miss', reply: `没找到「${query}」。试试用更短的关键词，或先看「今天」。` }
      const { task: updated } = await this.updateTask(task.id, { status: 'done' })
      return { action: 'done', reply: `✅ 完成：${updated.title}${updated.project ? ` · ${updated.project}` : ''}` }
    }
    if (/^\/(note|log)\s+/i.test(text) || /^(记一笔|笔记)\s*/i.test(text)) {
      const body = text.replace(/^\/(note|log)\s+/i, '').replace(/^(记一笔|笔记)\s*/i, '').trim()
      await this.journalAppend(body, { kind: 'note' })
      return { action: 'note', reply: `📝 已记入今天的日记。` }
    }
    if (/^\/(task|new)\s+/i.test(text) || /^(待办|任务)\s+/i.test(text)) {
      const body = text.replace(/^\/(task|new)\s+/i, '').replace(/^(待办|任务)\s+/i, '').trim()
      const parsed = parseQuickAdd(body, { projectNames: (await this.listProjects()).map((project) => project.name) })
      const task = await this.createTask({ ...parsed, title: parsed.title || body, status: 'now' })
      return { action: 'task', reply: `📌 已加入「现在」：${task.title}${task.due ? `（${task.due}）` : ''}` }
    }
    const parsed = parseQuickAdd(text, { projectNames: (await this.listProjects()).map((project) => project.name) })
    await this.capture(text, channel)
    const hint = parsed.project !== undefined ? ` · 项目 ${parsed.project}` : ''
    return { action: 'capture', reply: `📥 已收进 LifePM 收件箱${hint}。回复 /task ${text} 可直进「现在」。`, parsed }
  }

  // ---------------------------------------------------------------- demo ---

  /** Load a small demo dataset so an empty store shows the product. */
  async seedDemo() {
    const existing = await this.listTasks()
    if (existing.length > 0) return { created: 0, skipped: true }
    const projects = [
      { name: '婚礼筹备', status: 'active', owner: 'both', area: 'relation', target: '2027-05', next: '定下场地和日期', why: '一场只属于我们两个人的仪式' },
      { name: '换一座城市', status: 'active', owner: 'both', area: 'home', target: '2027-Q1', next: '列出三个候选城市' },
      { name: '职业第二曲线', status: 'idea', owner: 'me', area: 'work', target: '2027', next: '每周和一个陌生领域的人聊一次' },
      { name: '身体重启', status: 'active', owner: 'both', area: 'health', target: '长期', next: '固定每周三次运动' },
    ]
    for (const project of projects) await this.upsertProject(project)
    const tasks = [
      { title: '确认领证需要的材料清单', status: 'now', priority: 'p1', owner: 'both', project: '婚礼筹备', area: 'relation', due: normaliseDate('周五'), focus: true },
      { title: '约两家场地这周末去看', status: 'now', priority: 'p1', owner: 'partner', project: '婚礼筹备', area: 'relation', due: normaliseDate('后天') },
      { title: '算一遍搬家 + 婚礼的年度预算', status: 'next', priority: 'p2', owner: 'me', project: '换一座城市', area: 'money' },
      { title: '问她最在意的三件事是什么', status: 'now', priority: 'p0', owner: 'me', area: 'relation', focus: true },
      { title: '把简历更新到最新版本', status: 'next', priority: 'p2', owner: 'me', project: '职业第二曲线', area: 'work' },
      { title: '给爸妈打个电话聊聊我们的计划', status: 'waiting', owner: 'both', area: 'family', waiting_on: '等我们俩先对齐' },
      { title: '整理一个「想尝试但还没试」的清单', status: 'someday', owner: 'both', area: 'explore' },
      { title: '这个周末去城市另一头散步', status: 'someday', owner: 'both', area: 'explore' },
      { title: '把租房合同续约条件问清楚', status: 'done', priority: 'p2', owner: 'me', area: 'home' },
    ]
    for (const task of tasks) await this.createTask(task)
    await this.journalAppend('把脑子里悬着的事都倒进了 LifePM。先看清全貌，再决定这个季度的赌注。', { kind: 'note' })
    return { created: tasks.length, projects: projects.length }
  }
}

// ------------------------------------------------------------------ helpers ---

/** @param {string} name @returns {string} */
function slugChannel(name) {
  const text = String(name ?? '').trim().toLowerCase()
  return text === '' ? 'app' : text.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').slice(0, 24)
}

/** @param {string} dir @returns {string} */
function storeReadme(dir) {
  return `# LifePM 数据目录

这个目录就是你的「人生 PM」全部数据。所有内容都是 Markdown，可以直接用编辑器改，也可以放进 git。

- \`pm.md\` — 主线（focus / bet）、人物、领域、连接器配置
- \`tasks/<标题>.md\` — 每件事一个文件；front matter 是字段，正文是笔记
- \`projects/<名称>.md\` — 每个项目一个文件
- \`inbox.md\` — 从微信 / 飞书 / Telegram / 快捷输入收到的原始素材
- \`journal/YYYY-MM-DD.md\` — 每日记录
- \`reviews/YYYY-Www.md\` — 每周复盘

字段约定：

\`\`\`
status:  inbox | now | next | waiting | someday | done | dropped
priority: p0（最紧）… p3
owner:    me | partner | both
due:      YYYY-MM-DD
focus_week: 2026-W45 表示本周想做（软标记，无上限）
\`\`\`

当前路径：\`${dir}\`
`
}

/** @returns {string} 32 hex characters */
function newToken() {
  return randomBytes(16).toString('hex')
}

/** @param {string} date @returns {string} */
function currentQuarter(date = new Date()) {
  return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`
}

/** @returns {Json} */
function defaultMeta() {
  return {
    focus: '',
    bet: '',
    quarter: currentQuarter(),
    people: { me: '我', partner: 'TA' },
    areas: DEFAULT_AREAS.map((area) => ({ ...area })),
    connectors: { token: '', telegram: { enabled: false }, notify: [], digest: { enabled: false, hour: 8 } },
    created: isoNow(),
    updated: isoNow(),
  }
}

/** @returns {string} */
function defaultMetaBody() {
  return `# LifePM

## 这一季的赌注

写下这个季度你愿意押上注意力的一件事。它不必宏大，但要能排除掉别的东西。

## 关于我们

（写下你、TA、以及你们共同在意的几件事，任何在这里的助手都会读到它。）`
}

/** @returns {string} */
function inboxTemplate() {
  return `# 收件箱

<!-- LifePM 写入。每行一条：- [ ] YYYY-MM-DD HH:MM · 渠道 · 内容 -->

`
}

/** @param {unknown} value @returns {Json} */
function normaliseConnectors(value) {
  const source = isPlainObject(value) ? value : {}
  const telegram = isPlainObject(source.telegram) ? source.telegram : {}
  const digest = isPlainObject(source.digest) ? source.digest : {}
  const notify = Array.isArray(source.notify)
    ? source.notify.filter(isPlainObject).map((entry) => ({
        kind: String(entry.kind ?? 'webhook'),
        url: String(entry.url ?? ''),
        label: entry.label === undefined ? undefined : String(entry.label),
      })).filter((entry) => entry.url !== '')
    : []
  return {
    token: typeof source.token === 'string' ? source.token : '',
    telegram: {
      enabled: telegram.enabled === true,
      token: typeof telegram.token === 'string' ? telegram.token : '',
      chatId: telegram.chatId === undefined || telegram.chatId === null ? '' : String(telegram.chatId),
      apiBase: typeof telegram.apiBase === 'string' && telegram.apiBase !== '' ? telegram.apiBase : 'https://api.telegram.org',
    },
    notify,
    digest: {
      enabled: digest.enabled === true,
      hour: Number.isInteger(digest.hour) ? Math.min(23, Math.max(0, digest.hour)) : 8,
    },
  }
}

/** @param {Json} connectors @returns {Json} */
function connectorRecord(connectors) {
  const safe = normaliseConnectors(connectors)
  return {
    token: safe.token,
    telegram: {
      enabled: safe.telegram.enabled,
      token: safe.telegram.token,
      chatId: safe.telegram.chatId,
      apiBase: safe.telegram.apiBase,
    },
    notify: safe.notify.map((entry) => ({ kind: entry.kind, url: entry.url, ...(entry.label === undefined ? {} : { label: entry.label }) })),
    digest: safe.digest,
  }
}

/** @param {unknown} people @returns {Record<string,string>} */
function sanitisePeople(people) {
  if (!isPlainObject(people)) return {}
  const out = {}
  for (const key of ['me', 'partner']) {
    if (typeof people[key] === 'string' && people[key].trim() !== '') out[key] = people[key].trim().slice(0, 24)
  }
  return out
}

/** @param {unknown} areas @returns {{id:string,name:string}[]} */
function sanitiseAreas(areas) {
  if (!Array.isArray(areas)) return DEFAULT_AREAS
  const out = []
  for (const area of areas) {
    if (!isPlainObject(area)) continue
    const name = String(area.name ?? '').trim().slice(0, 24)
    if (name === '') continue
    const id = String(area.id ?? name).trim().slice(0, 24) || name
    if (!out.some((item) => item.id === id)) out.push({ id, name: name || id })
  }
  return out.length > 0 ? out : DEFAULT_AREAS
}

/** @param {string} name @param {string} text @returns {Json | null} */
function taskFromDocument(name, text) {
  const { data, body } = parseDocument(text)
  const title = typeof data.title === 'string' && data.title.trim() !== '' ? data.title.trim() : name.replace(/\.md$/, '')
  if (title === '') return null
  const status = normaliseStatus(data.status, 'inbox')
  return {
    id: typeof data.id === 'string' && data.id !== '' ? data.id : `t-file-${slugify(title)}`,
    title,
    status,
    priority: normalisePriority(data.priority),
    owner: normaliseOwner(data.owner),
    project: typeof data.project === 'string' && data.project !== '' ? data.project : undefined,
    area: typeof data.area === 'string' && data.area !== '' ? data.area : undefined,
    due: typeof data.due === 'string' && data.due !== '' ? data.due : undefined,
    focus_week: typeof data.focus_week === 'string' && data.focus_week !== ''
      ? data.focus_week
      : data.pin === true ? weekLabel() : undefined,
    waiting_on: typeof data.waiting_on === 'string' && data.waiting_on !== '' ? data.waiting_on : undefined,
    tags: stringArray(data.tags),
    created: data.created ?? undefined,
    updated: data.updated ?? undefined,
    done_at: data.done_at ?? undefined,
    notes: String(body ?? '').trim(),
    file: name,
  }
}

/** @param {Json} task @returns {string} */
function renderTask(task) {
  const data = {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    owner: task.owner,
    project: task.project,
    area: task.area,
    due: task.due,
    focus_week: task.focus_week,
    waiting_on: task.waiting_on,
    tags: task.tags.length > 0 ? task.tags : undefined,
    created: task.created,
    updated: task.updated,
    done_at: task.done_at,
  }
  return stringifyDocument(data, task.notes, TASK_KEYS)
}

/** @param {string} name @param {string} text @returns {Json | null} */
function projectFromDocument(name, text) {
  const { data, body } = parseDocument(text)
  const projectName = typeof data.name === 'string' && data.name.trim() !== '' ? data.name.trim() : name.replace(/\.md$/, '')
  if (projectName === '') return null
  return {
    id: typeof data.id === 'string' && data.id !== '' ? data.id : slugify(projectName),
    name: projectName,
    status: PROJECT_STATUS_SET.has(String(data.status)) ? String(data.status) : 'active',
    area: typeof data.area === 'string' && data.area !== '' ? data.area : undefined,
    owner: normaliseOwner(data.owner),
    target: typeof data.target === 'string' && data.target !== '' ? data.target : undefined,
    next: typeof data.next === 'string' && data.next !== '' ? data.next : undefined,
    why: typeof data.why === 'string' && data.why !== '' ? data.why : undefined,
    last_active: typeof data.last_active === 'string' && data.last_active !== ''
      ? data.last_active
      : (data.updated ?? data.created ?? undefined),
    created: data.created ?? undefined,
    updated: data.updated ?? undefined,
    notes: String(body ?? '').trim(),
    file: name,
  }
}

/** @param {Json} project @returns {string} */
function renderProject(project) {
  const data = {
    id: project.id,
    name: project.name,
    status: project.status,
    area: project.area,
    owner: project.owner,
    target: project.target,
    next: project.next,
    why: project.why,
    last_active: project.last_active,
    created: project.created,
    updated: project.updated,
  }
  return stringifyDocument(data, project.notes, PROJECT_KEYS)
}

/** @param {string} status */
function projectRank(status) {
  return { active: 0, paused: 1, idea: 2, done: 3, dropped: 4 }[status] ?? 9
}

/** @param {unknown} reference @param {Json[]} projects @returns {string | undefined} */
function resolveProjectRef(reference, projects) {
  if (reference === undefined || reference === null || reference === '') return undefined
  const wanted = String(reference).trim()
  const byId = projects.find((project) => project.id === wanted)
  if (byId !== undefined) return byId.id
  const byName = projects.find((project) => project.name === wanted)
  if (byName !== undefined) return byName.id
  const lowered = wanted.toLowerCase()
  const byLoose = projects.find((project) => project.name.toLowerCase().includes(lowered) || project.id.toLowerCase() === lowered)
  if (byLoose !== undefined) return byLoose.id
  return wanted
}

/** @param {string} text @returns {Json[]} */
function parseInbox(text) {
  const lines = String(text ?? '').split('\n')
  const items = []
  const pattern = /^- \[ \]\s*(?:(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*·\s*([^·]+?)\s*·\s*)?(.*)$/
  lines.forEach((line, index) => {
    const match = pattern.exec(line)
    if (match === null) return
    items.push({
      index: items.length,
      line: index,
      createdAt: match[1] ?? undefined,
      channel: (match[2] ?? 'app').trim(),
      text: (match[3] ?? '').trim(),
    })
  })
  return items
}

/** @param {string} text @returns {Json[]} */
function parseJournal(text) {
  const lines = String(text ?? '').split('\n')
  const entries = []
  let current = null
  for (const line of lines) {
    const head = /^##\s+(\d{2}:\d{2})\s*·\s*(\w+)\s*$/.exec(line)
    if (head !== null) {
      if (current !== null) entries.push(current)
      current = { time: head[1], kind: KIND_SET.has(head[2]) ? head[2] : 'note', text: '' }
      continue
    }
    if (current !== null) current.text += `${line}\n`
  }
  if (current !== null) entries.push(current)
  return entries.map((entry) => ({ ...entry, text: entry.text.trim() })).filter((entry) => entry.text !== '')
}

/** @param {Json[]} tasks @param {Json[]} inbox @returns {Json} */
export function computeStats(tasks, inbox) {
  const today = todayISO()
  const bounds = weekBounds()
  const count = (status) => tasks.filter((task) => task.status === status).length
  const doneThisWeek = tasks.filter((task) => task.status === 'done' && typeof task.done_at === 'string' && task.done_at.slice(0, 10) >= bounds.start && task.done_at.slice(0, 10) <= bounds.end)
  return {
    inbox: inbox.length,
    inboxTasks: count('inbox'),
    now: count('now'),
    next: count('next'),
    waiting: count('waiting'),
    someday: count('someday'),
    done: count('done'),
    dropped: count('dropped'),
    focus: tasks.filter((task) => task.focus_week === weekLabel() && task.status !== 'done' && task.status !== 'dropped').length,
    dueToday: tasks.filter((task) => task.status !== 'done' && task.status !== 'dropped' && task.due === today).length,
    overdue: tasks.filter((task) => task.status !== 'done' && task.status !== 'dropped' && typeof task.due === 'string' && task.due < today).length,
    doneThisWeek: doneThisWeek.length,
    open: tasks.filter((task) => task.status !== 'done' && task.status !== 'dropped').length,
    total: tasks.length,
    week: weekLabel(),
  }
}

/** @param {Json[]} tasks @param {Json} meta @param {Json} options @returns {string} */
export function renderBrief(tasks, meta, options = {}) {
  const today = todayISO()
  const stats = computeStats(tasks, [])
  const inboxCount = options.inboxCount ?? 0
  const open = tasks.filter((task) => task.status !== 'done' && task.status !== 'dropped')
  const focused = open.filter((task) => task.focus_week === weekLabel())
  const focus = focused.length > 0 ? focused : open.filter((task) => task.status === 'now').slice(0, 3)
  const dueSoon = open
    .filter((task) => typeof task.due === 'string' && task.due >= today && task.due <= addDays(today, 7))
    .sort((left, right) => String(left.due).localeCompare(String(right.due)))
    .slice(0, 5)
  const overdue = open.filter((task) => typeof task.due === 'string' && task.due < today)
  const lines = []
  const date = new Date()
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()]
  lines.push(`${date.getMonth() + 1}月${date.getDate()}日 周${weekday} · LifePM`)
  if (meta.focus !== '') lines.push(`主线：${meta.focus}`)
  lines.push(`候选 ${stats.now} · 等待 ${stats.waiting} · 收件箱 ${inboxCount} · 本周完成 ${stats.doneThisWeek}`)
  if (focus.length > 0) {
    lines.push('', '本周想做：')
    focus.forEach((task, index) => lines.push(`${index + 1}. ${task.title}${task.due ? `（${task.due}）` : ''}`))
  }
  if (overdue.length > 0) {
    lines.push('', `逾期 ${overdue.length} 件：`)
    for (const task of overdue.slice(0, 3)) lines.push(`- ${task.title}（${task.due}）`)
  }
  if (dueSoon.length > 0) {
    lines.push('', '本周到期：')
    for (const task of dueSoon) lines.push(`- ${task.due.slice(5)} ${task.title}`)
  }
  if (options.includeInbox === true && inboxCount > 0) lines.push('', `收件箱还有 ${inboxCount} 条待整理。`)
  return lines.join('\n')
}

/** @param {string} date @param {number} days @returns {string} */
function addDays(date, days) {
  const value = new Date(`${date}T00:00:00`)
  value.setDate(value.getDate() + days)
  return todayISO(value)
}

/** @param {Json} input @returns {string} */
function buildReviewMarkdown({ week, tasks, projects, inbox, bounds }) {
  const done = tasks.filter((task) => task.status === 'done' && typeof task.done_at === 'string' && task.done_at.slice(0, 10) >= bounds.start && task.done_at.slice(0, 10) <= bounds.end)
  const open = tasks.filter((task) => task.status !== 'done' && task.status !== 'dropped')
  const waiting = open.filter((task) => task.status === 'waiting')
  const stalled = projects.filter((project) => project.status === 'active' && (!project.last_active || project.last_active.slice(0, 10) < addDays(todayISO(), -21)))
  const byOwner = (owner) => open.filter((task) => task.owner === owner).length
  const lines = [
    `# ${week} 复盘`,
    '',
    `> 生成于 ${stamp()} · 本周 ${bounds.start} ~ ${bounds.end}`,
    '',
    '## 快照',
    '',
    `- 未完成：${open.length} 件（候选 ${open.filter((task) => task.status === 'now').length} · 等待 ${waiting.length}）`,
    `- 本周完成：${done.length} 件`,
    `- 收件箱待整理：${inbox.length} 条`,
    `- 分工：我 ${byOwner('me')} · TA ${byOwner('partner')} · 共同 ${byOwner('both')}`,
    '',
    '## 本周完成',
    '',
    ...(done.length === 0 ? ['- （还没有完成的条目）'] : done.map((task) => `- ${task.title}${task.project ? ` · ${task.project}` : ''}`)),
    '',
    '## 在等什么',
    '',
    ...(waiting.length === 0 ? ['- （没有阻塞项）'] : waiting.map((task) => `- ${task.title}${task.waiting_on ? ` — ${task.waiting_on}` : ''}`)),
    '',
    '## 需要重看的项目',
    '',
    ...(stalled.length === 0 ? ['- （没有停滞项目）'] : stalled.map((project) => `- ${project.name}：下一步是「${project.next ?? '未写'}」，三周没有更新了`)),
    '',
    '## 下周只做三件',
    '',
    '1. ',
    '2. ',
    '3. ',
    '',
    '## 我的复盘',
    '',
    '（在这里写下你的判断、感受和下周的决定）',
    '',
  ]
  return lines.join('\n')
}

/** @returns {string} */
function helpText() {
  return [
    'LifePM 指令：',
    '/today — 今天的三件事和到期项',
    '/task 内容 #项目 @我 !p1 due:周五 — 直接建任务',
    '/done 关键词 — 完成一条任务',
    '/note 内容 — 记进今天的日记',
    '其他任何文字 — 收进收件箱，稍后整理',
  ].join('\n')
}

/** @param {string} dir @returns {Promise<string[]>} */
async function safeReaddir(dir) {
  try {
    return await fs.readdir(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}
