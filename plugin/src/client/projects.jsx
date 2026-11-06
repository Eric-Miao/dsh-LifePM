import React, { useMemo, useState } from 'react'
import { api } from './api.js'
import { usePM } from './context.js'
import {
  PROJECT_STATUS_LABELS,
  describeActivity,
  describeDue,
  ownerInitial,
} from './format.js'
import { Button, Field, Icon, IconButton, Modal, Pill, Segmented } from './ui.jsx'
import { QuickAdd } from './quickadd.jsx'

const PROJECT_OPTIONS = ['active', 'paused', 'idea', 'done', 'dropped'].map((value) => ({
  value,
  label: PROJECT_STATUS_LABELS[value],
}))

/** Project portfolio: every thread, one next action, last activity. */
export function ProjectsView() {
  const { data, act } = usePM()
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)

  const groups = useMemo(() => {
    const map = { active: [], paused: [], idea: [], archived: [] }
    for (const project of data.projects) {
      if (project.status === 'active') map.active.push(project)
      else if (project.status === 'paused') map.paused.push(project)
      else if (project.status === 'idea') map.idea.push(project)
      else map.archived.push(project)
    }
    const sortByActivity = (left, right) => String(right.last_active ?? '').localeCompare(String(left.last_active ?? ''))
    map.active.sort(sortByActivity)
    map.paused.sort(sortByActivity)
    map.idea.sort(sortByActivity)
    return map
  }, [data.projects])

  const section = (title, projects, hint) => projects.length === 0 ? null : React.createElement('section', { className: 'lpm-portfolio-group' },
    React.createElement('header', { className: 'lpm-portfolio-head' },
      React.createElement('h2', null, title),
      React.createElement('span', null, projects.length),
      hint === undefined ? null : React.createElement('p', null, hint)),
    projects.map((project) => React.createElement(ProjectRow, {
      key: project.id,
      project,
      tasks: data.tasks,
      people: data.meta.people,
      onEdit: () => setEditing(project),
    })))

  return React.createElement('div', { className: 'lpm-view lpm-portfolio' },
    React.createElement('div', { className: 'lpm-section-head' },
      React.createElement('div', null,
        React.createElement('h2', null, '项目'),
        React.createElement('p', null, '每条线一个下一步。动没动自己会显示，不需要打分。')),
      React.createElement(Button, { variant: 'quiet', icon: 'plus', onClick: () => setCreating(true) }, '新建项目')),
    data.projects.length === 0
      ? React.createElement('div', { className: 'lpm-empty' },
          React.createElement('h2', null, '还没有项目'),
          React.createElement('p', null, '把一个会持续几周以上的事情建成项目：搬家、婚礼、一个产品、一条内容线。'),
          React.createElement(Button, { variant: 'quiet', icon: 'plus', onClick: () => setCreating(true) }, '建第一个项目'))
      : React.createElement(React.Fragment, null,
          section('进行中', groups.active),
          section('暂停', groups.paused, '停着也没关系，想动的时候再回来。'),
          section('想法', groups.idea),
          section('已结束', groups.archived)),
    creating ? React.createElement(ProjectModal, { project: null, onClose: () => setCreating(false) }) : null,
    editing !== null ? React.createElement(ProjectModal, { project: editing, onClose: () => setEditing(null) }) : null)
}

