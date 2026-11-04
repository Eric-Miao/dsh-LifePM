import React, { useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { usePM } from './context.js'
import {
  OPEN_STATUSES,
  STATUS_HINTS,
  STATUS_LABELS,
  areaHue,
  clip,
  describeDue,
  formatStamp,
  ownerInitial,
} from './format.js'
import { Button, Icon, IconButton } from './ui.jsx'
import { QuickAdd } from './quickadd.jsx'

const COLUMN_ORDER = OPEN_STATUSES

/** The whole board: today strip, stats, columns. */
export function BoardView({ blank = false }) {
  return blank === true ? React.createElement(BlankState) : React.createElement(BoardInner)
}

/** Mounted board; hooks live here so the blank state can short-circuit safely. */
function BoardInner() {
  const { data } = usePM()
  const groups = useMemo(() => {
    const map = { inbox: [], now: [], next: [], waiting: [], someday: [], done: [] }
    for (const task of data.tasks) {
      if (task.status === 'dropped') continue
      ;(map[task.status] ?? map.inbox).push(task)
    }
    map.done = [...map.done].sort((left, right) => String(right.done_at ?? right.updated ?? '').localeCompare(String(left.done_at ?? left.updated ?? '')))
    return map
  }, [data.tasks])
  const [showDone, setShowDone] = useState(false)
  const [dragging, setDragging] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const { act } = usePM()

  const moveTask = async (id, status) => {
    if (id === null) return
    void act(() => api.updateTask(id, { status }), `已移到「${STATUS_LABELS[status] ?? status}」`)
  }

  return React.createElement('div', { className: 'lpm-view' },
    React.createElement(TodayStrip, null),
    React.createElement(StatsLine, null),
    React.createElement('div', { className: 'lpm-board' },
      COLUMN_ORDER.map((status) => React.createElement(Column, {
        key: status,
        status,
        tasks: groups[status],
        dragging,
        isDrop: dropTarget === status,
        onDragStart: (id) => setDragging(id),
        onDragEnd: () => {
          setDragging(null)
          setDropTarget(null)
        },
        onDragOver: (over) => setDropTarget(over ? status : null),
        onDrop: (id) => {
          setDropTarget(null)
          setDragging(null)
          void moveTask(id, status)
        },
      })),
      showDone
        ? React.createElement(Column, {
            key: 'done',
            status: 'done',
            tasks: groups.done,
            dragging,
            isDrop: dropTarget === 'done',
            doneColumn: true,
            onDragStart: (id) => setDragging(id),
            onDragEnd: () => {
              setDragging(null)
              setDropTarget(null)
            },
            onDragOver: (over) => setDropTarget(over ? 'done' : null),
            onDrop: (id) => {
              setDropTarget(null)
              setDragging(null)
              void moveTask(id, 'done')
            },
          })
        : null),
    React.createElement('div', { className: 'lpm-stats', style: { paddingTop: 10 } },
      React.createElement('button', {
        type: 'button',
        className: 'lpm-btn lpm-btn-sm lpm-btn-ghost',
        onClick: () => setShowDone((current) => !current),
      }, showDone ? '收起已完成' : `显示已完成（${groups.done.length}）`),
      React.createElement('span', { className: 'lpm-sep' }),
      React.createElement('span', { className: 'lpm-muted' }, '本周完成 ', React.createElement('b', { style: { fontFamily: 'var(--lpm-serif)' } }, data.stats.doneThisWeek), ' 件')))
}

/** Pinned three things for today. */
function TodayStrip() {
  const { data, act, openTask } = usePM()
  const open = data.tasks.filter((task) => task.status !== 'done' && task.status !== 'dropped')
  const pinned = open.filter((task) => task.pin)
  const [working, setWorking] = useState(false)

  const complete = (task) => {
    void act(() => api.updateTask(task.id, { status: 'done' }), `完成：${clip(task.title, 24)}`)
  }

  const autoPick = async () => {
    setWorking(true)
    try {
      await act(() => api.focusToday(), '已挑出今天的三件事')
    } finally {
      setWorking(false)
    }
  }

  return React.createElement('section', { className: 'lpm-today', 'aria-label': '今日三件事' },
    React.createElement('div', { className: 'lpm-today-label' },
      React.createElement('b', null, 'TODAY'),
      React.createElement('span', null, pinned.length > 0 ? `你说今天要碰的 ${pinned.length} 件` : '今天碰哪三件？')),
    React.createElement('div', { className: 'lpm-today-list' },
      pinned.length === 0
        ? React.createElement('div', { className: 'lpm-today-empty' },
            React.createElement('span', null, '还没有挑今天的重点。'),
            React.createElement(Button, { size: 'sm', variant: 'quiet', icon: 'sparkle', disabled: working, onClick: () => void autoPick() },
              working ? '挑选中…' : '自动挑 3 件'))
        : pinned.map((task) => React.createElement('div', { key: task.id, className: 'lpm-today-item' },
            React.createElement('button', {
              type: 'button',
              className: 'lpm-check',
              'aria-label': `完成 ${task.title}`,
              onClick: () => complete(task),
            }, React.createElement(Icon, { name: 'check', size: 10 })),
            React.createElement('button', {
              type: 'button',
              style: { border: 0, background: 'transparent', padding: 0, textAlign: 'left', color: 'inherit', font: 'inherit' },
              onClick: () => openTask(task.id),
              title: task.title,
            }, task.title)))),
    React.createElement('div', { className: 'lpm-today-side' },
      pinned.length > 0 && pinned.length < 3
        ? React.createElement(Button, { size: 'sm', variant: 'ghost', icon: 'plus', disabled: working, onClick: () => void autoPick() }, '再挑一件')
        : null))
}

/** One-line numbers. */
function StatsLine() {
  const { data } = usePM()
  const stats = data.stats
  return React.createElement('div', { className: 'lpm-stats' },
    React.createElement('span', { className: 'lpm-stat' }, React.createElement('b', null, stats.now), '现在'),
    React.createElement('span', { className: 'lpm-sep' }),
    React.createElement('span', { className: 'lpm-stat' }, React.createElement('b', null, stats.waiting), '等待'),
    React.createElement('span', { className: 'lpm-sep' }),
    React.createElement('span', { className: 'lpm-stat' }, React.createElement('b', null, stats.inboxTasks + stats.inbox), '收件箱'),
    React.createElement('span', { className: 'lpm-sep' }),
    React.createElement('span', { className: 'lpm-stat' }, React.createElement('b', null, stats.dueToday), '今天到期'),
    stats.overdue > 0
      ? React.createElement(React.Fragment, null,
          React.createElement('span', { className: 'lpm-sep' }),
          React.createElement('span', { className: 'lpm-stat', style: { color: 'var(--lpm-danger)' } }, React.createElement('b', { style: { color: 'var(--lpm-danger)' } }, stats.overdue), '逾期'))
      : null)
}

/** One board column. */
function Column({ status, tasks, dragging, isDrop, onDragStart, onDragEnd, onDragOver, onDrop, doneColumn = false }) {
  const { data } = usePM()
  const [adding, setAdding] = useState(false)
  const dropRef = useRef(null)

  const onDragOverEvent = (event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    onDragOver(true)
  }

  return React.createElement('section', {
    className: `lpm-col ${isDrop ? 'is-drop' : ''} ${doneColumn ? 'is-done-col' : ''}`.trim(),
    'data-status': status,
    ref: dropRef,
    onDragOver: onDragOverEvent,
    onDragLeave: (event) => {
      if (dropRef.current !== null && !dropRef.current.contains(event.relatedTarget)) onDragOver(false)
    },
    onDrop: (event) => {
      event.preventDefault()
      const id = event.dataTransfer.getData('text/plain') || dragging
      if (id !== null && id !== undefined && id !== '') onDrop(id)
    },
  },
  React.createElement('header', { className: 'lpm-col-head' },
    React.createElement('span', { className: 'lpm-col-dot' }),
    React.createElement('span', { className: 'lpm-col-title' }, STATUS_LABELS[status]),
    React.createElement('span', { className: 'lpm-col-count' }, tasks.length + (status === 'inbox' ? data.inbox.length : 0)),
    React.createElement('span', { className: 'lpm-spacer' }),
    doneColumn ? null : React.createElement(IconButton, {
      icon: 'plus',
      label: `在「${STATUS_LABELS[status]}」里添加`,
      onClick: () => setAdding(true),
    })),
  React.createElement('div', { className: 'lpm-col-body' },
    status === 'inbox' ? React.createElement(InboxCaptures) : null,
    tasks.map((task) => React.createElement(TaskCard, {
      key: task.id,
      task,
      people: data.meta.people,
      areas: data.meta.areas,
      projects: data.projects,
      onDragStart,
      onDragEnd,
    })),
    !doneColumn && tasks.length === 0 && status !== 'inbox'
      ? React.createElement('div', { className: 'lpm-col-empty' }, '拖到这里')
      : null,
    doneColumn && tasks.length === 0
      ? React.createElement('div', { className: 'lpm-col-empty' }, '这一周还没完成的事')
      : null,
    !doneColumn && adding
      ? React.createElement(QuickAdd, {
          status,
          autoFocus: true,
          onDone: () => setAdding(false),
        })
      : null),
  )
}

/** Raw captures waiting to be triaged, rendered above inbox tasks. */
function InboxCaptures() {
  const { data, act } = usePM()
  const [busyIndex, setBusyIndex] = useState(null)
  if (data.inbox.length === 0) return null
  const visible = data.inbox.slice(0, 6)
  const hidden = data.inbox.length - visible.length

  const promote = async (index) => {
    setBusyIndex(index)
    try {
      await act(() => api.promoteInbox(index, { status: 'next' }), '已转为任务')
    } finally {
      setBusyIndex(null)
    }
  }

  const drop = async (index) => {
    setBusyIndex(index)
    try {
      await act(() => api.removeInbox(index), '已丢弃')
    } finally {
      setBusyIndex(null)
    }
  }

  return React.createElement(React.Fragment, null,
    visible.map((item) => React.createElement('div', { key: `${item.line}-${item.index}`, className: 'lpm-inbox-item' },
      React.createElement('p', null,
        clip(item.text, 120),
        React.createElement('span', { className: 'lpm-inbox-meta' },
          `${item.channel === 'app' ? '快速捕获' : item.channel}${item.createdAt === undefined ? '' : ` · ${formatStamp(item.createdAt)}`}`)),
      React.createElement('div', { className: 'lpm-inbox-actions' },
        React.createElement(IconButton, {
          icon: 'arrow',
          label: '转为任务',
          disabled: busyIndex === item.index,
          onClick: () => void promote(item.index),
        }),
        React.createElement(IconButton, {
          icon: 'trash',
          label: '丢弃',
          className: 'is-danger',
          disabled: busyIndex === item.index,
          onClick: () => void drop(item.index),
        })))),
    hidden > 0
      ? React.createElement('div', { className: 'lpm-muted', style: { fontSize: 11, padding: '2px 2px 0' } }, `还有 ${hidden} 条待整理`)
      : null,
    React.createElement('div', { style: { height: 2 } }))
}

/** One task card. */
export function TaskCard({ task, people, areas, projects, onDragStart, onDragEnd, compact = false }) {
  const { openTask, act } = usePM()
  const [dragging, setDragging] = useState(false)
  const due = describeDue(task.due)
  const project = projects.find((item) => item.id === task.project || item.name === task.project)
  const area = (areas ?? []).find((item) => item.id === task.area)
  const done = task.status === 'done'

  const complete = (event) => {
    event.stopPropagation()
    void act(() => api.updateTask(task.id, { status: done ? 'now' : 'done' }), done ? '已重新打开' : `完成：${clip(task.title, 24)}`)
  }

  return React.createElement('article', {
    className: `lpm-card ${done ? 'is-done' : ''} ${dragging ? 'is-dragging' : ''}`.trim(),
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.setData('text/plain', task.id)
      event.dataTransfer.effectAllowed = 'move'
      setDragging(true)
      onDragStart?.(task.id)
    },
    onDragEnd: () => {
      setDragging(false)
      onDragEnd?.()
    },
    onClick: () => openTask(task.id),
    role: 'button',
    tabIndex: 0,
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openTask(task.id)
      }
    },
    'aria-label': task.title,
  },
  React.createElement('button', {
    type: 'button',
    className: `lpm-check ${done ? 'is-checked' : ''}`.trim(),
    'aria-label': done ? '重新打开' : '完成',
    onClick: complete,
  }, done ? React.createElement(Icon, { name: 'check', size: 10 }) : null),
  React.createElement('div', { className: 'lpm-card-main' },
    React.createElement('div', { className: 'lpm-card-title' },
      task.priority === 'p0' ? React.createElement('span', { className: 'lpm-pri', style: { marginRight: 5 } }, '!') : null,
      task.title),
    (project !== undefined || due !== null || task.owner !== undefined || area !== undefined || task.priority === 'p1')
      ? React.createElement('div', { className: 'lpm-card-meta' },
          project !== undefined
            ? React.createElement('span', { className: 'lpm-chip' },
                React.createElement('span', { className: 'lpm-huedot', style: { background: `hsl(${areaHue(project.area ?? project.id)} 45% 52%)` } }),
                clip(project.name, 14))
            : area !== undefined
              ? React.createElement('span', { className: 'lpm-chip' },
                  React.createElement('span', { className: 'lpm-huedot', style: { background: `hsl(${areaHue(area.id)} 45% 52%)` } }),
                  area.name)
              : null,
          due !== null ? React.createElement('span', { className: 'lpm-due', 'data-state': due.state },
            React.createElement(Icon, { name: 'calendar', size: 11 }),
            due.text) : null,
          task.status === 'waiting' && task.waiting_on !== undefined
            ? React.createElement('span', { className: 'lpm-due', title: task.waiting_on },
                React.createElement(Icon, { name: 'clock', size: 11 }),
                clip(task.waiting_on, 10))
            : null,
          React.createElement('span', { style: { flex: '1 1 auto' } }),
          task.owner !== undefined
            ? React.createElement('span', { className: 'lpm-avatar', 'data-owner': task.owner, title: `负责：${task.owner === 'both' ? '两个人' : task.owner === 'me' ? '我' : 'TA'}` },
                ownerInitial(task.owner, people))
            : null)
      : null,
    compact !== true && task.notes !== ''
      ? React.createElement('div', { className: 'lpm-card-note' }, clip(task.notes, 110))
      : null))
}

