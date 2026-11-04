import React, { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { usePM } from './context.js'
import { KIND_LABELS, formatDateLong, formatStamp } from './format.js'
import { Button, Segmented } from './ui.jsx'

const KIND_OPTIONS = ['note', 'decision', 'win', 'worry'].map((value) => ({ value, label: KIND_LABELS[value] }))

/** Daily log: compose one entry, read the recent timeline. */
export function JournalView() {
  const { data, act, goTo } = usePM()
  const [text, setText] = useState('')
  const [kind, setKind] = useState('note')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const value = text.trim()
    if (value === '') return
    setSaving(true)
    const result = await act(() => api.journal(value, kind), '记下了')
    setSaving(false)
    if (result !== null) setText('')
  }

  const latestReview = data.reviews[0]
  const days = data.journal

  return React.createElement('div', { className: 'lpm-view' },
    React.createElement('div', { className: 'lpm-journal-layout' },
      React.createElement('div', null,
        React.createElement('div', { className: 'lpm-section-head' },
          React.createElement('div', null,
            React.createElement('h2', null, '日记与决定'),
            React.createElement('p', null, '不用写得好看。写下来，是为了让未来的你们记得当时为什么这么选。'))),
        React.createElement('div', { className: 'lpm-composer' },
          React.createElement('textarea', {
            value: text,
            placeholder: '今天发生了什么？卡在哪？想清楚了什么？',
            onChange: (event) => setText(event.target.value),
            onKeyDown: (event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            },
            'aria-label': '今天的记录',
          }),
          React.createElement('div', { className: 'lpm-composer-foot' },
            React.createElement(Segmented, { value: kind, options: KIND_OPTIONS, onChange: setKind, ariaLabel: '记录类型' }),
            React.createElement(Button, {
              variant: 'primary',
              size: 'sm',
              disabled: saving || text.trim() === '',
              onClick: () => void submit(),
            }, saving ? '记录中…' : '记下'),
            )),
        days.length === 0
          ? React.createElement('div', { className: 'lpm-empty', style: { padding: '40px 0' } },
              React.createElement('p', null, '还没有记录。今天写一句就够。'))
          : React.createElement('div', null, days.map((day) => React.createElement('section', {
              key: day.date,
              className: `lpm-day ${day.date === data.today ? 'is-today' : ''}`.trim(),
            },
            React.createElement('h3', null, `${formatDateLong(day.date)}${day.date === data.today ? ' · 今天' : ''}`),
            day.entries.map((entry, index) => React.createElement('article', { key: `${entry.time}-${index}`, className: 'lpm-entry' },
              React.createElement('div', { className: 'lpm-entry-head' },
                React.createElement('span', { className: 'lpm-kind', 'data-kind': entry.kind }, KIND_LABELS[entry.kind] ?? entry.kind),
                React.createElement('span', null, entry.time)),
              React.createElement('p', null, entry.text)))))),
      ),
      React.createElement('aside', null,
        React.createElement('div', { className: 'lpm-aside-card' },
          React.createElement('h3', null, '这一周'),
          React.createElement('div', { className: 'lpm-aside-stats' },
            React.createElement('div', null, React.createElement('b', null, data.stats.doneThisWeek), React.createElement('span', null, '完成')),
            React.createElement('div', null, React.createElement('b', null, data.stats.now), React.createElement('span', null, '现在')),
            React.createElement('div', null, React.createElement('b', null, data.stats.waiting), React.createElement('span', null, '等待')),
            React.createElement('div', null, React.createElement('b', null, data.stats.inbox + data.stats.inboxTasks), React.createElement('span', null, '收件箱')))),
        React.createElement('div', { className: 'lpm-aside-card' },
          React.createElement('h3', null, '本周复盘'),
          latestReview !== undefined
            ? React.createElement(React.Fragment, null,
                React.createElement('p', { className: 'lpm-muted' }, `已生成 ${latestReview.week}`),
                React.createElement(Button, { size: 'sm', variant: 'quiet', icon: 'book', onClick: () => goTo('review') }, '打开复盘'))
            : React.createElement(React.Fragment, null,
                React.createElement('p', null, '还没有本周复盘。生成一份，再在里面写「我的复盘」。'),
                React.createElement(Button, { size: 'sm', variant: 'quiet', icon: 'sparkle', onClick: () => goTo('review') }, '去生成')))),
    ))
}

