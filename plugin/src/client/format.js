/** Formatting helpers shared by every LifePM view. */

export const STATUS_LABELS = {
  inbox: '收件箱',
  now: '候选',
  next: '接下来',
  waiting: '等待',
  someday: '也许有一天',
  done: '已完成',
  dropped: '放下',
}

export const STATUS_HINTS = {
  inbox: '先收进来，稍后整理',
  now: '可以碰，不是承诺',
  next: '排上号，但不在本周',
  waiting: '在等别人或等条件',
  someday: '值得记住，现在不做',
  done: '最近完成的',
  dropped: '决定不做了',
}

export const OPEN_STATUSES = ['inbox', 'now', 'next', 'waiting', 'someday']

export const OWNER_LABELS = { me: '我', partner: 'TA', both: '我们' }

export const PROJECT_STATUS_LABELS = {
  active: '进行中',
  paused: '暂停',
  idea: '想法',
  done: '完成',
  dropped: '放下',
}

export const KIND_LABELS = { note: '记录', decision: '决定', win: '好事', worry: '担心' }

export const PRIORITY_LABELS = { p0: '最紧', p1: '高', p2: '中', p3: '低' }

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** `2026-11-04` → `11月4日 周三`. */
export function formatDateLong(iso) {
  if (typeof iso !== 'string' || iso.length < 10) return ''
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return `${month}月${day}日 ${WEEKDAYS[date.getDay()]}`
}

/** `2026-11-04` → `11/04`. */
export function formatDateShort(iso) {
  if (typeof iso !== 'string' || iso.length < 10) return ''
  const [, month, day] = iso.slice(0, 10).split('-')
  return `${month}/${day}`
}

/** Today as `YYYY-MM-DD` in the browser's zone. */
export function todayISO(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Difference in whole days from today; negative means overdue. */
export function daysFromToday(iso) {
  if (typeof iso !== 'string' || iso.length < 10) return null
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  const target = new Date(year, month - 1, day)
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - start.getTime()) / 86400000)
}

/** A relative, human due label plus a state the CSS can style. */
export function describeDue(iso) {
  const days = daysFromToday(iso)
  if (days === null) return null
  if (days < -1) return { text: `逾期 ${Math.abs(days)} 天`, state: 'overdue' }
  if (days === -1) return { text: '昨天', state: 'overdue' }
  if (days === 0) return { text: '今天', state: 'today' }
  if (days === 1) return { text: '明天', state: 'soon' }
  if (days <= 6) return { text: `${days} 天后`, state: 'soon' }
  if (days <= 60) return { text: formatDateShort(iso), state: 'later' }
  return { text: formatDateShort(iso), state: 'later' }
}

/** Monday of the current week as `YYYY-MM-DD`. */
export function weekStartISO(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return todayISO(start)
}

/** Last-activity label: 今天 / 昨天 / 3 天前 / 2 周前. */
export function describeActivity(iso) {
  if (typeof iso !== 'string' || iso.length < 10) return '未记录'
  const days = daysFromToday(iso.slice(0, 10))
  if (days === null || days < 0) return '未记录'
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  if (days < 30) return `${Math.floor(days / 7)} 周前`
  return `${Math.floor(days / 30)} 个月前`
}

/** `2026-11-04 09:12` → `09:12`; ISO timestamps → `11/04 09:12`. */
export function formatStamp(value) {
  if (typeof value !== 'string') return ''
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value)
  if (match === null) return value
  return `${formatDateShort(match[1])} ${match[2]}`
}

/** Initial shown inside an owner avatar: 我 / TA / 共. */
export function ownerInitial(owner, people) {
  if (owner === 'me') return (people?.me ?? '我').slice(0, 1)
  if (owner === 'partner') return (people?.partner ?? 'TA').slice(0, 1)
  if (owner === 'both') return '共'
  return '·'
}

/** Progress of a project from its tasks. */
export function projectProgress(project, tasks) {
  const owned = tasks.filter((task) => task.project === project.id || task.project === project.name)
  const done = owned.filter((task) => task.status === 'done').length
  const open = owned.length - done
  return { done, total: owned.length, open, ratio: owned.length === 0 ? 0 : done / owned.length }
}

/** A stable hue per area id, used only for the tiny area dot. */
export function areaHue(areaId) {
  const text = String(areaId ?? '')
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 360
  return hash
}

/** Group tasks by status, sorted for the board. */
export function groupByStatus(tasks) {
  const groups = { inbox: [], now: [], next: [], waiting: [], someday: [], done: [], dropped: [] }
  for (const task of tasks) (groups[task.status] ?? groups.inbox).push(task)
  return groups
}

/** Clip long text for one-line UI slots. */
export function clip(text, limit = 90) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}
