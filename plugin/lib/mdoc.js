/**
 * Markdown document codec for LifePM.
 *
 * Every entity in the store is a plain Markdown file with a YAML front-matter
 * block. The store owns both directions: humans may edit the files by hand and
 * the plugin rewrites them through this module, so the emitter stays inside a
 * deliberately small YAML subset:
 *
 *   key: scalar            quoted or bare string, number, boolean, null
 *   key: [a, b]            inline sequence
 *   key:
 *     - item               block sequence of scalars
 *     - k: v               block sequence of maps
 *       k2: v2
 *   key:
 *     k: v                 one level (n) of nested mappings
 *
 * Anything outside the subset is preserved as a string line so a hand edit can
 * never crash a read. Bodies are kept byte-for-byte (minus normalised line
 * endings and a leading BOM).
 *
 * @module lifepm/mdoc
 */

/** @typedef {Record<string, unknown>} DocData */

const FRONT_MATTER = '---'

/**
 * Split a Markdown file into front-matter data and body.
 * @param {string} text raw file contents
 * @returns {{ data: DocData, body: string }} parsed document
 */
export function parseDocument(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!frontMatterStart(source)) return { data: {}, body: source }
  const end = closingFence(source)
  if (end === -1) return { data: {}, body: source }
  const header = source.slice(4, end.index)
  const body = source.slice(end.next).replace(/^\n+/, (m) => (m.length > 1 ? '\n' : ''))
  let data = {}
  try {
    data = parseYamlBlock(header)
  } catch {
    data = {}
  }
  return { data, body }
}

/**
 * Render a document from data and body.
 * @param {DocData} data front-matter values
 * @param {string} body Markdown body
 * @param {string[]} [order] preferred key order; unknown keys follow in insertion order
 * @returns {string} the file contents
 */
export function stringifyDocument(data, body, order = []) {
  const keys = ordinalKeys(data, order)
  const lines = [FRONT_MATTER]
  for (const key of keys) {
    const value = data[key]
    if (value === undefined) continue
    lines.push(...emitEntry(key, value, 0))
  }
  lines.push(FRONT_MATTER)
  const trimmed = String(body ?? '').replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '')
  return `${lines.join('\n')}\n${trimmed ? `\n${trimmed}\n` : ''}`
}

/** @param {string} source @returns {boolean} whether the file opens with front matter */
function frontMatterStart(source) {
  return source === FRONT_MATTER || source.startsWith(`${FRONT_MATTER}\n`)
}

/** @param {string} source @returns {{ index: number, next: number }} closing fence position */
function closingFence(source) {
  let cursor = 4
  while (cursor <= source.length) {
    const newline = source.indexOf('\n', cursor)
    const lineEnd = newline === -1 ? source.length : newline
    if (source.slice(cursor, lineEnd).trimEnd() === FRONT_MATTER) {
      return { index: cursor - 1, next: newline === -1 ? source.length : newline + 1 }
    }
    if (newline === -1) return { index: -1, next: -1 }
    cursor = newline + 1
  }
  return { index: -1, next: -1 }
}

/**
 * Parse the front-matter block.
 * @param {string} header YAML text between the fences
 * @returns {DocData}
 */
export function parseYamlBlock(header) {
  const lines = header.split('\n').map((line) => line.replace(/\s+$/, ''))
  const state = { lines, index: 0 }
  const value = parseNode(state, 0)
  return isPlainObject(value) ? value : {}
}

/** @typedef {{ lines: string[], index: number }} ParserState */

/** @param {ParserState} state @param {number} indent @returns {unknown} */
function parseNode(state, indent) {
  skipIgnorable(state)
  if (state.index >= state.lines.length) return null
  const line = state.lines[state.index]
  const width = indentOf(line)
  if (width < indent) return null
  if (line.trimStart().startsWith('- ') || line.trim() === '-') return parseSequence(state, width)
  return parseMapping(state, width)
}

/** @param {ParserState} state @param {number} indent @returns {unknown[]} */
function parseSequence(state, indent) {
  const items = []
  while (state.index < state.lines.length) {
    const line = state.lines[state.index]
    if (line.trim() === '') {
      state.index += 1
      continue
    }
    const width = indentOf(line)
    if (width !== indent) break
    const content = line.slice(indent)
    if (!content.startsWith('-')) break
    const rest = content.slice(1).trim()
    state.index += 1
    if (rest === '') {
      items.push(parseNode(state, indent + 1))
      continue
    }
    // `- key: value` starts an inline mapping whose later keys sit at indent+2.
    if (isMappingStart(rest)) {
      const inline = restoreInlineMapping(rest, indent)
      state.index -= 1
      state.lines[state.index] = inline
      items.push(parseNode(state, indent))
      continue
    }
    items.push(parseScalar(rest))
  }
  return items
}