/** Weekly review reader/editor. */
export function ReviewView() {
  const { data, act } = usePM()
  const weeks = useMemo(() => {
    const known = new Set(data.reviews.map((review) => review.week))
    known.add(data.week)
    return [...known].sort().reverse()
  }, [data.reviews, data.week])
  const [week, setWeek] = useState(data.reviews[0]?.week ?? data.week)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const review = data.reviews.find((item) => item.week === week)

  useEffect(() => {
    setEditing(false)
    setDraft(review?.body ?? '')
  }, [week, review?.body])

  const generate = async () => {
    setBusy(true)
    const result = await act(() => api.writeReview(week), `${week} 复盘已生成`)
    setBusy(false)
    if (result !== null) setEditing(false)
  }

  const save = async () => {
    setBusy(true)
    const result = await act(() => api.saveReview(week, draft), '复盘已保存')
    setBusy(false)
    if (result !== null) setEditing(false)
  }

  return React.createElement('div', { className: 'lpm-view' },
    React.createElement('div', { className: 'lpm-section-head' },
      React.createElement('div', null,
        React.createElement('h2', null, '每周复盘'),
        React.createElement('p', null, '看本周真正完成了什么、卡在哪、哪些项目三周没动了。')),
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement(Button, { variant: 'quiet', size: 'sm', icon: 'sparkle', disabled: busy, onClick: () => void generate() }, busy ? '生成中…' : review === undefined ? '生成本周复盘' : '重新生成'),
        review === undefined
          ? null
          : React.createElement(Button, {
              variant: 'quiet',
              size: 'sm',
              icon: editing ? 'check' : 'book',
              onClick: () => (editing ? void save() : (setDraft(review.body), setEditing(true))),
            }, editing ? '保存' : '编辑'))),
    React.createElement('div', { className: 'lpm-weekchips' },
      weeks.map((item) => React.createElement('button', {
        key: item,
        type: 'button',
        className: `lpm-weekchip ${item === week ? 'is-active' : ''}`.trim(),
        onClick: () => setWeek(item),
      }, item)),
      review === undefined ? null : React.createElement('span', { className: 'lpm-muted', style: { fontSize: 11, alignSelf: 'center' } }, `更新于 ${formatStamp(review.createdAt) || '—'}`)),
    review === undefined
      ? React.createElement('div', { className: 'lpm-empty' },
          React.createElement('h2', null, '这一周还没有复盘'),
          React.createElement('p', null, '生成之后，它会包含完成、阻塞、停滞项目和「下周只做三件」。你可以直接在里面写。'),
          React.createElement(Button, { variant: 'quiet', icon: 'sparkle', disabled: busy, onClick: () => void generate() }, '生成'))
      : editing
        ? React.createElement('textarea', {
            className: 'lpm-review-edit',
            value: draft,
            onChange: (event) => setDraft(event.target.value),
          })
        : React.createElement('div', { className: 'lpm-review-text' }, renderMarkdown(review.body)))
}


/**
 * A deliberately small Markdown renderer for review files: headings,
 * blockquotes, bullet lists, bold and inline code. Anything else stays text.
 * @param {string} source review body
 */
function renderMarkdown(source) {
  const lines = String(source ?? '').split('\n')
  const blocks = []
  let list = []
  let ordered = false
  const flushList = () => {
    if (list.length === 0) return
    const tag = ordered ? 'ol' : 'ul'
    blocks.push(React.createElement(tag, { key: `l-${blocks.length}`, className: ordered ? 'lpm-ol' : undefined }, list.map((item, index) => React.createElement('li', { key: index }, inline(item)))))
    list = []
  }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (line.trim() === '') {
      flushList()
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading !== null) {
      flushList()
      const level = heading[1].length
      blocks.push(React.createElement(`h${Math.min(4, level + 1)}`, { key: `h-${blocks.length}` }, inline(heading[2])))
      continue
    }
    if (line.startsWith('> ')) {
      flushList()
      blocks.push(React.createElement('blockquote', { key: `q-${blocks.length}` }, inline(line.slice(2))))
      continue
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet !== null) {
      if (ordered) flushList()
      ordered = false
      list.push(bullet[1])
      continue
    }
    const numbered = /^\d+\.\s+(.*)$/.exec(line)
    if (numbered !== null) {
      if (!ordered) flushList()
      ordered = true
      list.push(numbered[1])
      continue
    }
    flushList()
    blocks.push(React.createElement('p', { key: `p-${blocks.length}` }, inline(line)))
  }
  flushList()
  return blocks
}

/** Bold and inline code within one line. */
function inline(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((part) => part !== '')
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return React.createElement('strong', { key: index }, part.slice(2, -2))
    if (part.startsWith('`') && part.endsWith('`')) return React.createElement('code', { key: index }, part.slice(1, -1))
    return React.createElement('span', { key: index }, part)
  })
}
