import React from 'react'
import css from './styles.css'
import { App } from './app.jsx'

/** Panel id shared by the sidebar entry and the `main` keyed slot. */
const PANEL_ID = 'lifepm'

/** The panel component, exported so the composition and tests can mount it directly. */
export { App }

/** Services this bundle needs before it mounts. */
export const inject = ['slots']

/** Inject the dashboard stylesheet exactly once per page. */
function installStyles() {
  if (typeof document === 'undefined') return
  const marker = 'lifepm/dashboard.css'
  if (document.querySelector(`style[data-lifepm-css="${marker}"]`) !== null) return
  const style = document.createElement('style')
  style.dataset.lifepmCss = marker
  style.dataset.plugin = 'lifepm'
  style.textContent = css
  document.head.appendChild(style)
}

/** Sidebar glyph: a compass with a life-grid base. */
function SidebarIcon({ size = 20 }) {
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  },
  React.createElement('circle', { cx: 12, cy: 12, r: 8.6 }),
  React.createElement('path', { d: 'M15.7 8.3l-1.9 5.5-5.5 1.9 1.9-5.5z' }),
  React.createElement('circle', { cx: 12, cy: 12, r: 0.9, fill: 'currentColor', stroke: 'none' }))
}

/**
 * Mount the dashboard: one sidebar entry plus the matching full page.
 * @param {any} ctx browser plugin context
 */
export function apply(ctx) {
  installStyles()
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
  }, App))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 30,
    label: '人生 PM',
  }, SidebarIcon))
}
