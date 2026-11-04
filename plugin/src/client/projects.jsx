import React, { useMemo, useState } from 'react'
import { api } from './api.js'
import { usePM } from './context.js'
import { PROJECT_STATUS_LABELS, ownerInitial, projectProgress } from './format.js'
import { Button, Field, IconButton, Modal, Pill, Segmented } from './ui.jsx'

const PROJECT_OPTIONS = ['active', 'paused', 'idea', 'done', 'dropped'].map((value) => ({
  value,
  label: PROJECT_STATUS_LABELS[value],
}))

/** Project portfolio. */
export function ProjectsView() {
  const { data } = usePM()
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)

  const projects = useMemo(() => data.projects, [data.projects])

  return React.createElement('div', { className: 'lpm-view' },
    React.createElement('div', { className: 'lpm-section-head' },
      React.createElement('div', null,
        React.createElement('h2', null, '项目组合'),
        React.createElement('p', null, '每一条你想长期推进的线。项目不是任务，它需要一句「为什么」和一个「下一步」。')),
      React.createElement(Button, { variant: 'quiet', icon: 'plus', onClick: () => setCreating(true) }, '新建项目')),
    projects.length === 0
      ? React.createElement('div', { className: 'lpm-empty' },
          React.createElement('h2', null, '还没有项目'),
          React.createElement('p', null, '把一个正在发生、会持续几周以上的事情建成项目：搬家、婚礼、转行、备孕、读一个学位、把身体练回来。'),
          React.createElement(Button, { variant: 'quiet', icon: 'plus', onClick: () => setCreating(true) }, '建第一个项目'))
      : React.createElement('div', { className: 'lpm-projects' },
          projects.map((project) => React.createElement(ProjectCard, {
            key: project.id,
            project,
            tasks: data.tasks,
            people: data.meta.people,
            onOpen: () => setEditing(project),
          }))),
    creating
      ? React.createElement(ProjectModal, { project: null, onClose: () => setCreating(false) })
      : null,
    editing !== null
      ? React.createElement(ProjectModal, { project: editing, onClose: () => setEditing(null) })
      : null)
}

/** One project tile. */
function ProjectCard({ project, tasks, people, onOpen }) {
  const progress = projectProgress(project, tasks)
  const owned = tasks.filter((task) => (task.project === project.id || task.project === project.name) && task.status !== 'done' && task.status !== 'dropped')
  const nextTask = owned.find((task) => task.pin) ?? owned.find((task) => task.status === 'now') ?? owned[0]
  return React.createElement('article', {
    className: 'lpm-project',
    onClick: onOpen,
    role: 'button',
    tabIndex: 0,
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onOpen()
      }
    },
  },
  React.createElement('div', { className: 'lpm-project-head' },
    React.createElement('div', null,
      React.createElement('h3', null, project.name),
      React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
        React.createElement(Pill, { tone: project.status }, PROJECT_STATUS_LABELS[project.status]),
        project.target !== undefined ? React.createElement('span', { className: 'lpm-muted', style: { fontSize: 11 } }, `目标 ${project.target}`) : null)),
    project.owner !== undefined
      ? React.createElement('span', { className: 'lpm-avatar', 'data-owner': project.owner, title: project.owner }, ownerInitial(project.owner, people))
      : null),
  project.why !== undefined
    ? React.createElement('p', { className: 'lpm-muted' }, project.why)
    : null,
  project.next !== undefined
    ? React.createElement('p', null, React.createElement('span', { style: { color: 'var(--lpm-ink-3)', fontSize: 10.5, letterSpacing: '0.08em' } }, '下一步  '), project.next)
    : null,
  nextTask !== undefined
    ? React.createElement('p', { className: 'lpm-muted' }, `进行中：${nextTask.title}`)
    : null,
  React.createElement('div', { className: 'lpm-project-foot' },
    React.createElement('div', { className: 'lpm-progress' }, React.createElement('i', { style: { width: `${Math.round(progress.ratio * 100)}%` } })),
    React.createElement('span', { className: 'lpm-progress-label' }, `${progress.done}/${progress.total}`)))
}