/**
 * `- k: v` is one mapping member; rewrite the dash as indentation so the
 * mapping parser can consume the whole block uniformly.
 * @param {string} rest text after the dash
 * @param {number} indent dash column
 * @returns {string} a line with two extra spaces and no dash
 */
function restoreInlineMapping(rest, indent) {
  return `${' '.repeat(indent + 2)}${rest}`
}

/** @param {ParserState} state @param {number} indent @returns {DocData} */
function parseMapping(state, indent) {
  const data = {}
  while (state.index < state.lines.length) {
    const line = state.lines[state.index]
    if (line.trim() === '') {
      state.index += 1
      continue
    }
    const width = indentOf(line)
    if (width !== indent) break
    const content = line.slice(indent)
    if (content.startsWith('-')) break
    const split = splitKey(content)
    if (split === null) {
      state.index += 1
      continue
    }
    state.index += 1
    if (split.value === '') {
      const next = peekContentLine(state)
      const childIndent = next === null ? indent + 2 : indentOf(next)
      if (next === null || childIndent <= indent) {
        data[split.key] = null
      } else {
        data[split.key] = parseNode(state, childIndent)
      }
    } else if (split.value === '|' || split.value === '>') {
      data[split.key] = parseBlockScalar(state, indent)
    } else {
      data[split.key] = parseScalar(split.value)
    }
  }
  return data
}

/** @param {ParserState} state @param {number} indent @returns {string} */
function parseBlockScalar(state, indent) {
  const lines = []
  while (state.index < state.lines.length) {
    const line = state.lines[state.index]
    if (line.trim() !== '' && indentOf(line) <= indent) break
    lines.push(line.slice(Math.min(indentOf(line), indent + 2)))
    state.index += 1
  }
  return lines.join('\n').replace(/\n+$/, '')
}

/** @param {ParserState} state @returns {string | null} */
function peekContentLine(state) {
  let cursor = state.index
  while (cursor < state.lines.length) {
    if (state.lines[cursor].trim() !== '') return state.lines[cursor]
    cursor += 1
  }
  return null
}

/** @param {ParserState} state */
function skipIgnorable(state) {
  while (state.index < state.lines.length) {
    const line = state.lines[state.index]
    if (line.trim() === '' || line.trimStart().startsWith('#')) state.index += 1
    else return
  }
}

/** @param {string} line @returns {number} leading spaces */
function indentOf(line) {
  const match = /^[ ]*/.exec(line)
  return match === null ? 0 : match[0].length
}

/** @param {string} content @returns {boolean} whether the text opens a mapping member */
function isMappingStart(content) {
  return splitKey(content) !== null
}

/**
 * Split `key: value` at the first top-level colon.
 * @param {string} content line without indentation
 * @returns {{ key: string, value: string } | null}
 */
function splitKey(content) {
  let quote = ''
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    if (quote !== '') {
      if (char === '\\' && quote === '"') index += 1
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === ':' && (index + 1 === content.length || /\s/.test(content[index + 1]))) {
      const key = content.slice(0, index).trim().replace(/^["']|["']$/g, '')
      if (key === '') return null
      return { key, value: content.slice(index + 1).trim() }
    }
  }
  return null
}

/**
 * Parse one scalar token.
 * @param {string} token raw text
 * @returns {unknown}
 */
export function parseScalar(token) {
  const text = token.trim()
  if (text === '' || text === '~' || text === 'null' || text === 'Null' || text === 'NULL') return null
  if (text === 'true' || text === 'True' || text === 'TRUE') return true
  if (text === 'false' || text === 'False' || text === 'FALSE') return false
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) return unquoteDouble(text)
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1).replace(/''/g, "'")
  if (text.startsWith('[') && text.endsWith(']')) return parseInlineSequence(text)
  if (text.startsWith('{') && text.endsWith('}')) return parseInlineMapping(text)
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
    const number = Number(text)
    if (Number.isFinite(number) && String(number) === text.replace(/^\+/, '')) return number
  }
  return text
}

/** @param {string} text @returns {string} */
function unquoteDouble(text) {
  const inner = text.slice(1, -1)
  let out = ''
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index]
    if (char !== '\\') {
      out += char
      continue
    }
    const next = inner[index + 1]
    index += 1
    switch (next) {
      case 'n': out += '\n'; break
      case 't': out += '\t'; break
      case 'r': out += '\r'; break
      case '"': out += '"'; break
      case '\\': out += '\\'; break
      case 'u': {
        const hex = inner.slice(index + 1, index + 5)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16))
          index += 4
        }
        break
      }
      default: out += next ?? ''
    }
  }
  return out
}

