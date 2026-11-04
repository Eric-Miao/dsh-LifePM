import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { usePM } from './context.js'
import { PRIORITY_LABELS, STATUS_HINTS, STATUS_LABELS, formatStamp } from './format.js'
import { Button, Field, Icon, IconButton, Segmented, Toggle } from './ui.jsx'

const STATUS_OPTIONS = ['inbox', 'now', 'next', 'waiting', 'someday', 'done'].map((value) => ({
  value,
  label: STATUS_LABELS[value],
  hint: STATUS_HINTS[value],
}))

const OWNER_OPTIONS = [
  { value: 'me', label: '我' },
  { value: 'partner', label: 'TA' },
  { value: 'both', label: '我们' },
  { value: 'none', label: '不定' },
]

/** Right-side task editor. */
export function TaskDrawer({ task, onClose }) {
  const { data, act, showToast } = usePM()
  const [draft, setDraft] = useState(() => toDraft(task))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [titleFocused, setTitleFocused] = useState(false)
  const titleRef = useRef(null)
  const bodyRef = useRef(null)

  useEffect(() => {
    setDraft(toDraft(task))
    setConfirmDelete(false)
    if (titleRef.current !== null) titleRef.current.style.height = '0px'
  }, [task.id])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (titleRef.current === null) return
    titleRef.current.style.height = '0px'
    titleRef.current.style.height = `${titleRef.current.scrollHeight}px`
  }, [draft.title, titleFocused])

  const baseline = useMemo(() => toDraft(task), [task])
  const dirty = JSON.stringify(baseline) !== JSON.stringify(draft)

  const update = (patch) => setDraft((current) => ({ ...current, ...patch }))

  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    const payload = {
      title: draft.title.trim() === '' ? task.title : draft.title.trim(),
      status: draft.status,
      owner: draft.owner === 'none' ? null : draft.owner,
      project: draft.project === '' ? null : draft.project,
      area: draft.area === '' ? null : draft.area,
      priority: draft.priority === '' ? null : draft.priority,
      due: draft.due === '' ? null : draft.due,
      pin: draft.pin,
      waiting_on: draft.waitingOn === '' ? null : draft.waitingOn,
      notes: draft.notes,
    }
    const result = await act(() => api.updateTask(task.id, payload), '已保存')
    setSaving(false)
    if (result !== null) onClose()
  }

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    const result = await act(() => api.deleteTask(task.id), '已删除')
    if (result !== null) onClose()
  }

  const openProjectModal = () => {
    showToast('先在「项目」页新建项目，再回来关联', 'error')
  }

  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'lpm-drawer-backdrop', onClick: onClose }),
    React.createElement('aside', { className: 'lpm-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '事项详情' },
      React.createElement('header', { className: 'lpm-drawer-head' },
        React.createElement('h2', null, '事项'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
          dirty ? React.createElement('span', { className: 'lpm-muted', style: { fontSize: 10.5, marginRight: 4 } }, '未保存') : null,
          React.createElement(IconButton, { icon: 'close', label: '关闭', onClick: onClose }))),
      React.createElement('div', { className: 'lpm-drawer-body', ref: bodyRef },
        React.createElement('textarea', {
          ref: titleRef,
          className: 'lpm-title-input',
          rows: 1,
          value: draft.title,
          onChange: (event) => update({ title: event.target.value }),
          onFocus: () => setTitleFocused(true),
          onBlur: () => setTitleFocused(false),
          'aria-label': '标题',
        }),
        React.createElement(Field, { label: '状态' },
          React.createElement(Segmented, {
            value: draft.status,
            options: STATUS_OPTIONS,
            onChange: (value) => update({ status: value }),
            ariaLabel: '状态',
          })),
        React.createElement(Field, { label: '谁负责' },
          React.createElement(Segmented, {
            value: draft.owner ?? 'none',
            options: OWNER_OPTIONS,
            onChange: (value) => update({ owner: value === 'none' ? null : value }),
            ariaLabel: '负责人',
          })),
        React.createElement('div', { className: 'lpm-grid-2' },
          React.createElement(Field, { label: '项目' },
            React.createElement('div', { className: 'lpm-row', style: { gap: 4 } },
              React.createElement('select', {
                className: 'lpm-select',
                value: draft.project,
                onChange: (event) => update({ project: event.target.value }),
                'aria-label': '项目',
              },
              React.createElement('option', { value: '' }, '未归属'),
              data.projects.map((project) => React.createElement('option', { key: project.id, value: project.id }, project.name)),
              draft.project !== '' && !data.projects.some((project) => project.id === draft.project)
                ? React.createElement('option', { value: draft.project }, draft.project)
                : null),
              React.createElement(IconButton, { icon: 'plus', label: '新建项目', onClick: openProjectModal }))),
          React.createElement(Field, { label: '领域' },
            React.createElement('select', {
              className: 'lpm-select',
              value: draft.area,
              onChange: (event) => update({ area: event.target.value }),
              'aria-label': '领域',
            },
            React.createElement('option', { value: '' }, '未归类'),
            data.meta.areas.map((area) => React.createElement('option', { key: area.id, value: area.id }, area.name))))),
        React.createElement('div', { className: 'lpm-grid-2' },
          React.createElement(Field, { label: '优先级' },
            React.createElement('select', {
              className: 'lpm-select',
              value: draft.priority,
              onChange: (event) => update({ priority: event.target.value }),
              'aria-label': '优先级',
            },
            React.createElement('option', { value: '' }, '未定'),
            ['p0', 'p1', 'p2', 'p3'].map((value) => React.createElement('option', { key: value, value }, `${value} · ${PRIORITY_LABELS[value]}`)))),
          React.createElement(Field, { label: '截止日' },
            React.createElement('input', {
              className: 'lpm-input',
              type: 'date',
              value: draft.due,
              onChange: (event) => update({ due: event.target.value }),
              'aria-label': '截止日',
            }))),
        React.createElement('div', { className: 'lpm-row' },
          React.createElement(Button, { size: 'sm', variant: 'quiet', onClick: () => update({ due: todayISO() }) }, '今天'),
          React.createElement(Button, { size: 'sm', variant: 'quiet', onClick: () => update({ due: shiftDate(1) }) }, '明天'),
          React.createElement(Button, { size: 'sm', variant: 'quiet', onClick: () => update({ due: shiftDate(7) }) }, '下周'),
          React.createElement('span', { style: { flex: '1 1 auto' } }),
          draft.due !== ''
            ? React.createElement(Button, { size: 'sm', variant: 'ghost', onClick: () => update({ due: '' }) }, '清除日期')
            : null),
        React.createElement('div', { className: 'lpm-toggle-row' },
          React.createElement('span', null, '放进「今天的三件事」'),
          React.createElement(Toggle, {
            checked: draft.pin,
            onChange: (value) => update({ pin: value }),
            label: '放进今天',
          })),
        draft.status === 'waiting'
          ? React.createElement(Field, { label: '在等什么', hint: '人 / 条件 / 回复' },
              React.createElement('input', {
                className: 'lpm-input',
                value: draft.waitingOn,
                placeholder: '例如：等对方回复、等预算批下来',
                onChange: (event) => update({ waitingOn: event.target.value }),
              }))
          : null,
        React.createElement(Field, { label: '笔记', hint: 'Markdown 正文' },
          React.createElement('textarea', {
            className: 'lpm-textarea',
            value: draft.notes,
            placeholder: '为什么做、卡在哪、和谁聊过…',
            onChange: (event) => update({ notes: event.target.value }),
          })),
        React.createElement('div', { className: 'lpm-drawer-meta' },
          React.createElement('span', null, `创建 ${formatStamp(task.created) || '—'}`),
          React.createElement('span', null, `更新 ${formatStamp(task.updated) || '—'}`),
          React.createElement('span', { className: 'lpm-mono' }, task.file))),
      React.createElement('footer', { className: 'lpm-drawer-foot' },
        React.createElement(Button, {
          variant: confirmDelete ? 'danger' : 'ghost',
          size: 'sm',
          icon: 'trash',
          onClick: () => void remove(),
        }, confirmDelete ? '确认删除？' : '删除'),
        React.createElement('span', { style: { flex: '1 1 auto' } }),
        React.createElement(Button, {
          size: 'sm',
          variant: 'ghost',
          icon: task.status === 'done' ? 'refresh' : 'check',
          onClick: () => void act(() => api.updateTask(task.id, { status: task.status === 'done' ? 'now' : 'done' }), task.status === 'done' ? '已重新打开' : '已完成').then((result) => { if (result !== null) onClose() }),
        }, task.status === 'done' ? '重新打开' : '完成'),
        React.createElement(Button, { size: 'sm', variant: 'primary', disabled: !dirty || saving, onClick: () => void save() }, saving ? '保存中…' : '保存')),
    ))
}

/** Editable copy of a task. */
function toDraft(task) {
  return {
    title: task.title ?? '',
    status: task.status ?? 'inbox',
    owner: task.owner ?? null,
    project: task.project ?? '',
    area: task.area ?? '',
    priority: task.priority ?? '',
    due: task.due ?? '',
    pin: task.pin === true,
    waitingOn: task.waiting_on ?? '',
    notes: task.notes ?? '',
  }
}

/** Browser-local today. */
function todayISO() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** @param {number} days */
function shiftDate(days) {
  const now = new Date()
  now.setDate(now.getDate() + days)
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
