import React, { useEffect, useMemo, useRef, useState } from 'react'
import { usePM } from './context.js'
import { describeActivity } from './format.js'
import { Button, IconButton } from './ui.jsx'

const STORAGE_KEY = 'lifepm.canvas.v2'
const STICKER_WIDTH = 208
const STICKER_HEIGHT = 116
const ZONE_PADDING = 28
const ZONE_HEADER = 58
const COLUMNS = 5
const COLUMN_STEP = 224
const ROW_STEP = 130
const GRID = 20

const PILE_WIDTH = 150
const PILE_HEIGHT = 96
const PILE_STEP = 176
const EXPLODED_GAP = 26

/** Canvas-only workspace: member zones, project stickers, compact piles. */
export function CanvasView() {
  const { data, openTask } = usePM()
  const [stored, setStored] = useState(() => readStored())
  const [view, setView] = useState(() => stored.view)
  const [compact, setCompact] = useState(() => stored.compact === true)
  const [exploded, setExploded] = useState({})
  const [dragging, setDragging] = useState(null)
  const [panning, setPanning] = useState(null)
  const containerRef = useRef(null)
  const viewRef = useRef(view)
  const movedRef = useRef(false)
  viewRef.current = view

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

  const groups = useMemo(() => {
    const people = data.meta.people ?? {}
    const members = [
      { id: 'me', name: people.me ?? '我', tone: 'me' },
      { id: 'partner', name: people.partner ?? 'TA', tone: 'partner' },
      { id: 'both', name: '我们', tone: 'both' },
    ]
    const projects = data.projects.filter((project) => project.status !== 'done' && project.status !== 'dropped')
    return members.map((member) => {
      const owned = projects.filter((project) => {
        const owner = project.owner ?? 'me'
        if (member.id === 'me') return owner === 'me'
        if (member.id === 'partner') return owner === 'partner'
        return owner === 'both'
      })
      const stickers = owned.map((project) => {
        const tasks = tasksByProject.get(project.id) ?? []
        return { project, tasks, type: stickerType(tasks) }
      })
      return { ...member, stickers }
    }).filter((group) => group.stickers.length > 0)
  }, [data.projects, data.meta.people, tasksByProject])

  const layout = useMemo(() => {
    const positions = { ...stored.positions }
    let y = 24
    const zones = []
    for (const group of groups) {
      const explodedType = exploded[group.id]
      const explodedStickers = explodedType === undefined ? [] : group.stickers.filter((sticker) => sticker.type.id === explodedType)
      const rows = Math.ceil(group.stickers.length / COLUMNS)
      const compactRows = explodedStickers.length > 0 ? Math.ceil(explodedStickers.length / 4) : 0
      const height = compact === true
        ? ZONE_HEADER + PILE_HEIGHT + 32 + (explodedStickers.length > 0 ? 24 + compactRows * ROW_STEP : 0) + ZONE_PADDING
        : ZONE_HEADER + rows * ROW_STEP + ZONE_PADDING
      const columns = Math.max(1, Math.min(COLUMNS, group.stickers.length))
      const normalWidth = ZONE_PADDING * 2 + columns * COLUMN_STEP - (COLUMN_STEP - STICKER_WIDTH)
      const pileRowWidth = groupPiles(group).length * PILE_STEP - (PILE_STEP - PILE_WIDTH) + ZONE_PADDING * 2
      const explodedColumns = Math.min(4, explodedStickers.length)
      const explodedWidth = explodedColumns * (STICKER_WIDTH + 18) - 18 + ZONE_PADDING * 2
      const width = compact === true
        ? Math.max(360, pileRowWidth, explodedWidth)
        : normalWidth
      const zone = { x: 24, y, width, height, group, explodedStickers }
      zones.push(zone)
      group.stickers.forEach((sticker, index) => {
        if (positions[sticker.project.id] !== undefined) return
        const column = index % COLUMNS
        const row = Math.floor(index / COLUMNS)
        positions[sticker.project.id] = {
          x: zone.x + ZONE_PADDING + column * COLUMN_STEP,
          y: zone.y + ZONE_HEADER + row * ROW_STEP,
        }
      })
      y += height + 26
    }
    return { zones, positions }
  }, [groups, stored.positions, compact, exploded])

  const worldWidth = useMemo(() => {
    const xs = Object.values(layout.positions).map((position) => position.x)
    const widest = layout.zones.reduce((max, zone) => Math.max(max, zone.width), 0)
    return Math.max(widest + 48, ...xs.map((x) => x + STICKER_WIDTH + 24))
  }, [layout.positions])
  const worldHeight = useMemo(() => {
    const last = layout.zones[layout.zones.length - 1]
    return last === undefined ? 400 : last.y + last.height + 24
  }, [layout.zones])

  const fit = (targetView = view) => {
    const container = containerRef.current
    if (container === null) return
    const rect = container.getBoundingClientRect()
    const scale = Math.max(0.4, Math.min(1, (rect.width - 80) / worldWidth, (rect.height - 80) / worldHeight))
    const next = { scale, x: (rect.width - worldWidth * scale) / 2, y: Math.max(20, (rect.height - worldHeight * scale) / 2) }
    setView(next)
    writeStored({ ...stored, view: next, fitted: true, positions: stored.positions, compact })
    void targetView
  }

  useEffect(() => {
    if (stored.fitted === true) return
    const timer = setTimeout(() => fit(), 60)
    return () => clearTimeout(timer)
    // Fit only the first time; the view persists afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    writeStored({ ...stored, view, fitted: true, compact })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const startDrag = (event, projectId, zone) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const position = layout.positions[projectId]
    movedRef.current = false
    setDragging({ id: projectId, zone, start: { pointerX: event.clientX, pointerY: event.clientY, x: position.x, y: position.y } })
  }

  useEffect(() => {
    if (dragging === null) return
    const onMove = (event) => {
      const rawX = dragging.start.x + (event.clientX - dragging.start.pointerX) / viewRef.current.scale
      const rawY = dragging.start.y + (event.clientY - dragging.start.pointerY) / viewRef.current.scale
      if (Math.abs(rawX - dragging.start.x) + Math.abs(rawY - dragging.start.y) > 3) movedRef.current = true
      const maxX = dragging.zone.x + dragging.zone.width - STICKER_WIDTH - ZONE_PADDING
      const maxY = dragging.zone.y + dragging.zone.height - STICKER_HEIGHT - ZONE_PADDING
      const x = clamp(snap(rawX), dragging.zone.x + ZONE_PADDING, maxX)
      const y = clamp(snap(rawY), dragging.zone.y + ZONE_HEADER, maxY)
      setStored((current) => ({ ...current, positions: { ...current.positions, [dragging.id]: { x, y } } }))
    }
    const onUp = () => {
      setStored((current) => {
        writeStored({ ...current, view: viewRef.current, fitted: true, compact })
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
  }, [dragging, compact])

  const startPan = (event) => {
    if (event.button !== 0) return
    if (event.target.closest('.lpm-sticker') !== null || event.target.closest('.lpm-pile') !== null || event.target.closest('.lpm-canvas-toolbar') !== null) return
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

  const toggleCompact = () => {
    const next = !compact
    setCompact(next)
    setExploded({})
    writeStored({ ...stored, compact: next, view, fitted: true })
    setTimeout(() => fit(), 40)
  }

  const toggleExplode = (groupId, typeId) => {
    setExploded((current) => ({ ...current, [groupId]: current[groupId] === typeId ? undefined : typeId }))
  }

  const resetLayout = () => {
    setStored({ positions: {}, compact, view, fitted: false })
    setExploded({})
    setTimeout(() => fit(), 40)
  }

  const openTaskFromCanvas = (task) => {
    if (movedRef.current) {
      movedRef.current = false
      return
    }
    openTask(task.id)
  }

  if (groups.length === 0) {
    return React.createElement('div', { className: 'lpm-canvas lpm-canvas-empty-state' },
      React.createElement('div', { className: 'lpm-empty' },
        React.createElement('h2', null, '画布上还没有项目'),
        React.createElement('p', null, '先建一个项目，它会以 sticker 的形式出现在这里。')))
  }

  return React.createElement('div', { className: 'lpm-canvas', ref: containerRef, onPointerDown: startPan },
    React.createElement('div', {
      className: 'lpm-canvas-dots',
      style: { backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.scale}px ${24 * view.scale}px` },
    }),
    React.createElement('div', { className: 'lpm-canvas-world', style: { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` } },
      layout.zones.map((zone) => React.createElement('section', {
        key: zone.group.id,
        className: `lpm-zone lpm-zone-${zone.group.tone}`,
        style: { left: zone.x, top: zone.y, width: zone.width, height: zone.height },
      },
      React.createElement('header', { className: 'lpm-zone-head' },
        React.createElement('span', { className: 'lpm-zone-name' }, zone.group.name),
        React.createElement('span', { className: 'lpm-zone-count' }, `${zone.group.stickers.length} 个项目`)),
      compact === true
        ? renderPiles(zone, data.week, exploded[zone.group.id], toggleExplode, openTaskFromCanvas)
        : zone.group.stickers.map((sticker) => {
            const position = layout.positions[sticker.project.id]
            const relative = { x: position.x - zone.x, y: position.y - zone.y }
            return renderSticker(sticker, relative, zone, data.week, startDrag, openTaskFromCanvas, dragging?.id === sticker.project.id)
          })))),
    React.createElement('div', { className: 'lpm-canvas-toolbar' },
      React.createElement(Button, {
        size: 'sm',
        variant: compact === true ? 'accent' : 'quiet',
        icon: 'sparkle',
        onClick: toggleCompact,
      }, compact === true ? '紧凑中' : '紧凑'),
      React.createElement('span', { className: 'lpm-canvas-sep' }),
      React.createElement(IconButton, { icon: 'refresh', label: '适应画布', onClick: () => fit() }),
      React.createElement('button', { type: 'button', className: 'lpm-canvas-plus', 'aria-label': '缩小', onClick: () => zoomBy(0.88) }, '－'),
      React.createElement('span', { className: 'lpm-canvas-zoom' }, `${Math.round(view.scale * 100)}%`),
      React.createElement('button', { type: 'button', className: 'lpm-canvas-plus', 'aria-label': '放大', onClick: () => zoomBy(1.12) }, '＋'),
      React.createElement('span', { className: 'lpm-canvas-sep' }),
      React.createElement(Button, { size: 'sm', variant: 'ghost', onClick: resetLayout }, '整理布局')),
    React.createElement('div', { className: 'lpm-canvas-hint' }, '拖动 sticker 移动 · 拖动空白处平移 · 滚轮缩放 · 双击堆展开'))
}

/** @param {ReturnType<typeof buildZone>} zone */
function renderPiles(zone, week, explodedType, onToggle, openTask) {
  const piles = groupPiles(zone.group)
  const exploded = piles.find((pile) => pile.type.id === explodedType)
  return React.createElement(React.Fragment, null,
    piles.map((pile, index) => {
      const x = ZONE_PADDING + index * PILE_STEP
      const y = ZONE_HEADER
      return React.createElement('div', {
        key: pile.type.id,
        className: `lpm-pile ${exploded !== undefined && exploded.type.id === pile.type.id ? 'is-open' : ''}`.trim(),
        style: { left: x, top: y, width: PILE_WIDTH, height: PILE_HEIGHT },
        onDoubleClick: () => onToggle(zone.group.id, pile.type.id),
        title: '双击展开这一堆',
      },
      pile.items.slice(0, 4).map((item, layer) => React.createElement('div', {
        key: item.project.id,
        className: 'lpm-pile-layer',
        style: { transform: `translate(${layer * 7}px, ${layer * 6}px)`, zIndex: layer },
      })),
      React.createElement('div', { className: 'lpm-pile-face', style: { zIndex: 6 } },
        React.createElement('span', { className: `lpm-pile-dot s-${pile.type.id}`.trim() }),
        React.createElement('span', { className: 'lpm-pile-label' }, pile.type.label),
        React.createElement('span', { className: 'lpm-pile-count' }, pile.items.length)))
    }),
    exploded === undefined ? null : exploded.items.map((sticker, index) => {
      const column = index % 4
      const row = Math.floor(index / 4)
      const x = ZONE_PADDING + column * (STICKER_WIDTH + 18)
      const y = ZONE_HEADER + PILE_HEIGHT + 34 + row * ROW_STEP
      const position = { x, y }
      return renderSticker(sticker, position, zone, week, () => undefined, openTask, false, true)
    }))
}

function renderSticker(sticker, position, zone, week, startDrag, openTask, dragging, exploded = false) {
  const focused = sticker.tasks.some((task) => task.focus_week === week)
  return React.createElement('article', {
    key: sticker.project.id,
    className: `lpm-sticker ${dragging ? 'is-dragging' : ''} ${exploded ? 'is-exploded' : ''}`.trim(),
    'data-tone': sticker.type.tone,
    style: { left: position.x, top: position.y, width: STICKER_WIDTH, height: STICKER_HEIGHT },
    onPointerDown: (event) => startDrag(event, sticker.project.id, zone),
    onDoubleClick: (event) => event.stopPropagation(),
  },
  React.createElement('header', { className: 'lpm-sticker-head' },
    React.createElement('span', { className: 'lpm-sticker-name' }, sticker.project.name),
    React.createElement('span', { className: 'lpm-sticker-type' }, sticker.type.label),
    focused ? React.createElement('span', { className: 'lpm-sticker-star' }, '本周') : null),
  React.createElement('div', { className: 'lpm-sticker-meta' },
    React.createElement('span', null, `${sticker.tasks.length} 件`),
    React.createElement('span', null, describeActivity(sticker.project.last_active))),
  React.createElement('div', { className: 'lpm-sticker-tasks' },
    sticker.tasks.slice(0, 2).map((task) => React.createElement('button', {
      key: task.id,
      type: 'button',
      className: 'lpm-sticker-task',
      onClick: (event) => {
        event.stopPropagation()
        openTask(task)
      },
    }, task.title)),
    sticker.tasks.length > 2 ? React.createElement('span', { className: 'lpm-sticker-more' }, `+${sticker.tasks.length - 2}`) : null))
}

/** Coarse bucket for a project sticker: the most urgent open task status. */
function stickerType(tasks) {
  const has = (status) => tasks.some((task) => task.status === status)
  if (has('now')) return { id: 'now', label: '候选', tone: 'now' }
  if (has('waiting')) return { id: 'waiting', label: '等待', tone: 'waiting' }
  if (has('next')) return { id: 'next', label: '接下来', tone: 'next' }
  if (has('someday')) return { id: 'someday', label: '也许', tone: 'someday' }
  return { id: 'empty', label: '空', tone: 'empty' }
}

/** @param {{ stickers: Array<{ type: { id: string, label: string, tone: string } }> }} group */
function groupPiles(group) {
  const order = ['now', 'waiting', 'next', 'someday', 'empty']
  const map = new Map()
  for (const sticker of group.stickers) {
    if (!map.has(sticker.type.id)) map.set(sticker.type.id, { type: sticker.type, items: [] })
    map.get(sticker.type.id).items.push(sticker)
  }
  return [...map.values()].sort((left, right) => order.indexOf(left.type.id) - order.indexOf(right.type.id))
}

/** @param {number} value */
function snap(value) {
  return Math.round(value / GRID) * GRID
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** @returns {{ positions: Record<string, {x:number,y:number}>, view: {x:number,y:number,scale:number}, compact: boolean, fitted: boolean }} */
function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { positions: {}, view: { x: 0, y: 0, scale: 1 }, compact: false, fitted: false }
    const parsed = JSON.parse(raw)
    const positions = parsed !== null && typeof parsed.positions === 'object' && parsed.positions !== null ? parsed.positions : {}
    const view = parsed !== null && typeof parsed.view === 'object' && parsed.view !== null ? parsed.view : { x: 0, y: 0, scale: 1 }
    return {
      positions,
      view: { x: Number(view.x) || 0, y: Number(view.y) || 0, scale: Math.min(2, Math.max(0.3, Number(view.scale) || 1)) },
      compact: parsed !== null && parsed.compact === true,
      fitted: parsed !== null && parsed.fitted === true,
    }
  } catch {
    return { positions: {}, view: { x: 0, y: 0, scale: 1 }, compact: false, fitted: false }
  }
}

/** @param {ReturnType<typeof readStored>} value */
function writeStored(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage disabled: the canvas still works for this session.
  }
}
