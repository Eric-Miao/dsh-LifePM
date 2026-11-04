#!/usr/bin/env node
/**
 * Wechaty bridge (微信) — OPTIONAL AND BEST-EFFORT.
 *
 * Personal WeChat has no official bot API. Anything that automates a personal
 * account sits outside WeChat's terms and can lose the account, so this bridge
 * is shipped as a template, not as a supported channel:
 *
 *   - It needs a Wechaty puppet you have legitimate access to (paid providers,
 *     a work account, or a test account). The open-source web puppet no longer
 *     works for most accounts.
 *   - You must accept the risk yourself. For most couples the recommended
 *     "微信 → LifePM" path is an iOS Shortcut (see README.md): share a message
 *     to a shortcut, it POSTs into the same inbox, nothing to ban.
 *
 * Run:
 *   cd plugin/bridges && npm install
 *   WECHATY_PUPPET=wechaty-puppet-service \
 *   WECHATY_PUPPET_SERVICE_TOKEN=xxx \
 *   LIFEPM_TOKEN=xxx \
 *   node wechaty.mjs
 *
 * Messages you send to yourself (文件传输助手) become inbox items, so you can
 * forward anything worth keeping into your own LifePM without a bot at all.
 */

const token = process.env.LIFEPM_TOKEN ?? ''
const endpoint = process.env.LIFEPM_URL ?? 'http://127.0.0.1:19387/lifepm/inbox'
const selfChatName = process.env.WECHAT_SELF_CHAT ?? '文件传输助手'

if (token === '') {
  console.error('缺少 LIFEPM_TOKEN')
  process.exit(1)
}

let Wechaty
try {
  ;({ Wechaty, ScanStatus, log } = await import('wechaty'))
} catch {
  console.error('先安装：cd plugin/bridges && npm install wechaty')
  process.exit(1)
}

async function ingest(text) {
  const response = await fetch(`${endpoint}?k=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, channel: 'wechat' }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`)
  return payload.reply ?? ''
}

const bot = Wechaty.instance({ name: 'lifepm-wechat' })

bot.on('scan', (qrcode, status) => {
  if (status === ScanStatus.Waiting || status === ScanStatus.Timeout) {
    console.log(`扫码登录：https://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`)
  }
})

bot.on('login', (user) => console.log(`登录成功：${user}`))

bot.on('message', async (message) => {
  try {
    if (message.self() === false) return
    const room = message.room()
    if (room !== null) return
    const talker = message.talker()
    if (talker.name() !== selfChatName) return
    const text = message.text().trim()
    if (text === '') return
    await ingest(text)
    console.log('→', text)
  } catch (error) {
    console.error('bridge failed:', error.message)
  }
})

await bot.start()