/** One project line: name, next action (inline edit), activity, tasks. */
export function ProjectRow({ project, tasks, people, onEdit, showEdit = true }) {
  const { data, act, openTask, goTo } = usePM()
  const [expanded, setExpanded] = useState(false)
  const [editingNext, setEditingNext] = useState(false)
  const [nextDraft, setNextDraft] = useState(project.next ?? '')
  const [busy, setBusy] = useState(false)

  const owned = tasks.filter((task) => task.project === project.id || task.project === project.name)
  const openTasks = owned.filter((task) => task.status !== 'done' && task.status !== 'dropped')
  const focused = openTasks.some((task) => task.focus_week === data.week)
  const due = project.target ? `目标 ${project.target}` : undefined

  const saveNext = async () => {
    setEditingNext(false)
    const value = nextDraft.trim()
    if (value === (project.next ?? '')) return
    await act(() => api.saveProject({ id: project.id, next: value }), '下一步已更新')
  }

  const touch = async () => {
    setBusy(true)
    await act(() => api.touchProject(project.id), '记下了')
    setBusy(false)
  }

  return React.createElement('article', { className: 'lpm-project-row', 'data-status': project.status },
    React.createElement('div', { className: 'lpm-project-row-main' },
      React.createElement('button', {
        type: 'button',
        className: 'lpm-project-name',
        onClick: () => (onEdit ? onEdit() : goTo('projects')),
        title: onEdit ? '编辑项目' : '打开项目',
      }, project.name),
      React.createElement('div', { className: 'lpm-project-meta' },
        project.status !== 'active' ? React.createElement(Pill, { tone: project.status }, PROJECT_STATUS_LABELS[project.status]) : null,
        focused ? React.createElement(Pill, { tone: 'accent' }, '本周有') : null,
        React.createElement('span', null, `${openTasks.length} 件事`),
        React.createElement('span', { title: project.last_active ?? '' }, describeActivity(project.last_active)),
        due === undefined ? null : React.createElement('span', null, due),
        project.owner === undefined ? null : React.createElement('span', { className: 'lpm-avatar', 'data-owner': project.owner }, ownerInitial(project.owner, people))),
      editingNext
        ? React.createElement('input', {
            className: 'lpm-project-next-input',
            autoFocus: true,
            value: nextDraft,
            placeholder: '下一步是什么？',
            onChange: (event) => setNextDraft(event.target.value),
            onBlur: () => void saveNext(),
            onKeyDown: (event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                setNextDraft(project.next ?? '')
                setEditingNext(false)
              }
            },
          })
        : React.createElement('button', {
            type: 'button',
            className: `lpm-project-next ${project.next ? '' : 'is-empty'}`.trim(),
            onClick: () => {
              setNextDraft(project.next ?? '')
              setEditingNext(true)
            },
            title: '点击编辑下一步',
          },
          React.createElement(Icon, { name: 'arrow', size: 12 }),
          project.next ?? '写一个下一步')),
    React.createElement('div', { className: 'lpm-project-actions' },
      React.createElement(IconButton, { icon: 'check', label: '碰过了', disabled: busy, onClick: () => void touch() }),
      showEdit && onEdit !== undefined ? React.createElement(IconButton, { icon: 'more', label: '编辑项目', onClick: onEdit }) : null,
      React.createElement(IconButton, {
        icon: 'chevron',
        label: expanded ? '收起任务' : '展开任务',
        className: expanded ? 'is-open' : '',
        onClick: () => setExpanded((current) => !current),
      })),
    expanded
      ? React.createElement('div', { className: 'lpm-project-tasks' },
          openTasks.length === 0
            ? React.createElement('p', { className: 'lpm-muted', style: { fontSize: 12 } }, '还没有事项。')
            : openTasks.map((task) => {
                const taskDue = describeDue(task.due)
                return React.createElement('button', {
                  key: task.id,
                  type: 'button',
                  className: 'lpm-task-row',
                  onClick: () => openTask(task.id),
                },
                React.createElement('span', { className: `lpm-task-dot s-${task.status}`.trim() }),
                React.createElement('span', { className: 'lpm-task-row-title' }, task.title),
                task.focus_week === data.week ? React.createElement('span', { className: 'lpm-task-tag' }, '本周') : null,
                taskDue === null ? null : React.createElement('span', { className: 'lpm-task-due', 'data-state': taskDue.state }, taskDue.text))
              }),
          React.createElement(QuickAdd, { project: project.id }))
      : null)
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
    subtitle: isNew ? '先写清楚为什么，再写下一步。' : `上次动过：${describeActivity(project.last_active)}`,
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
