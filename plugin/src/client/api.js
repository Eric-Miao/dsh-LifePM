/**
 * Dashboard API client.
 *
 * Every call is same-origin against the Host route registered at `/lifepm`.
 * The base resolves from `document.baseURI` so a deployment mounted under a
 * sub-path keeps working, with a root-absolute fallback.
 */

const BASE = new URL('lifepm/api/', document.baseURI)

/**
 * @param {string} path endpoint below `/lifepm/api/`
 * @param {Record<string, unknown>} [body] JSON body; omit for GET
 */
export async function request(path, body) {
  const url = new URL(path, BASE).href
  const response = await fetch(url, body === undefined
    ? { headers: { accept: 'application/json' }, cache: 'no-store' }
    : {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      })
  const text = await response.text()
  let payload = {}
  if (text !== '') {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { error: text }
    }
  }
  if (!response.ok) throw new Error(payload.error ?? `请求失败（${response.status}）`)
  return payload
}

export const api = {
  state: () => request('state'),
  createTask: (input) => request('task', { op: 'create', ...input }),
  updateTask: (id, patch) => request('task', { op: 'update', id, patch }),
  deleteTask: (id) => request('task', { op: 'delete', id }),
  saveProject: (input) => request('project', { op: 'upsert', ...input }),
  deleteProject: (id) => request('project', { op: 'delete', id, unlinkTasks: true }),
  touchProject: (id) => request('project', { op: 'touch', id }),
  saveMeta: (patch) => request('meta', patch),
  journal: (text, kind, date) => request('journal', { text, kind, date }),
  capture: (text, channel = 'app') => request('inbox', { op: 'add', text, channel }),
  removeInbox: (index) => request('inbox', { op: 'remove', index }),
  promoteInbox: (index, input = {}) => request('inbox', { op: 'promote', index, ...input }),
  writeReview: (week) => request('review', { op: 'write', week }),
  saveReview: (week, body) => request('review', { op: 'save', week, body }),
  focusToday: () => request('focus-today', {}),
  seedDemo: () => request('demo', {}),
  testChannel: (input) => request('connectors/test', input),
}
