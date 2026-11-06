import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { LifePMContext } from './context.js'
import { formatDateLong, formatStamp, todayISO } from './format.js'
import { HomeView } from './home.jsx'
import { CanvasView } from './canvas.jsx'
import { BoardView } from './board.jsx'
import { TaskDrawer } from './drawer.jsx'
import { ProjectsView } from './projects.jsx'
import { JournalView, ReviewView } from './journal.jsx'
import { SettingsView } from './settings.jsx'
import { Button, Icon, IconButton, Segmented, Spinner } from './ui.jsx'

const VIEWS = [
  { id: 'home', label: '本周' },
  { id: 'canvas', label: '全貌' },
  { id: 'projects', label: '项目' },
  { id: 'board', label: '全部' },
  { id: 'records', label: '记录' },
  { id: 'settings', label: '设置' },
]

const VIEW_STORAGE_KEY = 'lifepm.view.v2'

/** Read the dashboard state, poll it, and expose mutations. */
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

  const load = useCallback(async (options = {}) => {
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
      if (options.initial !== false) setStatus((current) => (current === 'ready' ? current : 'error'))
      return null
    }
  }, [])

  useEffect(() => {
    void load()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void load({ initial: false })
    }, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load({ initial: false })
    }
    const onFocus = () => void load({ initial: false })
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
      await load({ initial: false })
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

/** Root dashboard panel. */
export function App() {
  const dashboard = useDashboard()
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY) ?? 'home'
    } catch {
      return 'home'
    }
  })
  const [selectedId, setSelectedId] = useState(null)

  const changeView = useCallback((next) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // Private mode: the view simply is not remembered.
    }
  }, [])

  const { data, status, error, busy, toast, act, reload, showToast } = dashboard
  const openTask = useCallback((id) => setSelectedId(id), [])
  const closeTask = useCallback(() => setSelectedId(null), [])

  const selected = useMemo(() => {
    if (data === null || selectedId === null) return null
    return data.tasks.find((task) => task.id === selectedId) ?? null
  }, [data, selectedId])

  const context = useMemo(() => ({
    data,
    busy,
    act,
    reload,
    showToast,
    openTask,
    closeTask,
    goTo: changeView,
  }), [data, busy, act, reload, showToast, openTask, closeTask, changeView])

  if (data === null && status === 'loading') {
    return React.createElement('div', { className: 'lpm' },
      React.createElement('div', { className: 'lpm-loading' },
        React.createElement(Spinner, { label: '加载 LifePM' }),
        React.createElement('span', null, '正在读取你的看板…')))
  }

  if (data === null) {
    return React.createElement('div', { className: 'lpm' },
      React.createElement('div', { className: 'lpm-empty' },
        React.createElement('h2', null, '打不开 LifePM'),
        React.createElement('p', null, error ?? '未知错误'),
        React.createElement(Button, { variant: 'quiet', icon: 'refresh', onClick: () => void reload() }, '重试')))
  }

  const stats = data.stats
  const isBlank = data.tasks.length === 0 && data.projects.length === 0 && data.inbox.length === 0

  return React.createElement(LifePMContext.Provider, { value: context },
    React.createElement('div', { className: 'lpm' },
      React.createElement(Header, { data, busy, reload, onSettings: () => changeView('settings') }),
      React.createElement(Tabs, { view, changeView, stats, data }),
      React.createElement('div', { className: 'lpm-scroll' },
        error !== null && data !== null
          ? React.createElement('div', { className: 'lpm-view' },
              React.createElement('div', { className: 'lpm-inline-error' },
                React.createElement('span', null, `同步失败：${error}`),
                React.createElement(Button, { size: 'sm', variant: 'quiet', onClick: () => void reload() }, '重试')))
          : null,
        view === 'home' ? React.createElement(HomeView, { blank: isBlank }) : null,
        view === 'canvas' ? React.createElement(CanvasView, null) : null,
        view === 'projects' ? React.createElement(ProjectsView, null) : null,
        view === 'board' ? React.createElement(BoardView, { blank: isBlank }) : null,
        view === 'records' ? React.createElement(RecordsView, null) : null,
        view === 'settings' ? React.createElement(SettingsView, null) : null),
      selected !== null
        ? React.createElement(TaskDrawer, { task: selected, onClose: closeTask })
        : null,
      toast !== null
        ? React.createElement('div', { className: `lpm-toast ${toast.tone === 'error' ? 'is-error' : ''}`.trim(), role: 'status' },
            toast.tone === 'error' ? React.createElement(Icon, { name: 'close', size: 13 }) : React.createElement(Icon, { name: 'check', size: 13 }),
            React.createElement('span', null, toast.text))
        : null),
  )
}

