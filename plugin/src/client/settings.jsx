import React, { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { usePM } from './context.js'
import { formatStamp } from './format.js'
import { Button, CopyButton, Field, IconButton, Pill, Toggle } from './ui.jsx'

/** Settings: the season's frame, the channels, and the store. */
export function SettingsView() {
  const { data, act, showToast } = usePM()
  const [meta, setMeta] = useState(() => toMetaDraft(data.meta))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMeta(toMetaDraft(data.meta))
  }, [data.meta])

  const save = async (patch, message) => {
    setSaving(true)
    const result = await act(() => api.saveMeta(patch), message)
    setSaving(false)
    return result
  }

  const test = async (input) => {
    const result = await act(() => api.testChannel(input))
    if (result !== null) showToast(result.detail ?? (result.ok ? '已发送' : '发送失败'), result.ok ? 'info' : 'error')
  }

  const ingestUrl = useMemo(() => `${window.location.origin}/lifepm/inbox`, [])
  const token = meta.connectors.token

  return (
    <div className="lpm-view">
      <div className="lpm-settings">
        <SeasonSection meta={meta} setMeta={setMeta} saving={saving} save={save} />
        <ConnectorsSection
          meta={meta}
          setMeta={setMeta}
          data={data}
          saving={saving}
          save={save}
          test={test}
          ingestUrl={ingestUrl}
          token={token}
        />
        <DataSection data={data} act={act} showToast={showToast} />
      </div>
    </div>
  )
}

