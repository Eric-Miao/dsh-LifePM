#!/usr/bin/env node
/**
 * Feishu / Lark bridge — receives bot messages over the official WebSocket
 * long connection (no public URL, no tunnel) and forwards them into LifePM.
 *
 * Setup (once):
 *   1. open.feishu.cn → 开发者后台 → 创建企业自建应用
 *   2. 添加「机器人」能力；权限里勾选
 *        im:message（接收与发送消息）
 *        im:message.group_at_msg（群里 @ 机器人）
 *        im:message.p2p_msg（单聊）
 *   3. 事件订阅 → 订阅方式选「使用长连接」，添加事件 im.message.receive_v1
 *   4. 发布版本，等管理员审核通过
 *   5. cd plugin/bridges && npm install
 *
 * Run:
 *   FEISHU_APP_ID=cli_xxx \
 *   FEISHU_APP_SECRET=xxx \
 *   LIFEPM_TOKEN=<the token in LifePM 设置 → 连接器> \
 *   node feishu.mjs
 *
 * LifePM answers with a short confirmation, which the bridge posts back into the
 * chat. Commands (/today, /task, /done, /note) work exactly like Telegram.
 */

import * as Lark from '@larksuiteoapi/node-sdk'

const appId = process.env.FEISHU_APP_ID ?? ''
const appSecret = process.env.FEISHU_APP_SECRET ?? ''
const token = process.env.LIFEPM_TOKEN ?? ''
const endpoint = process.env.LIFEPM_URL ?? 'http://127.0.0.1:19387/lifepm/inbox'

if (appId === '' || appSecret === '' || token === '') {
  console.error('缺少环境变量：FEISHU_APP_ID / FEISHU_APP_SECRET / LIFEPM_TOKEN')
  process.exit(1)
}

const client = new Lark.Client({ appId, appSecret })

/** POST one user message into LifePM and return its reply text. */
async function ingest(text, from) {
  const response = await fetch(`${endpoint}?k=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, channel: `feishu:${from ?? 'user'}` }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`)
  return payload.reply ?? '已收到'
}

/** Reply inside the same chat. */
async function reply(messageId, text) {
  await client.im.message.reply({
    path: { message_id: messageId },
    data: {
      msg_type: 'text',
      content: JSON.stringify({ text: String(text).slice(0, 1800) }),
    },
  })
}

const dispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (event) => {
    const message = event?.message
    if (message === undefined) return
    if (message.message_type !== 'text') {
      await reply(message.message_id, '暂时只处理文字消息。').catch(() => undefined)
      return
    }
    let text = ''
    try {
      text = JSON.parse(message.content ?? '{}').text ?? ''
    } catch {
      text = ''
    }
    text = text.replace(/^@_user_\d+\s*/, '').trim()
    if (text === '') return
    const sender = event?.sender?.sender_id?.open_id ?? event?.sender?.sender_id?.user_id
    try {
      const answer = await ingest(text, sender)
      await reply(message.message_id, answer)
    } catch (error) {
      console.error('lifepm ingest failed:', error)
      await reply(message.message_id, `⚠️ ${error.message}`).catch(() => undefined)
    }
  },
})

const wsClient = new Lark.WSClient({ appId, appSecret, loggerLevel: Lark.LoggerLevel.info })
console.log(`LifePM Feishu bridge → ${endpoint}`)
await wsClient.start({ eventDispatcher: dispatcher })