/** Header: focus, bet, date, sync state, quick capture. */
function Header({ data, busy, reload, onSettings }) {
  const { meta, today } = data
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(meta.focus ?? '')
  const [capture, setCapture] = useState('')
  const captureRef = useRef(null)
  const inputRef = useRef(null)
  const { act } = usePMContext()

  useEffect(() => {
    setDraft(meta.focus ?? '')
  }, [meta.focus])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const saveFocus = () => {
    setEditing(false)
    const next = draft.trim()
    if (next === (meta.focus ?? '')) return
    void act(() => api.saveMeta({ focus: next }), next === '' ? '主线已清空' : '主线已更新')
  }

  const submitCapture = async () => {
    const text = capture.trim()
    if (text === '') return
    setCapture('')
    const ok = await act(() => api.createTask({ quickAdd: text, status: 'inbox' }), '已收进收件箱')
    if (ok === null) setCapture(text)
  }

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        captureRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return React.createElement('header', { className: 'lpm-head' },
    React.createElement('div', { className: 'lpm-head-top' },
      React.createElement('div', { className: 'lpm-eyebrow' },
        React.createElement('span', { className: 'lpm-dot' }),
        'LIFE PM',
        React.createElement('span', { style: { opacity: 0.5 } }, '·'),
        React.createElement('span', null, '人生项目管理')),
      React.createElement('div', { className: 'lpm-head-actions' },
        data.connectors?.telegram?.running
          ? React.createElement('span', { className: 'lpm-synced', title: 'Telegram 正在接收消息' }, 'TG 在线')
          : null,
        React.createElement('span', { className: 'lpm-synced' }, `更新于 ${formatStamp(data.generatedAt)}`),
        React.createElement(IconButton, { icon: 'refresh', label: '刷新', onClick: () => void reload(), disabled: busy }),
        React.createElement(IconButton, { icon: 'settings', label: '设置', onClick: onSettings }))),
    React.createElement('div', { className: 'lpm-title-row' },
      React.createElement('div', { className: 'lpm-title-block' },
        editing
          ? React.createElement('input', {
              ref: inputRef,
              className: 'lpm-focus-edit',
              value: draft,
              placeholder: '这个季度，你想把注意力放在哪里？',
              onChange: (event) => setDraft(event.target.value),
              onBlur: saveFocus,
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.currentTarget.blur()
                }
                if (event.key === 'Escape') {
                  setDraft(meta.focus ?? '')
                  setEditing(false)
                }
              },
            })
          : React.createElement('h1', {
              className: `lpm-focus ${(meta.focus ?? '') === '' ? 'is-empty' : ''}`.trim(),
              title: '点击编辑这一季的主线',
              onClick: () => setEditing(true),
            }, meta.focus === '' ? '这个季度，你想把注意力放在哪里？' : meta.focus),
        React.createElement('div', { className: 'lpm-subline' },
          React.createElement('span', { className: 'lpm-bet', onClick: () => setEditing(true) },
            React.createElement('b', null, 'BET'),
            React.createElement('span', null, meta.bet === '' ? '写下这个季度你愿意押上的一件事' : meta.bet)),
          React.createElement('span', null, `${meta.quarter ?? ''} · ${data.stats.open} 件未完成`))),
      React.createElement('div', { className: 'lpm-head-date' },
        React.createElement('span', { className: 'lpm-date' }, formatDateLong(today)),
        React.createElement('span', { className: 'lpm-synced' }, `本周 ${data.week ?? ''}`))),
    React.createElement('div', { className: 'lpm-quickbar' },
      React.createElement(Icon, { name: 'plus', size: 15 }),
      React.createElement('input', {
        ref: captureRef,
        value: capture,
        placeholder: '记一条：想到什么就写什么，回车收进收件箱…',
        onChange: (event) => setCapture(event.target.value),
        onKeyDown: (event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void submitCapture()
          }
        },
        'aria-label': '快速捕获',
      }),
      React.createElement('span', { className: 'lpm-hint' },
        React.createElement('span', { className: 'lpm-kbd' }, '⌘K'),
        ' #项目 @我 !p1 due:周五')),
    )
}

/** Read the shared dashboard context from a view component. */
function usePMContext() {
  return React.useContext(LifePMContext)
}

/** Journal and review share one tab. */
function RecordsView() {
  const [tab, setTab] = useState('journal')
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'lpm-view', style: { paddingBottom: 0 } },
      React.createElement(Segmented, {
        value: tab,
        options: [{ value: 'journal', label: '日记' }, { value: 'review', label: '复盘' }],
        onChange: setTab,
        ariaLabel: '记录类型',
      })),
    tab === 'journal' ? React.createElement(JournalView, null) : React.createElement(ReviewView, null))
}

/** View switcher. */
function Tabs({ view, changeView, stats, data }) {
  const counts = {
    home: stats.focus,
    canvas: 0,
    projects: data.projects.filter((project) => project.status === 'active').length,
    board: stats.open,
    records: 0,
    settings: 0,
  }

  return React.createElement('nav', { className: 'lpm-tabs', role: 'tablist' },
    VIEWS.map((item) => React.createElement('button', {
      key: item.id,
      type: 'button',
      role: 'tab',
      'aria-selected': view === item.id,
      className: `lpm-tab ${view === item.id ? 'is-active' : ''}`.trim(),
      onClick: () => changeView(item.id),
    },
    item.label,
    counts[item.id] > 0
      ? React.createElement('span', { className: 'lpm-tab-count' }, counts[item.id])
      : null)),
    React.createElement('span', { className: 'lpm-tabs-spacer' }),
    React.createElement('span', { className: 'lpm-tabs-note' }, todayISO() === data.today ? '今天' : data.today),
  )
}
