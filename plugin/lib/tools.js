/**
 * Model-facing tools for LifePM.
 *
 * Tools are registered through the raw `ctx.tools.register()` contract (a JSON
 * Schema parameter block plus execute/render), so this package does not depend
 * on any harness package and stays installable from a local path. Each tool is
 * a thin, opinionated projection over the Markdown store: the model reads a
 * compact board and writes through semantic operations instead of guessing
 * file names.
 *
 * @module lifepm/tools
 */

import { todayISO, weekLabel, compareTasks, computeStats } from './store.js'

const STATUS_ENUM = ['inbox', 'now', 'next', 'waiting', 'someday', 'done', 'dropped']
const OWNER_ENUM = ['me', 'partner', 'both']
const PRIORITY_ENUM = ['p0', 'p1', 'p2', 'p3']

const OWNER_LABEL = { me: '我', partner: 'TA', both: '我们' }
const STATUS_LABEL = { inbox: '收件箱', now: '现在', next: '接下来', waiting: '等待', someday: '也许', done: '完成', dropped: '放下' }

/** Tool name prefix, kept short for token cost. */
const PREAMBLE = `LifePM 是这个工作区里用户的人生/家庭事项看板，数据是本地 Markdown（tasks/、projects/、inbox.md、journal/、reviews/）。
状态：inbox 待整理 · now 现在做 · next 接下来 · waiting 等别人/等条件 · someday 也许 · done 完成 · dropped 放下。
owner：me（用户本人）· partner（伴侣）· both（两人一起）。priority：p0 最紧 → p3。`

/**
 * Register every LifePM tool.
 * @param {{ store: import('./store.js').LifePMStore }} deps
 * @returns {any[]} tool definitions ready for `ctx.tools.register()`
 */