/** @param {string} text @returns {unknown[]} */
function parseInlineSequence(text) {
  const inner = text.slice(1, -1).trim()
  if (inner === '') return []
  return splitTopLevel(inner, ',').map((part) => parseScalar(part))
}

/** @param {string} text @returns {DocData} */
function parseInlineMapping(text) {
  const data = {}
  for (const part of splitTopLevel(text.slice(1, -1), ',')) {
    const split = splitKey(part.trim())
    if (split === null) continue
    data[split.key] = parseScalar(split.value)
  }
  return data
}

/**
 * Split on a separator that is outside quotes and brackets.
 * @param {string} text source text
 * @param {string} separator one character
 * @returns {string[]}
 */
function splitTopLevel(text, separator) {
  const parts = []
  let quote = ''
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote !== '') {
      if (char === '\\' && quote === '"') index += 1
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '[' || char === '{') depth += 1
    else if (char === ']' || char === '}') depth = Math.max(0, depth - 1)
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(text.slice(start).trim())
  return parts.filter((part, index) => part !== '' || index === 0)
}

/** @param {unknown} value @returns {value is DocData} */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Emit one `key: value` entry (and its children) as YAML lines.
 * @param {string} key member name
 * @param {unknown} value member value
 * @param {number} indent column
 * @returns {string[]}
 */
function emitEntry(key, value, indent) {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}${key}: []`]
    if (value.every((item) => !isPlainObject(item) && !Array.isArray(item))) {
      return [`${pad}${key}: [${value.map((item) => emitScalar(item)).join(', ')}]`]
    }
    const lines = [`${pad}${key}:`]
    for (const item of value) {
      if (isPlainObject(item)) {
        const entries = Object.entries(item)
        if (entries.length === 0) {
          lines.push(`${pad}  - {}`)
          continue
        }
        const [firstKey, firstValue] = entries[0]
        const firstLines = emitEntry(firstKey, firstValue, indent + 4)
        const [head, ...tail] = firstLines
        lines.push(`${pad}  - ${head.slice(indent + 4)}`)
        lines.push(...tail)
        for (const [childKey, childValue] of entries.slice(1)) lines.push(...emitEntry(childKey, childValue, indent + 4))
      } else {
        lines.push(`${pad}  - ${emitScalar(item)}`)
      }
    }
    return lines
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, child]) => child !== undefined)
    if (entries.length === 0) return [`${pad}${key}: {}`]
    const lines = [`${pad}${key}:`]
    for (const [childKey, childValue] of entries) lines.push(...emitEntry(childKey, childValue, indent + 2))
    return lines
  }
  return [`${pad}${key}: ${emitScalar(value)}`]
}

/**
 * Render a scalar inside the subset. Strings that could be misread are quoted.
 * @param {unknown} value scalar value
 * @returns {string}
 */
export function emitScalar(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (value instanceof Date) return value.toISOString()
  const text = String(value)
  if (text === '') return '""'
  if (needsQuote(text)) return JSON.stringify(text)
  return text
}

/** @param {string} text @returns {boolean} */
function needsQuote(text) {
  if (/[:#[\]{},&*!|>'"%@`]/.test(text[0] ?? '')) return true
  if (/\s$/.test(text) || /^\s/.test(text)) return true
  if (/[\n\r\t]/.test(text)) return true
  if (/^(?:true|false|null|~|-?\d+(?:\.\d+)?)$/i.test(text)) return true
  if (/^[-?:][\s]/.test(text)) return true
  if (text.includes(': ') || text.endsWith(':') || text.includes(' #')) return true
  return false
}

/** @param {DocData} data @param {string[]} order @returns {string[]} */
function ordinalKeys(data, order) {
  const present = Object.keys(data).filter((key) => data[key] !== undefined)
  const preferred = order.filter((key) => present.includes(key))
  const rest = present.filter((key) => !preferred.includes(key))
  return [...preferred, ...rest]
}

/** Canonical front-matter key order for every task file. */
export const TASK_KEYS = [
  'id', 'title', 'status', 'priority', 'owner', 'project', 'area',
  'due', 'focus_week', 'waiting_on', 'tags', 'created', 'updated', 'done_at',
]

/** Canonical front-matter key order for every project file. */
export const PROJECT_KEYS = [
  'id', 'name', 'status', 'area', 'owner', 'target', 'next', 'why', 'last_active', 'created', 'updated',
]

/** Canonical front-matter key order for the store meta file. */
export const META_KEYS = [
  'focus', 'bet', 'quarter', 'people', 'areas', 'connectors', 'created', 'updated',
]
