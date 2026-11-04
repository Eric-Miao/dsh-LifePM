/**
 * Channel connectors for LifePM.
 *
 * Inbound story (one stable contract, many bridges):
 *
 *   any channel → POST /lifepm/inbox  { text, channel }  x-lifepm-token: <token>
 *
 * Telegram is native: the plugin long-polls the Bot API itself, so it needs no
 * public URL, no port forwarding and no tunnel — only a bot token. Feishu and
 * WeCom custom bots are outbound-only, so their inbound direction is a small
 * bridge script (see `bridges/`) posting to the same inbox endpoint. This keeps
 * the plugin dependency-free while every channel shares one ingest pipeline.
 *
 * Outbound story: `notify()` fans a plain-text message out to every configured
 * webhook (Feishu / WeCom / generic) and to the Telegram chat, and the optional
 * daily digest runs the same path once a day.
 *
 * Runtime cursors live in `<dataDir>/.state.json`; that file is bookkeeping,
 * never user content, and can be deleted safely.
 *
 * @module lifepm/connectors
 */

import { promises as fs } from 'node:fs'
import { todayISO } from './store.js'

const REQUEST_TIMEOUT_MS = 15000

export class Connectors {
  /**
   * @param {import('./store.js').LifePMStore} store
   * @param {{ logger?: { warn: Function, info?: Function }, pollSeconds?: number }} [options]
   */
  constructor(store, options = {}) {
    this.store = store
    this.logger = options.logger
    this.pollSeconds = clampSeconds(options.pollSeconds ?? 3)
    this.running = false
    this.loopPromise = null
    this.abort = null
    this.status = {
      telegram: { enabled: false, running: false, ok: false, lastError: undefined, lastPollAt: undefined, chatId: '' },
      notify: 0,
      digest: { enabled: false, hour: 8 },
      lastDigest: undefined,
    }
    this.statePath = store.file('.state.json')
    this.runtime = { telegramOffset: undefined, lastDigest: undefined }
    this.runtimeLoaded = false
    this.digestTimer = null
    this.waiters = new Set()
  }

  /** Whether the Telegram loop should currently run. */
  async desired() {
    const meta = await this.store.meta()
    return meta.connectors
  }

  /** Start the background loops (idempotent). */
  async start() {
    if (this.running) return
    this.running = true
    await this.loadRuntime()
    this.loopPromise = this.telegramLoop()
    this.digestTimer = setInterval(() => {
      void this.runDigestOnce().catch((error) => this.warn(`digest failed: ${message(error)}`))
    }, 60_000)
    this.digestTimer.unref?.()
  }

  /** Stop every loop and in-flight request. */
  async stop() {
    this.running = false
    if (this.digestTimer !== null) {
      clearInterval(this.digestTimer)
      this.digestTimer = null
    }
    this.abort?.abort()
    for (const wake of [...this.waiters]) wake()
    const pending = this.loopPromise
    this.loopPromise = null
    this.status.telegram.running = false
    await pending?.catch(() => undefined)
  }

  /** Set the poll cadence from profile config. */
  setPollSeconds(seconds) {
    this.pollSeconds = clampSeconds(seconds)
  }

  // ------------------------------------------------------------- telegram ---

  /** Long-poll loop; sleeps when Telegram is disabled or unconfigured. */
  async telegramLoop() {
    let failures = 0
    while (this.running) {
      let config
      try {
        config = await this.desired()
      } catch (error) {
        this.warn(`cannot read meta: ${message(error)}`)
        await this.waitFor(5000)
        continue
      }
      const telegram = config.telegram
      const ready = telegram.enabled && telegram.token !== ''
      this.status.telegram.enabled = telegram.enabled
      this.status.telegram.chatId = telegram.chatId
      this.status.telegram.running = ready
      if (!ready) {
        await this.waitFor(4000)
        continue
      }
      try {
        const updates = await this.telegramCall(telegram, 'getUpdates', {
          offset: this.runtime.telegramOffset,
          timeout: 20,
          allowed_updates: ['message'],
        })
        failures = 0
        this.status.telegram.ok = true
        this.status.telegram.lastError = undefined
        this.status.telegram.lastPollAt = new Date().toISOString()
        const list = Array.isArray(updates) ? updates : []
        for (const update of list) {
          this.runtime.telegramOffset = Number(update.update_id) + 1
          await this.handleTelegramUpdate(telegram, update)
        }
        if (list.length > 0) await this.saveRuntime()
      } catch (error) {
        failures += 1
        this.status.telegram.ok = false
        this.status.telegram.lastError = message(error)
        this.warn(`telegram poll failed (${failures}): ${message(error)}`)
        await this.waitFor(Math.min(60_000, 2000 * failures))
        continue
      }
      await this.waitFor(this.pollSeconds * 1000)
    }
  }