/** First-run hero for an empty store. */
function BlankState() {
  const { data, act, goTo, showToast } = usePM()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  const submit = async () => {
    const value = text.trim()
    if (value === '') return
    setBusy(true)
    const result = await act(() => api.createTask({ quickAdd: value, status: 'inbox' }), '收了。继续倒，别整理。')
    setBusy(false)
    if (result !== null) {
      setText('')
      inputRef.current?.focus()
    }
  }

  const loadDemo = async () => {
    setBusy(true)
    const result = await act(() => api.seedDemo(), '示例已载入，随便看看')
    setBusy(false)
    if (result !== null) showToast(`${result.created} 件事 · ${result.projects} 个项目`)
  }

  return React.createElement('div', { className: 'lpm-view' },
    React.createElement('div', { className: 'lpm-hero' },
      React.createElement('div', { className: 'lpm-eyebrow' }, React.createElement('span', { className: 'lpm-dot' }), '从这一句开始'),
      React.createElement('h1', null, '把脑子里的东西，', React.createElement('br'), '先倒出来。'),
      React.createElement('p', null,
        '你和 TA 的人生正在同时发生很多事：想试的、必须办的、还没想清楚的。先不用分类——写下来，收进收件箱，再一起决定这个季度真正要押注的是什么。'),
      React.createElement('div', { style: { display: 'flex', gap: 10, width: '100%', maxWidth: 560 } },
        React.createElement('input', {
          ref: inputRef,
          className: 'lpm-input',
          style: { height: 40, fontSize: 13.5 },
          value: text,
          placeholder: '比如：这周末想去看两个场地',
          disabled: busy,
          onChange: (event) => setText(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          },
          'aria-label': '记下第一件事',
        }),
        React.createElement(Button, { variant: 'accent', size: 'lg', icon: 'plus', disabled: busy || text.trim() === '', onClick: () => void submit() }, '收下')),
      React.createElement('div', { className: 'lpm-hero-syntax' },
        React.createElement('span', null, '快捷语法：'),
        React.createElement('code', null, '#项目'),
        React.createElement('code', null, '@我'),
        React.createElement('code', null, '!p1'),
        React.createElement('code', null, 'due:周五')),
      React.createElement('div', { className: 'lpm-hero-row' },
        React.createElement(Button, { variant: 'quiet', icon: 'sparkle', disabled: busy, onClick: () => void loadDemo() }, '先看看示例长什么样'),
        React.createElement(Button, { variant: 'ghost', icon: 'link', onClick: () => goTo('settings') }, '接入微信 / 飞书 / Telegram')),
      React.createElement('p', { className: 'lpm-help' },
        '数据会以 Markdown 存在 ',
        React.createElement('span', { className: 'lpm-mono' }, data.dataDir),
        '，你随时可以直接改文件，或者放进 git。')),
  )
}
