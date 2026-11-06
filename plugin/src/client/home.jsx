import React, { useMemo, useState } from 'react'
import { api } from './api.js'
import { usePM } from './context.js'
import { formatDateLong, weekStartISO } from './format.js'
import { ProjectRow } from './projects.jsx'
import { Button, Icon, IconButton, Modal } from './ui.jsx'

/** "This week" home: a soft focus list plus the project control panel. */
export function HomeView({ blank = false }) {
  return blank === true ? React.createElement(BlankHome) : React.createElement(HomeInner)
}

function HomeInner() {
  const { data, goTo } = usePM()
  const [picking, setPicking] = useState(false)
  const focus = data.focus ?? []
  const active = useMemo(
    () => data.projects.filter((project) => project.status === 'active').sort((left, right) => String(right.last_active ?? '').localeCompare(String(left.last_active ?? ''))),
    [data.projects],
  )
  const paused = data.projects.filter((project) => project.status === 'paused')

  return React.createElement('div', { className: 'lpm-view lpm-home' },
    React.createElement('div', { className: 'lpm-home-intro' },
      React.createElement('div', null,
        React.createElement('h2', null, formatDateLong(data.today)),
        React.createElement('p', null, focus.length === 0 ? '这周想做点什么？不用先决定，看看项目也行。' : `本周想做 ${focus.length} 件。没有上限，随时可以加减。`)),
      React.createElement(Button, { size: 'sm', variant: 'quiet', icon: 'plus', onClick: () => setPicking(true) }, '挑几件')),
    React.createElement(FocusSection, { focus }),
    React.createElement('section', { className: 'lpm-portfolio-group' },
      React.createElement('header', { className: 'lpm-portfolio-head' },
        React.createElement('h2', null, '项目'),
        React.createElement('span', null, active.length),
        React.createElement('p', null, '每条线一个下一步。上次动过多久，只显示，不评判。'),
        React.createElement(Button, { size: 'sm', variant: 'ghost', onClick: () => goTo('projects') }, '管理')),
      active.map((project) => React.createElement(ProjectRow, {
        key: project.id,
        project,
        tasks: data.tasks,
        people: data.meta.people,
        showEdit: false,
      })),
      paused.length > 0
        ? React.createElement('p', { className: 'lpm-home-paused' }, `还有 ${paused.length} 个项目暂停着。`, React.createElement('button', { type: 'button', onClick: () => goTo('projects') }, '去看'))
        : null),
    React.createElement(WeekEvidence, null),
    data.inbox.length > 0
      ? React.createElement('p', { className: 'lpm-home-inbox' },
          `收件箱还有 ${data.inbox.length} 条。`,
          React.createElement('button', { type: 'button', onClick: () => goTo('board') }, '去整理'))
      : null,
    picking ? React.createElement(FocusPicker, { onClose: () => setPicking(false) }) : null)
}

/** Focus list with per-row complete/remove. */
function FocusSection({ focus }) {
  const { act, openTask } = usePM()
  return React.createElement('section', { className: 'lpm-week-focus' },
    React.createElement('header', { className: 'lpm-week-focus-head' },
      React.createElement('h2', null, '本周想做'),
      focus.length > 0 ? React.createElement('span', null, `${focus.length} 件`) : null),
    focus.length === 0
      ? React.createElement('p', { className: 'lpm-week-focus-empty' }, '还没有挑。挑几件，或者先看看下面的项目。')
      : focus.map((task) => React.createElement('div', { key: task.id, className: 'lpm-week-focus-row' },
          React.createElement('button', {
            type: 'button',
            className: 'lpm-check',
            'aria-label': `完成 ${task.title}`,
            onClick: () => void act(() => api.updateTask(task.id, { status: 'done' }), '完成'),
          }, React.createElement(Icon, { name: 'check', size: 10 })),
          React.createElement('button', {
            type: 'button',
            className: 'lpm-week-focus-title',
            onClick: () => openTask(task.id),
          }, task.title),
          task.project === undefined ? null : React.createElement('span', { className: 'lpm-chip' }, task.project),
          React.createElement(IconButton, {
            icon: 'close',
            label: '移出本周',
            className: 'lpm-week-focus-remove',
            onClick: () => void act(() => api.updateTask(task.id, { focus: false }), '已移出本周'),
          }))))
}