  /**
   * Handle one Bot API update.
   * @param {any} telegram config
   * @param {any} update
   */
  async handleTelegramUpdate(telegram, update) {
    const message = update?.message
    if (message === undefined || typeof message.text !== 'string') return
    const text = message.text.trim()
    if (text === '') return
    const from = message.chat?.id
    const name = message.from?.username ?? message.from?.first_name ?? 'telegram'
    let reply
    try {
      if (text === '/start') {
        const meta = await this.store.meta()
        reply = [
          `👋 这是你的 LifePM。当前 chat id：${from}`,
          meta.focus !== '' ? `主线：${meta.focus}` : '',
          '直接发消息 = 收进收件箱。',
          '/today 看今天，/task 建任务，/done 完成，/note 记日记，/help 全部指令。',
        ].filter(Boolean).join('\n')
      } else {
        const result = await this.store.ingest(text, `tg:${name}`)
        reply = result.reply
      }
    } catch (error) {
      reply = `⚠️ ${message(error)}`
    }
    if (telegram.chatId !== '' && String(from) !== telegram.chatId && String(from) !== String(telegram.chatId)) {
      // Still answer the sender, so setup mistakes are visible.
      await this.sendTelegram(telegram, from, '（提示：这个 chat 不等于配置里的 chatId，日报会发往配置的那个。）').catch(() => undefined)
    }
    await this.sendTelegram(telegram, from, reply).catch((error) => this.warn(`telegram reply failed: ${message(error)}`))
  }