function SeasonSection({ meta, setMeta, saving, save }) {
  return (
    <section className="lpm-section">
      <header>
        <div>
          <h2>这一季</h2>
          <p>一个季度只押一个赌注。它会出现在看板最上面，也会成为复盘的对照。</p>
        </div>
        <Button size="sm" variant="quiet" disabled={saving} onClick={() => void save({ focus: meta.focus, bet: meta.bet, quarter: meta.quarter }, '已保存')}>
          保存
        </Button>
      </header>

      <Field label="主线" hint="一句话描述这一季的注意力">
        <input
          className="lpm-input"
          value={meta.focus}
          placeholder="把生活安顿下来，再谈远方"
          onChange={(event) => setMeta({ ...meta, focus: event.target.value })}
        />
      </Field>

      <Field label="赌注" hint="愿意为此排除其他事的那一件">
        <input
          className="lpm-input"
          value={meta.bet}
          placeholder="先落脚：定下城市和住处"
          onChange={(event) => setMeta({ ...meta, bet: event.target.value })}
        />
      </Field>

      <div className="lpm-grid-2">
        <Field label="季度">
          <input
            className="lpm-input"
            value={meta.quarter}
            placeholder="2026-Q4"
            onChange={(event) => setMeta({ ...meta, quarter: event.target.value })}
          />
        </Field>
        <Field label="我们俩的名字">
          <div className="lpm-row">
            <input
              className="lpm-input"
              value={meta.people.me}
              aria-label="我的名字"
              onChange={(event) => setMeta({ ...meta, people: { ...meta.people, me: event.target.value } })}
            />
            <input
              className="lpm-input"
              value={meta.people.partner}
              aria-label="TA 的名字"
              onChange={(event) => setMeta({ ...meta, people: { ...meta.people, partner: event.target.value } })}
            />
          </div>
        </Field>
      </div>

      <Field label="生活领域" hint="任务和项目会归到这些领域里">
        <div className="lpm-areas">
          {meta.areas.map((area, index) => (
            <span key={`${area.id}-${index}`} className="lpm-area-chip">
              <input
                className="lpm-input"
                style={{ border: 0, background: 'transparent', width: `${Math.max(3, area.name.length)}em`, padding: '0 2px' }}
                value={area.name}
                aria-label={`领域 ${index + 1}`}
                onChange={(event) => {
                  const areas = [...meta.areas]
                  areas[index] = { ...areas[index], name: event.target.value }
                  setMeta({ ...meta, areas })
                }}
              />
              <button
                type="button"
                aria-label={`删除领域 ${area.name}`}
                onClick={() => setMeta({ ...meta, areas: meta.areas.filter((_, position) => position !== index) })}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            className="lpm-btn lpm-btn-sm lpm-btn-ghost"
            onClick={() => setMeta({ ...meta, areas: [...meta.areas, { id: `area-${meta.areas.length + 1}`, name: '新领域' }] })}
          >
            ＋ 添加
          </button>
        </div>
      </Field>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button size="sm" variant="quiet" disabled={saving} onClick={() => void save({ people: meta.people, areas: meta.areas }, '已保存')}>
          保存领域与名字
        </Button>
      </div>
    </section>
  )
}

function ConnectorsSection({ meta, setMeta, data, saving, save, test, ingestUrl, token }) {
  const connectors = meta.connectors
  const telegram = connectors.telegram
  const status = data.connectors?.telegram

  const setTelegram = (patch) =>
    setMeta({ ...meta, connectors: { ...connectors, telegram: { ...telegram, ...patch } } })
  const setConnectors = (patch) => setMeta({ ...meta, connectors: { ...connectors, ...patch } })

  return (
    <section className="lpm-section">
      <header>
        <div>
          <h2>连接器</h2>
          <p>从微信、飞书、Telegram 或任何能发 HTTP 请求的地方，把想法丢进来。</p>
        </div>
        <div className="lpm-statusline">
          <span className={`lpm-statusdot ${status?.running ? 'ok' : status?.enabled ? 'warn' : ''}`.trim()} />
          {status?.running ? 'Telegram 正在接收' : status?.enabled ? 'Telegram 已开启但未连接' : 'Telegram 未开启'}
        </div>
      </header>

      <div className="lpm-toggle-row">
        <span>Telegram Bot（原生长轮询，不需要公网地址）</span>
        <Toggle checked={telegram.enabled} onChange={(value) => setTelegram({ enabled: value })} label="启用 Telegram" />
      </div>

      <div className="lpm-grid-2">
        <Field label="Bot Token">
          <input
            className="lpm-input"
            type="password"
            autoComplete="off"
            value={telegram.token}
            placeholder="123456:ABC-DEF…"
            onChange={(event) => setTelegram({ token: event.target.value })}
          />
        </Field>
        <Field label="你的 chat id" hint="给 bot 发 /start 即可看到">
          <input
            className="lpm-input"
            value={telegram.chatId}
            placeholder="例如 123456789"
            onChange={(event) => setTelegram({ chatId: event.target.value })}
          />
        </Field>
      </div>

      <p className="lpm-help">
        在 Telegram 里找 <b>@BotFather</b> 发 /newbot，把 token 填到这里；再给你的 bot 发一条 <b>/start</b>，它会告诉你 chat id。
        保存后几秒内生效。
        {status?.lastError ? <span style={{ color: 'var(--lpm-danger)' }}> 最近错误：{status.lastError}</span> : null}
      </p>

      <Field label="群机器人 / Webhook" hint="飞书、企业微信、Slack、n8n…（用于推送摘要）">
        <div className="lpm-rows">
          {connectors.notify.map((entry, index) => (
            <div key={index} className="lpm-row">
              <select
                className="lpm-select"
                value={entry.kind}
                aria-label="渠道类型"
                onChange={(event) => {
                  const notify = [...connectors.notify]
                  notify[index] = { ...notify[index], kind: event.target.value }
                  setConnectors({ notify })
                }}
              >
                <option value="feishu">飞书</option>
                <option value="wecom">企业微信</option>
                <option value="webhook">通用</option>
              </select>
              <input
                className="lpm-input"
                value={entry.url}
                placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…"
                onChange={(event) => {
                  const notify = [...connectors.notify]
                  notify[index] = { ...notify[index], url: event.target.value }
                  setConnectors({ notify })
                }}
              />
              <IconButton icon="send" label="发一条测试消息" onClick={() => void test({ kind: entry.kind, url: entry.url })} />
              <IconButton
                icon="trash"
                label="删除渠道"
                className="is-danger"
                onClick={() => setConnectors({ notify: connectors.notify.filter((_, position) => position !== index) })}
              />
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="ghost"
              icon="plus"
              onClick={() => setConnectors({ notify: [...connectors.notify, { kind: 'feishu', url: '' }] })}
            >
              添加 Webhook
            </Button>
          </div>
        </div>
      </Field>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button size="sm" variant="quiet" onClick={() => void test({ kind: 'telegram', token: telegram.token, chatId: telegram.chatId })}>
          测试 Telegram
        </Button>
        <Button size="sm" variant="primary" disabled={saving} onClick={() => void save({ connectors }, '连接器已保存')}>
          保存连接器
        </Button>
      </div>

      <div style={{ borderTop: '1px solid var(--lpm-line)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="通用入口" hint="任何渠道都可以 POST 到这里">
          <div className="lpm-row">
            <input className="lpm-input lpm-mono" readOnly value={ingestUrl} aria-label="入口地址" />
            <CopyButton text={ingestUrl} label="复制地址" />
          </div>
        </Field>
        <Field label="Ingest token" hint="请求头 x-lifepm-token 或 ?k=">
          <div className="lpm-row">
            <input className="lpm-input lpm-mono" readOnly value={token} aria-label="入口 token" />
            <CopyButton text={token} label="复制 token" />
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => setConnectors({ token: randomToken() })}>
              重新生成
            </Button>
          </div>
        </Field>
        <pre className="lpm-code">{`curl -s -X POST '${ingestUrl}?k=${token || '<token>'}' \\
  -H 'content-type: application/json' \\
  -d '{"text":"想到一个婚礼场地","channel":"wechat"}'`}</pre>
        <p className="lpm-help">
          指令：<b>/task 内容</b> 直接建任务，<b>/done 关键词</b> 完成，<b>/note 内容</b> 写日记，<b>/today</b> 看今天。其他文字一律进收件箱。
        </p>
      </div>

      <div style={{ borderTop: '1px solid var(--lpm-line)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="lpm-toggle-row">
          <span>每日摘要（早上把今天的三件事推给你）</span>
          <Toggle
            checked={connectors.digest.enabled}
            onChange={(value) => setConnectors({ digest: { ...connectors.digest, enabled: value } })}
            label="启用每日摘要"
          />
        </div>
        <div className="lpm-row">
          <span className="lpm-muted" style={{ fontSize: 12 }}>
            发送时间
          </span>
          <select
            className="lpm-select"
            style={{ flex: '0 0 110px' }}
            value={String(connectors.digest.hour)}
            aria-label="摘要发送时间"
            onChange={(event) => setConnectors({ digest: { ...connectors.digest, hour: Number(event.target.value) } })}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={String(hour)}>{`${String(hour).padStart(2, '0')}:00`}</option>
            ))}
          </select>
          <span style={{ flex: '1 1 auto' }} />
          <Button size="sm" variant="quiet" disabled={saving} onClick={() => void save({ connectors }, '摘要设置已保存')}>
            保存摘要
          </Button>
        </div>
      </div>
    </section>
  )
}

function DataSection({ data, act, showToast }) {
  return (
    <section className="lpm-section">
      <header>
        <div>
          <h2>数据</h2>
          <p>全部是本地 Markdown。你可以直接编辑、备份，或者放进 git。</p>
        </div>
      </header>

      <div className="lpm-row">
        <input className="lpm-input lpm-mono" readOnly value={data.dataDir} aria-label="数据目录" />
        <CopyButton text={data.dataDir} label="复制路径" />
      </div>

      <div className="lpm-row" style={{ flexWrap: 'wrap' }}>
        <Pill>{`事项 ${data.stats.total}`}</Pill>
        <Pill>{`项目 ${data.projects.length}`}</Pill>
        <Pill>{`收件箱 ${data.inbox.length}`}</Pill>
        <Pill>{`本周 ${data.week}`}</Pill>
        <Pill>{`生成于 ${formatStamp(data.generatedAt)}`}</Pill>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          size="sm"
          variant="quiet"
          icon="sparkle"
          onClick={async () => {
            const result = await act(() => api.seedDemo(), '示例已载入')
            if (result !== null && result.skipped === true) showToast('已经有内容了，示例只在空看板时载入', 'error')
          }}
        >
          载入示例数据
        </Button>
        <Button size="sm" variant="ghost" icon="refresh" onClick={() => void act(() => api.state())}>
          重新读取
        </Button>
      </div>

      <p className="lpm-help">
        目录结构：<span className="lpm-mono">pm.md · tasks/ · projects/ · inbox.md · journal/ · reviews/</span> · 插件版本 0.1.0
      </p>
    </section>
  )
}

/** Copy meta into editable form state. */
function toMetaDraft(meta) {
  return {
    focus: meta.focus ?? '',
    bet: meta.bet ?? '',
    quarter: meta.quarter ?? '',
    people: { me: meta.people?.me ?? '我', partner: meta.people?.partner ?? 'TA' },
    areas: (meta.areas ?? []).map((area) => ({ ...area })),
    connectors: {
      token: meta.connectors?.token ?? '',
      telegram: {
        enabled: meta.connectors?.telegram?.enabled === true,
        token: meta.connectors?.telegram?.token ?? '',
        chatId: meta.connectors?.telegram?.chatId ?? '',
        apiBase: meta.connectors?.telegram?.apiBase ?? 'https://api.telegram.org',
      },
      notify: (meta.connectors?.notify ?? []).map((entry) => ({ ...entry })),
      digest: {
        enabled: meta.connectors?.digest?.enabled === true,
        hour: meta.connectors?.digest?.hour ?? 8,
      },
    },
  }
}

/** 32 hex characters, generated locally. */
function randomToken() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