export function createTools({ store }) {
  /** @param {string} name @param {string} title @param {any} parameters @param {(args: any) => Promise<{text: string, ids?: string[]}>} execute */
  const tool = (name, title, description, parameters, execute) => ({
    name,
    description: `${description}\n\n${PREAMBLE}`,
    parameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    presentCall: (args) => ({ card: 'generic', title, kind: 'other', rawInput: args }),
    execute: async (args) => {
      await store.ensure()
      const result = await execute(args ?? {})
      return { text: result.text, ids: result.ids ?? [] }
    },
  })

  return [
    tool(
      'pm_board',
      '查看人生 PM 看板',
      'Read the user\'s LifePM board. Start here at the beginning of any planning conversation. `view` picks the slice: overview (default, the whole picture), tasks (filterable list with ids), projects, inbox, journal, review. Use the ids it returns for pm_update.',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          view: { type: 'string', enum: ['overview', 'tasks', 'projects', 'inbox', 'journal', 'review'], description: 'Which slice to read. Default overview.' },
          status: { type: 'string', enum: STATUS_ENUM, description: 'Filter tasks by status (view=tasks).' },
          project: { type: 'string', description: 'Filter tasks by project id or name (view=tasks).' },
          query: { type: 'string', description: 'Filter tasks by title substring (view=tasks).' },
          limit: { type: 'integer', description: 'Max rows per section, 1-120. Default 60.' },
        },
      },
      async (args) => ({ text: await boardText(store, args) }),
    ),

    tool(
      'pm_add',
      '添加事项',
      'Add one or more tasks to LifePM. Write the title the way the user said it. Prefer putting new vague items in `inbox`; use `now` only when the user says it is happening now or this week. `due` accepts YYYY-MM-DD or 今天/明天/周五/下周.',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          tasks: {
            type: 'array',
            description: 'Tasks to create, in order.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string', description: 'The task in the user\'s own words.' },
                status: { type: 'string', enum: STATUS_ENUM, description: 'Default inbox.' },
                owner: { type: 'string', enum: OWNER_ENUM, description: 'Who is responsible.' },
                project: { type: 'string', description: 'Project id or name; unknown names are kept as written.' },
                area: { type: 'string', description: 'Life area id, e.g. home / work / relation / health / family / explore / money.' },
                priority: { type: 'string', enum: PRIORITY_ENUM },
                due: { type: 'string', description: 'YYYY-MM-DD or a Chinese relative date.' },
                pin: { type: 'boolean', description: 'true puts it in today\'s three.' },
                notes: { type: 'string', description: 'Free-form notes stored in the Markdown body.' },
              },
              required: ['title'],
            },
          },
        },
        required: ['tasks'],
      },
      async (args) => {
        const created = []
        for (const input of Array.isArray(args.tasks) ? args.tasks : []) {
          created.push(await store.createTask(input))
        }
        const lines = created.map((task) => `- ${task.title} · ${STATUS_LABEL[task.status] ?? task.status}${task.project ? ` · ${task.project}` : ''}${task.due ? ` · ${task.due}` : ''} （id: ${task.id}）`)
        return {
          text: created.length === 0 ? '没有创建任何事项（tasks 为空）。' : `已添加 ${created.length} 条：\n${lines.join('\n')}`,
          ids: created.map((task) => task.id),
        }
      },
    ),

    tool(
      'pm_update',
      '更新事项',
      'Update, complete, drop, pin or re-parent an existing task. Identify it with the id from pm_board (a unique title fragment also works). Only send the fields that change; an empty field clears that field. Setting status to done records the completion time.',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'Task id from pm_board, or a distinctive title fragment.' },
          title: { type: 'string' },
          status: { type: 'string', enum: STATUS_ENUM },
          owner: { type: 'string', enum: OWNER_ENUM },
          project: { type: 'string' },
          area: { type: 'string' },
          priority: { type: 'string', enum: PRIORITY_ENUM },
          due: { type: 'string', description: 'YYYY-MM-DD, or empty to clear.' },
          pin: { type: 'boolean' },
          waiting_on: { type: 'string', description: 'What or who is blocking a waiting task.' },
          notes: { type: 'string' },
        },
        required: ['id'],
      },
      async (args) => {
        const patch = {}
        for (const key of ['title', 'status', 'owner', 'project', 'area', 'priority', 'due', 'pin', 'waiting_on', 'notes']) {
          if (args[key] !== undefined) patch[key] = args[key]
        }
        const { task } = await store.updateTask(String(args.id), patch)
        return {
          text: `已更新：${task.title}\n状态 ${STATUS_LABEL[task.status] ?? task.status}${task.owner ? ` · ${OWNER_LABEL[task.owner]}` : ''}${task.project ? ` · ${task.project}` : ''}${task.due ? ` · ${task.due}` : ''}`,
          ids: [task.id],
        }
      },
    ),

    tool(
      'pm_project',
      '创建/更新项目',
      'Create or update a life project — an ongoing thread with a purpose, not a single task. Use it when the user describes something spanning weeks (a move, a wedding, a career turn, a health change). Keep `next` to one concrete next action.',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'Existing project id when updating; omit to match by name or create.' },
          name: { type: 'string' },
          status: { type: 'string', enum: ['active', 'paused', 'idea', 'done', 'dropped'] },
          area: { type: 'string' },
          owner: { type: 'string', enum: OWNER_ENUM },
          target: { type: 'string', description: 'Target date or horizon, e.g. 2027-05 or 2027-Q1.' },
          next: { type: 'string', description: 'The single next action.' },
          why: { type: 'string', description: 'Why this project matters — used in reviews.' },
          notes: { type: 'string' },
        },
        required: ['name'],
      },
      async (args) => {
        const project = await store.upsertProject(args)
        return {
          text: `项目「${project.name}」（${project.status}）已保存。下一步：${project.next ?? '（未写）'}${project.target ? ` · 目标 ${project.target}` : ''}`,
          ids: [project.id],
        }
      },
    ),

    tool(
      'pm_capture',
      '记进收件箱',
      'Dump raw thoughts into the inbox without classifying them. Use this when the user is thinking out loud and does not want decisions yet; triage later with pm_triage. Never lose a user thought.',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          texts: { type: 'array', items: { type: 'string' }, description: 'One raw item per entry.' },
          channel: { type: 'string', description: 'Where it came from, e.g. chat / voice / 微信.' },
        },
        required: ['texts'],
      },
      async (args) => {
        const items = Array.isArray(args.texts) ? args.texts.filter((text) => String(text).trim() !== '') : []
        for (const text of items) await store.capture(text, args.channel ?? 'chat')
        return { text: items.length === 0 ? '没有收到内容。' : `已收进收件箱 ${items.length} 条。` }
      },
    ),

    tool(
      'pm_triage',
      '整理收件箱',
      'Work the inbox. `list` shows numbered items; `promote` turns one into a task (optionally setting status/project/owner/priority/due) and removes it from the inbox; `drop` deletes one. Triage in the user\'s batches — do not promote everything blindly.',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['list', 'promote', 'drop'], description: 'Default list.' },
          index: { type: 'integer', description: 'Zero-based index from `list`.' },
          title: { type: 'string', description: 'Rewritten task title when promoting (defaults to the raw text).' },
          status: { type: 'string', enum: STATUS_ENUM },
          owner: { type: 'string', enum: OWNER_ENUM },
          project: { type: 'string' },
          area: { type: 'string' },
          priority: { type: 'string', enum: PRIORITY_ENUM },
          due: { type: 'string' },
        },
      },
      async (args) => {
        const action = String(args.action ?? 'list')
        const items = await store.inbox()
        if (action === 'list') {
          if (items.length === 0) return { text: '收件箱是空的。' }
          const lines = items.map((item) => `${item.index}. ${item.text}${item.channel !== 'app' ? `（来自 ${item.channel}${item.createdAt ? ` · ${item.createdAt}` : ''}）` : ''}`)
          return { text: `收件箱 ${items.length} 条：\n${lines.join('\n')}` }
        }
        const index = Number(args.index)
        if (!Number.isInteger(index) || index < 0 || index >= items.length) return { text: `索引无效，收件箱目前有 ${items.length} 条。` }
        if (action === 'drop') {
          const removed = await store.removeInbox(index)
          return { text: `已移除：${removed.text}` }
        }
        const task = await store.promoteInbox(index, {
          title: args.title,
          status: args.status ?? 'next',
          owner: args.owner,
          project: args.project,
          area: args.area,
          priority: args.priority,
          due: args.due,
        })
        return { text: `已转为任务：${task.title} · ${STATUS_LABEL[task.status] ?? task.status} （id: ${task.id}）`, ids: [task.id] }
      },
    ),

    tool(
      'pm_journal',
      '记日记 / 决策',
      'Append one entry to today\'s journal in the user\'s own voice. `kind=decision` is for a decision made (record the reasoning), `win` for something good that happened, `worry` for a lingering concern. Keep it short and factual; never invent events.',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', description: 'The entry body.' },
          kind: { type: 'string', enum: ['note', 'decision', 'win', 'worry'] },
          date: { type: 'string', description: 'YYYY-MM-DD, default today.' },
        },
        required: ['text'],
      },
      async (args) => {
        const entry = await store.journalAppend(String(args.text), { kind: args.kind ?? 'note', date: args.date })
        return { text: `已记入 ${entry.date} ${entry.time}（${entry.kind}）。` }
      },
    ),

    tool(
      'pm_review',
      '生成每周复盘',
      'Generate (or refresh) the weekly review scaffold from the real data: completions, blockers, stalled projects, owner split. User prose under 「我的复盘」 is preserved. Use it at the end of a week, then discuss the review with the user instead of just reporting numbers.',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          week: { type: 'string', description: 'YYYY-Www; default the current week.' },
        },
      },
      async (args) => {
        const review = await store.writeReview(args.week === undefined ? weekLabel() : String(args.week))
        return { text: `已生成 ${review.week} 复盘：\n\n${review.body}` }
      },
    ),
  ]
}

