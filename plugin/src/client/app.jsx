import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { LifePMContext } from './context.js'
import { CanvasView } from './canvas.jsx'
import { TaskDrawer } from './drawer.jsx'
import { Icon, Spinner } from './ui.jsx'

/** Read the canvas data, poll it, and expose mutations. */
function useDashboard() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const alive = useRef(true)
  const toastTimer = useRef(null)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(toastTimer.current)
    }
  }, [])

  const showToast = useCallback((text, tone = 'info') => {
    if (text === undefined || text === null || text === '') return
    setToast({ text: String(text), tone })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => {
      if (alive.current) setToast(null)
    }, tone === 'error' ? 4200 : 2400)
  }, [])

  const load = useCallback(async () => {
    try {
      const next = await api.state()
      if (!alive.current) return next
      setData(next)
      setStatus('ready')
      setError(null)
      return next
    } catch (cause) {
      if (!alive.current) return null
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus((current) => (current === 'ready' ? current : 'error'))
      return null
    }
  }, [])

  useEffect(() => {
    void load()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const onFocus = () => void load()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const act = useCallback(async (work, successMessage) => {
    setBusy(true)
    try {
      const result = await work()
      await load()
      if (successMessage !== undefined) showToast(successMessage)
      return result
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : String(cause), 'error')
      return null
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [load, showToast])

  return { data, status, error, busy, toast, act, reload: load, showToast }
}

/** Canvas-only panel: the spatial workspace is the whole product surface. */
export function App() {
  const dashboard = useDashboard()
  const [selectedId, setSelectedId] = useState(null)
  const { data, status, error, busy, toast, act, reload, showToast } = dashboard

  const selected = useMemo(() => {
    if (data === null || selectedId === null) return null
    return data.tasks.find((task) => task.id === selectedId) ?? null
  }, [data, selectedId])

  const openTask = useCallback((id) => setSelectedId(id), [])
  const closeTask = useCallback(() => setSelectedId(null), [])

  const context = useMemo(() => ({
    data,
    busy,
    act,
    reload,
    showToast,
    openTask,
    closeTask,
    goTo: () => undefined,
  }), [data, busy, act, reload, showToast, openTask, closeTask])

  if (data === null && status === 'loading') {
    return React.createElement('div', { className: 'lpm' },
      React.createElement('div', { className: 'lpm-loading' },
        React.createElement(Spinner, { label: '加载 LifePM' }),
        React.createElement('span', null, '正在铺开画布…')))
  }

  if (data === null) {
    return React.createElement('div', { className: 'lpm' },
      React.createElement('div', { className: 'lpm-empty' },
        React.createElement('h2', null, '打不开 LifePM'),
        React.createElement('p', null, error ?? '未知错误'),
        React.createElement('button', { type: 'button', className: 'lpm-btn lpm-btn-quiet', onClick: () => void reload() }, '重试')))
  }

  return React.createElement(LifePMContext.Provider, { value: context },
    React.createElement('div', { className: 'lpm lpm-canvas-only' },
      React.createElement(CanvasView, null),
      selected !== null ? React.createElement(TaskDrawer, { task: selected, onClose: closeTask }) : null,
      toast !== null
        ? React.createElement('div', { className: `lpm-toast ${toast.tone === 'error' ? 'is-error' : ''}`.trim(), role: 'status' },
            toast.tone === 'error' ? React.createElement(Icon, { name: 'close', size: 13 }) : React.createElement(Icon, { name: 'check', size: 13 }),
            React.createElement('span', null, toast.text))
        : null))
}
