# lifepm（DSH 插件包）

「人生 PM」的完整实现。Host 只依赖 Node 内置模块，浏览器端只依赖 `react`，因此可以从任意本地路径安装进 DSH profile。

## 结构

```
lib/
  index.js       Host 入口：装配 store / tools / http / connectors
  store.js       Markdown 存储：任务、项目、收件箱、日记、复盘
  mdoc.js        YAML front-matter 的读写（容错，手写改坏不会崩）
  tools.js       8 个 pm_* 模型工具
  http.js        /lifepm/* 路由：面板 API + 渠道入口
  connectors.js  Telegram 长轮询、Webhook 推送、每日摘要
  client.js     浏览器 bundle（由 src/client 构建，勿手改）
src/client/
  index.jsx      注册侧边栏入口与 main 面板
  app.jsx        数据轮询、头部、标签页
  board.jsx      看板、今日、任务卡、收件箱
  drawer.jsx     任务详情编辑
  projects.jsx   项目组合
  journal.jsx    日记与复盘（含迷你 Markdown 渲染）
  settings.jsx   这一季 / 连接器 / 数据
  styles.css     设计系统（跟随 DSH 明暗主题）
bridges/         飞书长连接桥、Wechaty 模板、接入说明
tests/           store / http / host / client 四组测试
```

## Host 契约

```js
export const name = 'lifepm'
export const inject = ['tools']          // cordis 的 inject 是「服务名 → 配置」映射
export function apply(ctx, config)       // config: { dataDir?, pollSeconds? }
```

- 工具通过 `ctx.tools.register()` 的原始契约注册（JSON Schema 参数 + `output.render`）。
- HTTP 通过 `ctx.inject(['webServer'], …)` + `webServer.register({ kind: 'prefix', path: '/lifepm' })`。
- 没有 webServer（headless）时工具照常可用，只是面板与渠道入口不存在。

## 浏览器契约

`package.json` 的 `dsh.client` 声明 `platform: web`，`./client` 指向构建产物：

```js
window.__ModuleLoader__.load({ id: 'lifepm', factory: (require) => { … } })
```

`apply(ctx)` 注册两个 slot：

| slot | 内容 |
| --- | --- |
| `sidebar.panellist` | `id: lifepm`、`order: 30`、`label: 人生 PM` 的图标入口 |
| `main` | `key: lifepm` 的整页面板 |

## 构建

```bash
node scripts/build.mjs     # esbuild → lib/client.js（约 146 kB，未压缩）
node --test --test-force-exit tests/*.mjs
```

`scripts/build.mjs` 只把 esbuild 的 CJS 输出包进 ModuleLoader 工厂；`react` 保持 external，由 web shell 的平台模块表提供。

## HTTP 路由

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/lifepm/api/ping` | 健康检查 |
| GET | `/lifepm/api/state` | 面板全量数据 |
| POST | `/lifepm/api/task` | 增 / 改 / 删任务 |
| POST | `/lifepm/api/project` | 项目 upsert / touch / 删除 |
| POST | `/lifepm/api/meta` | 主线 / 姓名 / 领域 / 连接器 |
| POST | `/lifepm/api/inbox` | 收件箱 add / promote / remove |
| POST | `/lifepm/api/journal` | 追加日记 |
| POST | `/lifepm/api/review` | 生成 / 保存复盘 |
| POST | `/lifepm/api/demo` | 空看板载入示例 |
| POST | `/lifepm/api/connectors/test` | 发送测试消息 |
| POST | `/lifepm/inbox?k=<token>` | 外部渠道入口（token 校验） |

面板写操作要求同源（有 `Origin` 时必须匹配 `Host`）；外部入口只认 `pm.md` 里的 `connectors.token`。
