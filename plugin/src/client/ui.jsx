import React, { useEffect, useRef, useState } from 'react'

export const h = React.createElement

const ICONS = {
  compass: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M15.4 8.6l-1.8 5-5 1.8 1.8-5z' }],
  ],
  board: [
    ['rect', { x: 3, y: 4, width: 7, height: 16, rx: 1.6 }],
    ['rect', { x: 14, y: 4, width: 7, height: 10, rx: 1.6 }],
  ],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  check: [['path', { d: 'M4.5 12.5l5 5L19.5 7' }]],
  refresh: [
    ['path', { d: 'M20 12a8 8 0 1 1-2.6-5.9' }],
    ['path', { d: 'M20 4v5h-5' }],
  ],
  settings: [
    ['circle', { cx: 12, cy: 12, r: 3.2 }],
    ['path', { d: 'M19.4 14.6a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1z' }],
  ],
  close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  more: [
    ['circle', { cx: 5, cy: 12, r: 1.2, fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: 12, cy: 12, r: 1.2, fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: 19, cy: 12, r: 1.2, fill: 'currentColor', stroke: 'none' }],
  ],
  calendar: [
    ['rect', { x: 3.5, y: 5, width: 17, height: 15.5, rx: 2 }],
    ['path', { d: 'M8 3v4M16 3v4M3.5 10h17' }],
  ],
  inbox: [
    ['path', { d: 'M4 13l2.2-7.2A2 2 0 0 1 8.1 4.4h7.8a2 2 0 0 1 1.9 1.4L20 13' }],
    ['path', { d: 'M4 13h4l1.2 2h5.6L16 13h4v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z' }],
  ],
  folder: [
    ['path', { d: 'M3.5 7.5A2 2 0 0 1 5.5 5.5h3.2l1.6 2h8.2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z' }],
  ],
  book: [
    ['path', { d: 'M5 4.5h9.5A2.5 2.5 0 0 1 17 7v12.5H7.5A2.5 2.5 0 0 1 5 17z' }],
    ['path', { d: 'M5 17a2.5 2.5 0 0 1 2.5-2.5H17' }],
  ],
  sparkle: [
    ['path', { d: 'M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7z' }],
    ['path', { d: 'M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z' }],
  ],
  copy: [
    ['rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }],
    ['path', { d: 'M15 5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15' }],
  ],
  trash: [
    ['path', { d: 'M4 7h16M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7' }],
    ['path', { d: 'M6 7l1 12.2a1.8 1.8 0 0 0 1.8 1.8h6.4a1.8 1.8 0 0 0 1.8-1.8L18 7' }],
  ],
  send: [['path', { d: 'M21 3L10.5 13.5M21 3l-6.6 18-3.9-7.5L3 9.6z' }]],
  chevron: [['path', { d: 'M9 6l6 6-6 6' }]],
  arrow: [['path', { d: 'M5 12h14M13 6l6 6-6 6' }]],
  link: [
    ['path', { d: 'M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11.6 6.7' }],
    ['path', { d: 'M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.5-1.5' }],
  ],
  clock: [
    ['circle', { cx: 12, cy: 12, r: 8.5 }],
    ['path', { d: 'M12 7.5V12l3 2' }],
  ],
  pin: [
    ['path', { d: 'M9 3.5h6l-.8 5.2 3.3 3.3H6.5l3.3-3.3z' }],
    ['path', { d: 'M12 12v8' }],
  ],
  dot: [['circle', { cx: 12, cy: 12, r: 3.2, fill: 'currentColor', stroke: 'none' }]],
}

/** Stroke icon set; `size` defaults to the sidebar's 20px. */
export function Icon({ name, size = 20, strokeWidth = 1.6, className = '' }) {
  const paths = ICONS[name] ?? ICONS.dot
  return h(
    'svg',
    {
      className: `lpm-icon ${className}`.trim(),
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    paths.map(([tag, props], index) => h(tag, { key: index, ...props })),
  )
}

/** A button with a stable, small API. */
export function Button({ variant = 'ghost', size = 'md', icon, children, className = '', ...rest }) {
  return h(
    'button',
    { type: 'button', className: `lpm-btn lpm-btn-${variant} lpm-btn-${size} ${className}`.trim(), ...rest },
    icon === undefined ? null : h(Icon, { name: icon, size: size === 'sm' ? 14 : 16 }),
    children === undefined ? null : h('span', null, children),
  )
}

/** An icon-only button with an accessible label and a tooltip title. */
export function IconButton({ icon, label, size = 16, className = '', ...rest }) {
  return h(
    'button',
    { type: 'button', className: `lpm-iconbtn ${className}`.trim(), 'aria-label': label, title: label, ...rest },
    h(Icon, { name: icon, size }),
  )
}

/** A small rounded label. */
export function Pill({ tone = 'neutral', children, className = '' }) {
  return h('span', { className: `lpm-pill lpm-pill-${tone} ${className}`.trim() }, children)
}

/** Segmented control. */
export function Segmented({ value, options, onChange, ariaLabel }) {
  return h(
    'div',
    { className: 'lpm-seg', role: 'group', 'aria-label': ariaLabel },
    options.map((option) => h(
      'button',
      {
        key: option.value,
        type: 'button',
        className: `lpm-seg-item ${option.value === value ? 'is-active' : ''}`.trim(),
        'aria-pressed': option.value === value,
        onClick: () => onChange(option.value),
        title: option.hint,
      },
      option.label,
    )),
  )
}

/** A labelled form row. */
export function Field({ label, hint, children, wide = false }) {
  return h(
    'label',
    { className: `lpm-field ${wide ? 'is-wide' : ''}`.trim() },
    h('span', { className: 'lpm-field-label' }, label, hint === undefined ? null : h('em', null, hint)),
    children,
  )
}

/** A switch. */
export function Toggle({ checked, onChange, label }) {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      'aria-label': label,
      className: `lpm-switch ${checked ? 'is-on' : ''}`.trim(),
      onClick: () => onChange(!checked),
    },
    h('span', { className: 'lpm-switch-knob' }),
  )
}

/** Modal dialog rendered inside the panel (no portal needed). */
export function Modal({ title, subtitle, onClose, children, footer, width = 560 }) {
  const panelRef = useRef(null)
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return h(
    'div',
    { className: 'lpm-modal-backdrop', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
    h(
      'div',
      { className: 'lpm-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabIndex: -1, ref: panelRef, style: { maxWidth: width } },
      h(
        'header',
        { className: 'lpm-modal-head' },
        h('div', null,
          h('h2', null, title),
          subtitle === undefined ? null : h('p', null, subtitle)),
        h(IconButton, { icon: 'close', label: '关闭', onClick: onClose }),
      ),
      h('div', { className: 'lpm-modal-body' }, children),
      footer === undefined ? null : h('footer', { className: 'lpm-modal-foot' }, footer),
    ),
  )
}

/** Copy-to-clipboard button with transient confirmation. */
export function CopyButton({ text, label = '复制' }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }
  return h(Button, { size: 'sm', variant: 'quiet', icon: copied ? 'check' : 'copy', onClick: copy }, copied ? '已复制' : label)
}

/** A spinner used for first paint and long saves. */
export function Spinner({ label = '加载中' }) {
  return h('span', { className: 'lpm-spinner', role: 'status', 'aria-label': label })
}
