import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { usePM } from './context.js'
import { describeActivity, describeDue } from './format.js'
import { Button, Icon, IconButton } from './ui.jsx'

const STORAGE_KEY = 'lifepm.canvas.v1'
const BOX_WIDTH = 288
const BOX_HEIGHT = 208
const GAP = 26
const PAD = 40
const COLUMNS = 4

/** Freeform canvas: one area per project, tasks laid out inside. */
export function CanvasView() {
  const { data, openTask, goTo, act } = usePM()
  const [stored, setStored] = useState(() => readStored())
  const [view, setView] = useState(() => stored.view)
  const [dragging, setDragging] = useState(null)
  const [panning, setPanning] = useState(null)
  const containerRef = useRef(null)
  const movedRef = useRef(false)
  const viewRef = useRef(view)
  viewRef.current = view

  const projects = useMemo(
    () => data.projects
      .filter((project) => project.status !== 'done' && project.status !== 'dropped')
      .sort((left, right) => {
        const rank = { active: 0, paused: 1, idea: 2 }
        const byStatus = (rank[left.status] ?? 3) - (rank[right.status] ?? 3)
        if (byStatus !== 0) return byStatus
        return String(right.last_active ?? '').localeCompare(String(left.last_active ?? ''))
      }),
    [data.projects],
  )

  const tasksByProject = useMemo(() => {
    const map = new Map()
    for (const task of data.tasks) {
      if (task.status === 'done' || task.status === 'dropped') continue
      const key = task.project ?? '__none__'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(task)
    }
    return map
  }, [data.tasks])

  const loose = tasksByProject.get('__none__') ?? []
  const nodes = useMemo(
    () => (loose.length > 0 ? [...projects, { id: '__none__', name: '未归属', status: 'active', last_active: undefined, virtual: true }] : projects),
    [projects, loose.length],
  )

  const layout = useMemo(() => {
    const positions = { ...stored.positions }
    let cursor = 0
    for (const project of nodes) {
      if (positions[project.id] !== undefined) continue
      const column = cursor % COLUMNS
      const row = Math.floor(cursor / COLUMNS)
      positions[project.id] = { x: PAD + column * (BOX_WIDTH + GAP), y: PAD + row * (BOX_HEIGHT + GAP) }
      cursor += 1
    }
    return positions
  }, [nodes, stored.positions])

  const width = useMemo(() => {
    const xs = Object.values(layout).map((position) => position.x)
    return Math.max(0, ...xs) + BOX_WIDTH + PAD
  }, [layout])
  const height = useMemo(() => {
    const ys = Object.values(layout).map((position) => position.y)
    return Math.max(0, ...ys) + BOX_HEIGHT + PAD
  }, [layout])

  const fit = useCallback(() => {
    const container = containerRef.current
    if (container === null) return
    const rect = container.getBoundingClientRect()
    const scale = Math.max(0.3, Math.min(1, (rect.width - 80) / Math.max(width, 1), (rect.height - 80) / Math.max(height, 1)))
    setView({ scale, x: (rect.width - width * scale) / 2, y: Math.max(24, (rect.height - height * scale) / 2) })
  }, [width, height])

  useEffect(() => {
    if (stored.fitted === true) return
    const timer = setTimeout(() => {
      fit()
      setStored((current) => ({ ...current, fitted: true }))
    }, 60)
    return () => clearTimeout(timer)
    // Fit only the first time this browser opens the canvas; later views persist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    writeStored({ ...stored, view, fitted: true })
    // Only view changes are persisted here; positions persist on drag end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const startDrag = (event, project) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const position = layout[project.id]
    const start = { pointerX: event.clientX, pointerY: event.clientY, x: position.x, y: position.y }
    movedRef.current = false
    setDragging({ id: project.id, start })
  }

  useEffect(() => {
    if (dragging === null) return
    const onMove = (event) => {
      const deltaX = (event.clientX - dragging.start.pointerX) / viewRef.current.scale
      const deltaY = (event.clientY - dragging.start.pointerY) / viewRef.current.scale
      if (Math.abs(deltaX) + Math.abs(deltaY) > 3) movedRef.current = true
      setStored((current) => ({
        ...current,
        positions: { ...current.positions, [dragging.id]: { x: dragging.start.x + deltaX, y: dragging.start.y + deltaY } },
      }))
    }
    const onUp = () => {
      setStored((current) => {
        writeStored({ ...current, view: viewRef.current })
        return current
      })
      setDragging(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging])

  const startPan = (event) => {
    if (event.button !== 0) return
    if (event.target.closest('.lpm-canvas-project') !== null || event.target.closest('.lpm-canvas-toolbar') !== null) return
    setPanning({ pointerX: event.clientX, pointerY: event.clientY, x: view.x, y: view.y })
  }

  useEffect(() => {
    if (panning === null) return
    const onMove = (event) => {
      setView((current) => ({ ...current, x: panning.x + event.clientX - panning.pointerX, y: panning.y + event.clientY - panning.pointerY }))
    }
    const onUp = () => setPanning(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [panning])

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const onWheel = (event) => {
      event.preventDefault()
      const rect = container.getBoundingClientRect()
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      const current = viewRef.current
      const nextScale = Math.min(2, Math.max(0.3, current.scale * (event.deltaY > 0 ? 0.92 : 1.08)))
      const worldX = (pointerX - current.x) / current.scale
      const worldY = (pointerY - current.y) / current.scale
      setView({ scale: nextScale, x: pointerX - worldX * nextScale, y: pointerY - worldY * nextScale })
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  const resetLayout = () => {
    setStored({ positions: {}, view, fitted: true })
    setTimeout(() => fit(), 30)
  }

  const zoomBy = (factor) => {
    const container = containerRef.current
    if (container === null) return
    const rect = container.getBoundingClientRect()
    const nextScale = Math.min(2, Math.max(0.3, view.scale * factor))
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const worldX = (centerX - view.x) / view.scale
    const worldY = (centerY - view.y) / view.scale
    setView({ scale: nextScale, x: centerX - worldX * nextScale, y: centerY - worldY * nextScale })
  }

  const focusProject = (projectId) => {
    const position = layout[projectId]
    const container = containerRef.current
    if (position === undefined || container === null) return
    const rect = container.getBoundingClientRect()
    const scale = Math.max(0.8, Math.min(1.2, view.scale))
    setView({ scale, x: rect.width / 2 - (position.x + BOX_WIDTH / 2) * scale, y: rect.height / 2 - (position.y + BOX_HEIGHT / 2) * scale })
  }

  const openTaskFromCanvas = (task) => {
    if (movedRef.current) {
      movedRef.current = false
      return
    }
    openTask(task.id)
  }

  return React.createElement('div', { className: 'lpm-canvas', ref: containerRef, onPointerDown: startPan },
    React.createElement('div', {
      className: 'lpm-canvas-dots',
      style: { backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.scale}px ${24 * view.scale}px` },
    }),
    React.createElement('div', { className: 'lpm-canvas-world', style: { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` } },
      nodes.map((project) => {
        const tasks = project.virtual === true ? loose : (tasksByProject.get(project.id) ?? [])
        const focused = tasks.some((task) => task.focus_week === data.week)
        const position = layout[project.id]
        return React.createElement('section', {
          key: project.id,
          className: `lpm-canvas-project ${dragging?.id === project.id ? 'is-dragging' : ''}`.trim(),
          style: { left: position.x, top: position.y, width: BOX_WIDTH, height: BOX_HEIGHT },
          onDoubleClick: () => focusProject(project.id),
        },
        React.createElement('header', {
          className: 'lpm-canvas-project-head',
          onPointerDown: project.virtual === true ? undefined : (event) => startDrag(event, project),
          title: project.virtual === true ? '未归属的事项' : '拖动这块区域；双击居中',
        },
        React.createElement('div', { className: 'lpm-canvas-project-title' },
          React.createElement('span', { className: 'lpm-canvas-project-name' }, project.name),
          focused ? React.createElement('span', { className: 'lpm-canvas-star' }, '本周') : null),
        React.createElement('div', { className: 'lpm-canvas-project-meta' },
          React.createElement('span', null, `${tasks.length} 件`),
          project.virtual === true ? null : React.createElement('span', null, describeActivity(project.last_active)),
          project.virtual === true ? null : React.createElement(IconButton, {
            icon: 'arrow',
            label: '打开项目',
            className: 'lpm-canvas-open',
            onClick: (event) => {
              event.stopPropagation()
              goTo('projects')
            },
          }))),
        React.createElement('div', { className: 'lpm-canvas-tasks' },
          tasks.slice(0, 5).map((task) => {
            const due = describeDue(task.due)
            return React.createElement('button', {
              key: task.id,
              type: 'button',
              className: 'lpm-canvas-task',
              onClick: () => openTaskFromCanvas(task),
            },
            React.createElement('span', { className: `lpm-canvas-dot s-${task.status}`.trim() }),
            React.createElement('span', { className: 'lpm-canvas-task-title' }, task.title),
            task.focus_week === data.week ? React.createElement('span', { className: 'lpm-canvas-focus' }, '·') : null,
            due === null ? null : React.createElement('span', { className: 'lpm-canvas-due', 'data-state': due.state }, due.text))
          }),
          tasks.length === 0 ? React.createElement('p', { className: 'lpm-canvas-empty' }, '没有待办') : null,
          tasks.length > 5 ? React.createElement('p', { className: 'lpm-canvas-more' }, `还有 ${tasks.length - 5} 件`) : null),
        )
      })),
    React.createElement('div', { className: 'lpm-canvas-toolbar' },
      React.createElement(IconButton, { icon: 'refresh', label: '适应画布', onClick: fit }),
      React.createElement('span', { className: 'lpm-canvas-sep' }),
      React.createElement('button', { type: 'button', className: 'lpm-canvas-plus', 'aria-label': '缩小', onClick: () => zoomBy(0.88) }, '－'),
      React.createElement('span', { className: 'lpm-canvas-zoom' }, `${Math.round(view.scale * 100)}%`),
      React.createElement('button', { type: 'button', className: 'lpm-canvas-plus', 'aria-label': '放大', onClick: () => zoomBy(1.12) }, '＋'),
      React.createElement('span', { className: 'lpm-canvas-sep' }),
      React.createElement(Button, { size: 'sm', variant: 'ghost', onClick: resetLayout }, '整理布局')),
    React.createElement('div', { className: 'lpm-canvas-legend' },
      ['now', 'next', 'waiting', 'someday'].map((status) => React.createElement('span', { key: status },
        React.createElement('i', { className: `lpm-canvas-dot s-${status}` }),
        { now: '候选', next: '接下来', waiting: '等待', someday: '也许' }[status]))),
    React.createElement('div', { className: 'lpm-canvas-hint' }, '拖动空白处平移 · 滚轮缩放 · 拖项目标题移动 · 双击项目居中'))
}

/** @returns {{ positions: Record<string, {x:number,y:number}>, view: {x:number,y:number,scale:number} }} */
function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { positions: {}, view: { x: 0, y: 0, scale: 1 }, fitted: false }
    const parsed = JSON.parse(raw)
    const positions = parsed !== null && typeof parsed.positions === 'object' && parsed.positions !== null ? parsed.positions : {}
    const view = parsed !== null && typeof parsed.view === 'object' && parsed.view !== null ? parsed.view : { x: 0, y: 0, scale: 1 }
    return {
      positions,
      view: { x: Number(view.x) || 0, y: Number(view.y) || 0, scale: Math.min(2, Math.max(0.3, Number(view.scale) || 1)) },
      fitted: parsed !== null && parsed.fitted === true,
    }
  } catch {
    return { positions: {}, view: { x: 0, y: 0, scale: 1 }, fitted: false }
  }
}

/** @param {{ positions: Record<string, {x:number,y:number}>, view: {x:number,y:number,scale:number} }} value */
function writeStored(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage disabled: the canvas still works for this session.
  }
}