/** Pick any open tasks into the weekly lens; no quota. */
function FocusPicker({ onClose }) {
  const { data, act } = usePM()
  const [query, setQuery] = useState('')
  const focused = new Set((data.focus ?? []).map((task) => task.id))
  const groups = useMemo(() => {
    const nameOf = (id) => data.projects.find((project) => project.id === id || project.name === id)?.name ?? id
    const map = new Map()
    const needle = query.trim().toLowerCase()
    for (const task of data.tasks) {
      if (task.status === 'done' || task.status === 'dropped') continue
      if (needle !== '' && !task.title.toLowerCase().includes(needle)) continue
      const key = task.project === undefined ? '未归属' : nameOf(task.project)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(task)
    }
    return [...map.entries()].sort((left, right) => left[0].localeCompare(right[0], 'zh'))
  }, [data.tasks, data.projects, query])

  const toggle = (task) => {
    void act(() => api.updateTask(task.id, { focus: !focused.has(task.id) }))
  }

  return React.createElement(Modal, {
    title: '挑几件本周想做',
    subtitle: '想挑多少挑多少。它只是本周的视角，不是承诺。',
    onClose,
    width: 620,
    footer: React.createElement(Button, { size: 'sm', variant: 'primary', onClick: onClose }, '好了'),
  },
  React.createElement('input', {
    className: 'lpm-input',
    value: query,
    placeholder: '搜索…',
    autoFocus: true,
    onChange: (event) => setQuery(event.target.value),
    'aria-label': '搜索事项',
  }),
  groups.length === 0
    ? React.createElement('p', { className: 'lpm-muted' }, '没有可挑的事项。')
    : groups.map(([project, tasks]) => React.createElement('div', { key: project, className: 'lpm-picker-group' },
        React.createElement('h4', null, project),
        tasks.map((task) => React.createElement('label', { key: task.id, className: 'lpm-picker-row' },
          React.createElement('input', {
            type: 'checkbox',
            checked: focused.has(task.id),
            onChange: () => toggle(task),
          }),
          React.createElement('span', null, task.title),
          React.createElement('em', null, task.status === 'now' ? '候选' : task.status === 'next' ? '接下来' : ''))))))
}

/** Evidence: what actually moved this week. */
function WeekEvidence() {
  const { data } = usePM()
  const start = weekStartISO()
  const done = data.tasks.filter((task) => task.status === 'done' && typeof task.done_at === 'string' && task.done_at.slice(0, 10) >= start)
  const moved = data.projects.filter((project) => typeof project.last_active === 'string' && project.last_active.slice(0, 10) >= start)
  return React.createElement('section', { className: 'lpm-evidence' },
    React.createElement('h3', null, '本周动过'),
    done.length === 0 && moved.length === 0
      ? React.createElement('p', null, '还没什么动静。做了就有了。')
      : React.createElement('p', null,
          done.length > 0 ? `完成 ${done.length} 件` : null,
          done.length > 0 && moved.length > 0 ? ' · ' : null,
          moved.length > 0 ? `${moved.length} 个项目有动作：${moved.slice(0, 6).map((project) => project.name).join('、')}` : null),
    done.length > 0
      ? React.createElement('div', { className: 'lpm-evidence-done' }, done.slice(0, 8).map((task) => React.createElement('span', { key: task.id }, task.title)))
      : null)
}

/** Empty store: a calm first move. */
function BlankHome() {
  const { data, act } = usePM()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    const value = text.trim()
    if (value === '') return
    setBusy(true)
    const result = await act(() => api.createTask({ quickAdd: value, status: 'now' }), '先放进「候选」')
    setBusy(false)
    if (result !== null) setText('')
  }
  return React.createElement('div', { className: 'lpm-view lpm-hero' },
    React.createElement('div', { className: 'lpm-eyebrow' }, React.createElement('span', { className: 'lpm-dot' }), '从一件小事开始'),
    React.createElement('h1', null, '这周想做什么？'),
    React.createElement('p', null, '不用先建项目，也不用分类。写下一件事，它会进「候选」。'),
    React.createElement('div', { className: 'lpm-hero-row' },
      React.createElement('input', {
        className: 'lpm-input',
        style: { height: 40, minWidth: 320 },
        value: text,
        placeholder: '例如：把 tsti 英文版过一遍',
        onChange: (event) => setText(event.target.value),
        onKeyDown: (event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void submit()
          }
        },
      }),
      React.createElement(Button, { variant: 'accent', size: 'lg', disabled: busy || text.trim() === '', onClick: () => void submit() }, '收下')),
    React.createElement('p', { className: 'lpm-help' }, '数据在 ', React.createElement('span', { className: 'lpm-mono' }, data.dataDir), '，随时可以改。'))
}