/**
 * Render the board slice requested by the model.
 * @param {import('./store.js').LifePMStore} store
 * @param {Record<string, any>} args
 * @returns {Promise<string>}
 */
async function boardText(store, args) {
  const view = String(args.view ?? 'overview')
  const limit = Math.min(120, Math.max(1, Number(args.limit ?? 60)))
  const [meta, tasks, projects, inbox] = await Promise.all([store.meta(), store.listTasks(), store.listProjects(), store.inbox()])
  const today = todayISO()

  if (view === 'inbox') {
    if (inbox.length === 0) return '收件箱是空的。'
    return [`收件箱 ${inbox.length} 条：`, ...inbox.map((item) => `${item.index}. ${item.text}${item.channel !== 'app' ? `（${item.channel}）` : ''}`)].join('\n')
  }

  if (view === 'projects') {
    if (projects.length === 0) return '还没有项目。'
    const lines = ['项目：']
    for (const project of projects) {
      const owned = tasks.filter((task) => task.project === project.id)
      const done = owned.filter((task) => task.status === 'done').length
      lines.push(`- ${project.name}（${project.id}）· ${project.status}${project.owner ? ` · ${OWNER_LABEL[project.owner]}` : ''}${project.target ? ` · 目标 ${project.target}` : ''} · ${done}/${owned.length} 完成`)
      if (project.next) lines.push(`  下一步：${project.next}`)
      if (project.why) lines.push(`  为什么：${project.why}`)
    }
    return lines.join('\n')
  }

  if (view === 'journal') {
    const days = await store.journalDays(5)
    if (days.length === 0) return '还没有日记。'
    const lines = []
    for (const day of days) {
      lines.push(`${day.date}`)
      for (const entry of day.entries) lines.push(`  [${entry.time} ${entry.kind}] ${entry.text.replace(/\n/g, ' ')}`)
    }
    return lines.join('\n')
  }

  if (view === 'review') {
    const review = await store.review(args.week === undefined ? weekLabel() : String(args.week))
    return review.body === '' ? '本周还没有复盘。可以调用 pm_review 生成。' : review.body
  }

  const filtered = tasks.filter((task) => {
    if (args.status !== undefined && task.status !== args.status) return false
    if (args.project !== undefined && task.project !== args.project && task.project !== undefined) {
      const project = projects.find((item) => item.id === args.project)
      if (project === undefined || task.project !== project.name) return false
    }
    if (args.query !== undefined && !task.title.toLowerCase().includes(String(args.query).toLowerCase())) return false
    return true
  })

  if (view === 'tasks') {
    if (filtered.length === 0) return '没有匹配的事项。'
    const rows = [...filtered].sort(compareTasks).slice(0, limit)
    return [`匹配 ${filtered.length} 条：`, ...rows.map((task) => taskLine(task))].join('\n')
  }

  const stats = computeStats(tasks, inbox)
  const open = tasks.filter((task) => task.status !== 'done' && task.status !== 'dropped')
  const pinned = open.filter((task) => task.pin)
  const now = open.filter((task) => task.status === 'now')
  const waiting = open.filter((task) => task.status === 'waiting')
  const dueSoon = open
    .filter((task) => task.due !== undefined && task.due >= today)
    .sort((left, right) => String(left.due).localeCompare(String(right.due)))
    .slice(0, 8)
  const overdue = open.filter((task) => task.due !== undefined && task.due < today)
  const lines = [`# LifePM · ${today}`]
  if (meta.focus !== '') lines.push(`主线：${meta.focus}`)
  if (meta.bet !== '') lines.push(`本季赌注：${meta.bet}`)
  lines.push(`现在 ${stats.now} · 接下来 ${stats.next} · 等待 ${stats.waiting} · 收件箱 ${stats.inboxTasks}${stats.inbox > 0 ? `+${stats.inbox} 条原始捕获` : ''} · 本周完成 ${stats.doneThisWeek}`)
  if (pinned.length > 0) {
    lines.push('', '今天的三件事：')
    for (const task of pinned) lines.push(`- ${task.title}${task.project ? ` · ${task.project}` : ''}${task.due ? ` · ${task.due}` : ''} （${task.id}）`)
  }
  if (now.length > 0) {
    lines.push('', '现在做：')
    for (const task of now.slice(0, limit)) lines.push(taskLine(task))
  }
  if (waiting.length > 0) {
    lines.push('', '在等：')
    for (const task of waiting.slice(0, 20)) lines.push(taskLine(task))
  }
  if (overdue.length > 0) {
    lines.push('', `逾期 ${overdue.length} 件：`)
    for (const task of overdue.slice(0, 10)) lines.push(taskLine(task))
  }
  if (dueSoon.length > 0) {
    lines.push('', '到期：')
    for (const task of dueSoon) lines.push(taskLine(task))
  }
  if (projects.length > 0) {
    lines.push('', '项目：')
    for (const project of projects.slice(0, 12)) {
      const owned = tasks.filter((task) => task.project === project.id)
      const done = owned.filter((task) => task.status === 'done').length
      lines.push(`- ${project.name} · ${project.status} · ${done}/${owned.length}${project.next ? ` · 下一步 ${project.next}` : ''}`)
    }
  }
  if (inbox.length > 0) lines.push('', `收件箱 ${inbox.length} 条待整理（pm_triage）。`)
  return lines.join('\n')
}

/** @param {Record<string, any>} task */
function taskLine(task) {
  const bits = []
  if (task.priority) bits.push(task.priority)
  bits.push(task.title)
  if (task.project) bits.push(`· ${task.project}`)
  if (task.owner) bits.push(`· ${OWNER_LABEL[task.owner]}`)
  if (task.due) bits.push(`· ${task.due}`)
  if (task.waiting_on) bits.push(`· 等 ${task.waiting_on}`)
  return `- ${bits.join(' ')} （${task.id}）`
}