  /**
   * Call one Bot API method.
   * @param {any} telegram
   * @param {string} method
   * @param {Record<string, unknown>} payload
   */
  async telegramCall(telegram, method, payload) {
    const base = String(telegram.apiBase || 'https://api.telegram.org').replace(/\/+$/, '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS + (Number(payload.timeout ?? 0) * 1000))
    timer.unref?.()
    try {
      const response = await fetch(`${base}/bot${telegram.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) {
        throw new Error(`telegram ${method}: ${data.description ?? `HTTP ${response.status}`}`)
      }
      return data.result
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Send a Telegram message.
   * @param {any} telegram
   * @param {string | number} chatId
   * @param {string} text
   */
  async sendTelegram(telegram, chatId, text) {
    const payload = {
      chat_id: chatId,
      text: String(text).slice(0, 3900),
      disable_web_page_preview: true,
    }
    return this.telegramCall(telegram, 'sendMessage', payload)
  }

  // -------------------------------------------------------------- outbound ---

  /**
   * Fan a message out to configured channels.
   * @param {string} text
   * @param {{ silent?: boolean }} [options] `silent` skips the Telegram chat
   *   used for digests (used for capture notifications).
   */
  async notify(text, options = {}) {
    const meta = await this.store.meta()
    const connectors = meta.connectors
    const results = []
    for (const entry of connectors.notify) {
      results.push(await this.postWebhook(entry, text))
    }
    if (connectors.telegram.chatId !== '' && connectors.telegram.token !== '' && options.silent !== true) {
      results.push(await this.sendTelegram(connectors.telegram, connectors.telegram.chatId, text).then(() => ({ ok: true, kind: 'telegram' })).catch((error) => ({ ok: false, kind: 'telegram', detail: message(error) })))
    }
    this.status.notify = connectors.notify.length
    return results
  }

  /**
   * Send one webhook payload in the shape its provider expects.
   * @param {{ kind: string, url: string }} entry
   * @param {string} text
   */
  async postWebhook(entry, text) {
    const kind = String(entry.kind ?? 'webhook')
    const payload = kind === 'feishu'
      ? { msg_type: 'text', content: { text } }
      : kind === 'wecom'
        ? { msgtype: 'text', text: { content: text } }
        : { text }
    try {
      const response = await fetchWithTimeout(entry.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await response.text().catch(() => '')
      const providerOk = kind === 'feishu' ? !/"code"\s*:\s*(?!0)\d+/.test(body) : kind === 'wecom' ? !/"errcode"\s*:\s*(?!0)\d+/.test(body) : true
      return { ok: response.ok && providerOk, kind, status: response.status, detail: response.ok && providerOk ? undefined : body.slice(0, 300) }
    } catch (error) {
      return { ok: false, kind, detail: message(error) }
    }
  }

  /**
   * Send a provider-shaped test message, for the settings page.
   * @param {Record<string, any>} input
   */
  async testChannel(input) {
    const kind = String(input.kind ?? 'telegram')
    if (kind === 'telegram') {
      const meta = await this.store.meta()
      const telegram = { ...meta.connectors.telegram, ...(input.token ? { token: String(input.token) } : {}) }
      const chatId = String(input.chatId ?? telegram.chatId ?? '')
      if (telegram.token === '' || chatId === '') return { ok: false, detail: '需要 bot token 和 chat id' }
      try {
        await this.sendTelegram(telegram, chatId, `✅ LifePM 测试消息 · ${todayISO()}`)
        return { ok: true, detail: `已发送到 chat ${chatId}` }
      } catch (error) {
        return { ok: false, detail: message(error) }
      }
    }
    if (input.url === undefined || String(input.url).trim() === '') return { ok: false, detail: '需要 webhook 地址' }
    const result = await this.postWebhook({ kind, url: String(input.url) }, `✅ LifePM 测试消息 · ${todayISO()}`)
    return { ok: result.ok, detail: result.detail === undefined ? '已发送' : result.detail }
  }

  /** Public status for the dashboard. */
  statusView() {
    return {
      telegram: { ...this.status.telegram },
      notify: this.status.notify,
      digest: { ...this.status.digest },
      lastDigest: this.status.lastDigest,
      pollSeconds: this.pollSeconds,
    }
  }

  // ---------------------------------------------------------------- digest ---

  /** Send the daily brief once, when enabled and the configured hour arrives. */
  async runDigestOnce(now = new Date()) {
    const meta = await this.store.meta()
    const digest = meta.connectors.digest
    this.status.digest = { enabled: digest.enabled, hour: digest.hour }
    if (!digest.enabled) return
    if (now.getHours() !== digest.hour) return
    const today = todayISO(now)
    if (this.runtime.lastDigest === today) return
    const configured = meta.connectors.telegram.enabled || meta.connectors.notify.length > 0
    if (!configured) return
    const brief = await this.store.brief()
    const text = `☀️ 早安 · LifePM\n\n${brief}`
    const results = await this.notify(text)
    this.runtime.lastDigest = today
    this.status.lastDigest = today
    await this.saveRuntime()
    this.warn(`digest sent: ${JSON.stringify(results.map((item) => ({ ok: item.ok, kind: item.kind })))}`)
  }

  // ------------------------------------------------------------ bookkeeping ---

  /** Load `.state.json` once. */
  async loadRuntime() {
    if (this.runtimeLoaded) return
    this.runtimeLoaded = true
    try {
      const text = await fs.readFile(this.statePath, 'utf8')
      const parsed = JSON.parse(text)
      if (Number.isFinite(parsed?.telegramOffset)) this.runtime.telegramOffset = Number(parsed.telegramOffset)
      if (typeof parsed?.lastDigest === 'string') this.runtime.lastDigest = parsed.lastDigest
      this.status.lastDigest = this.runtime.lastDigest
    } catch {
      // A missing or corrupt state file is simply a cold start.
    }
  }

  /** Persist the cursor and digest marker. */
  async saveRuntime() {
    try {
      const temp = `${this.statePath}.tmp`
      await fs.writeFile(temp, `${JSON.stringify(this.runtime, null, 2)}\n`, 'utf8')
      await fs.rename(temp, this.statePath)
    } catch (error) {
      this.warn(`cannot persist connector state: ${message(error)}`)
    }
  }

  /** Sleep that `stop()` can interrupt. */
  waitFor(ms) {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        this.waiters.delete(finish)
        resolve()
      }
      const timer = setTimeout(finish, ms)
      timer.unref?.()
      this.waiters.add(finish)
    })
  }

  /** @param {string} messageText */
  warn(messageText) {
    this.logger?.warn?.(`lifepm: ${messageText}`)
  }
}

/**
 * fetch with a hard timeout.
 * @param {string} url
 * @param {RequestInit} init
 */
async function fetchWithTimeout(url, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  timer.unref?.()
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** @param {number} seconds */
function clampSeconds(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value)) return 3
  return Math.min(60, Math.max(1, Math.floor(value)))
}

/** @param {unknown} error */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