/** Create or edit a project. */
function ProjectModal({ project, onClose }) {
  const { data, act } = usePM()
  const isNew = project === null
  const [draft, setDraft] = useState(() => ({
    name: project?.name ?? '',
    status: project?.status ?? 'active',
    area: project?.area ?? '',
    owner: project?.owner ?? 'both',
    target: project?.target ?? '',
    next: project?.next ?? '',
    why: project?.why ?? '',
    notes: project?.notes ?? '',
  }))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }))

  const save = async () => {
    if (draft.name.trim() === '') return
    const payload = {
      ...(isNew ? {} : { id: project.id }),
      name: draft.name.trim(),
      status: draft.status,
      area: draft.area === '' ? null : draft.area,
      owner: draft.owner,
      target: draft.target,
      next: draft.next,
      why: draft.why,
      notes: draft.notes,
    }
    const result = await act(() => api.saveProject(payload), isNew ? '项目已建立' : '项目已更新')
    if (result !== null) onClose()
  }

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    const result = await act(() => api.deleteProject(project.id), '项目已删除，相关事项已解除关联')
    if (result !== null) onClose()
  }

  return React.createElement(Modal, {
    title: isNew ? '新建项目' : project.name,
    subtitle: isNew ? '先写清楚为什么，再写下一步。' : `创建于 ${project.created ?? '—'}`,
    onClose,
    footer: React.createElement(React.Fragment, null,
      isNew ? null : React.createElement(Button, { variant: confirmDelete ? 'danger' : 'ghost', size: 'sm', icon: 'trash', onClick: () => void remove() }, confirmDelete ? '确认删除？' : '删除'),
      React.createElement('span', { style: { flex: '1 1 auto' } }),
      React.createElement(Button, { size: 'sm', variant: 'ghost', onClick: onClose }, '取消'),
      React.createElement(Button, { size: 'sm', variant: 'primary', disabled: draft.name.trim() === '', onClick: () => void save() }, isNew ? '创建' : '保存')),
  },
  React.createElement(Field, { label: '名称' },
    React.createElement('input', {
      className: 'lpm-input',
      value: draft.name,
      placeholder: '例如：换一座城市',
      autoFocus: true,
      onChange: (event) => update({ name: event.target.value }),
    })),
  React.createElement(Field, { label: '状态' },
    React.createElement(Segmented, {
      value: draft.status,
      options: PROJECT_OPTIONS,
      onChange: (value) => update({ status: value }),
      ariaLabel: '项目状态',
    })),
  React.createElement('div', { className: 'lpm-grid-2' },
    React.createElement(Field, { label: '领域' },
      React.createElement('select', {
        className: 'lpm-select',
        value: draft.area,
        onChange: (event) => update({ area: event.target.value }),
      },
      React.createElement('option', { value: '' }, '未归类'),
      data.meta.areas.map((area) => React.createElement('option', { key: area.id, value: area.id }, area.name)))),
    React.createElement(Field, { label: '谁主导' },
      React.createElement('select', {
        className: 'lpm-select',
        value: draft.owner,
        onChange: (event) => update({ owner: event.target.value }),
      },
      React.createElement('option', { value: 'both' }, '我们'),
      React.createElement('option', { value: 'me' }, data.meta.people.me ?? '我'),
      React.createElement('option', { value: 'partner' }, data.meta.people.partner ?? 'TA')))),
  React.createElement(Field, { label: '目标 / 期限', hint: '可以是一个日期或一个季度' },
    React.createElement('input', {
      className: 'lpm-input',
      value: draft.target,
      placeholder: '2027-05 / 2027-Q1 / 长期',
      onChange: (event) => update({ target: event.target.value }),
    })),
  React.createElement(Field, { label: '下一步', hint: '只写一件可以立刻做的事' },
    React.createElement('input', {
      className: 'lpm-input',
      value: draft.next,
      placeholder: '例如：列出三个候选城市',
      onChange: (event) => update({ next: event.target.value }),
    })),
  React.createElement(Field, { label: '为什么', hint: '写给你们自己，用于复盘时回看' },
    React.createElement('textarea', {
      className: 'lpm-textarea',
      value: draft.why,
      placeholder: '这件事对我们意味着什么？',
      onChange: (event) => update({ why: event.target.value }),
    })),
  React.createElement(Field, { label: '笔记' },
    React.createElement('textarea', {
      className: 'lpm-textarea',
      value: draft.notes,
      onChange: (event) => update({ notes: event.target.value }),
    })))
}
