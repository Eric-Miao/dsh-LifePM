import React, { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { usePM } from './context.js'
import { Icon } from './ui.jsx'

/**
 * One-line task creator used inside a column.
 * The server parses the quick-add syntax (`#project`, `@owner`, `!p1`,
 * `due:周五`) so the browser and the connectors share one grammar.
 */
export function QuickAdd({ status = 'inbox', autoFocus = false, onDone }) {
  const { act, openTask } = usePM()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const submit = async () => {
    const value = text.trim()
    if (value === '' || busy) {
      onDone?.()
      return
    }
    setBusy(true)
    const result = await act(() => api.createTask({ quickAdd: value, status }), '已添加')
    setBusy(false)
    if (result !== null) {
      setText('')
      inputRef.current?.focus()
    }
  }

  return React.createElement('div', { className: 'lpm-addline' },
    React.createElement(Icon, { name: 'plus', size: 12 }),
    React.createElement('input', {
      ref: inputRef,
      value: text,
      placeholder: '添加一条… #项目 @我 due:周五',
      disabled: busy,
      onChange: (event) => setText(event.target.value),
      onKeyDown: (event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault()
          void submit()
        }
        if (event.key === 'Escape') {
          setText('')
          onDone?.()
        }
      },
      onBlur: () => {
        if (text.trim() === '') onDone?.()
      },
      'aria-label': '快速添加任务',
    }))
}
