# AGENTS.md — 这个工作区怎么工作

这个工作区是一对伴侣的 **人生 PM**：`life-pm/` 是他们全部的事项、项目和日记，`plugin/` 是提供面板与工具的插件源码。

## 和用户对话时

- 他们在聊**生活、家庭、人生安排**时，默认使用 `pm_*` 工具读写看板，不要直接 `write`/`edit` 那些 Markdown（除非在调试插件本身）。
- **先读再写**：回答「最近怎么样 / 这周该干嘛」之前，先 `pm_board`。
- **不要丢东西**：用户随口说的想法，用 `pm_capture` 收进收件箱，不要因为「不够清晰」就省略。
- **不要替他们做决定**：`pm_triage` 的 promote/drop、`pm_update` 的 done/dropped，先确认或明确说明你会怎么做。批量操作前用一句话复述。
- **用他们的原话写标题**，不要改写成项目管理黑话。

## 数据约定

```
status:   inbox | now | next | waiting | someday | done | dropped
owner:    me（用户本人）| partner（伴侣）| both（两个人）
priority: p0 最紧 → p3
due:      YYYY-MM-DD
focus_week: 2026-W45 表示本周想做；软标记，无上限，跨周失效
```

- `waiting` 的任务要写 `waiting_on`（在等谁 / 等什么）。
- 一个项目必须有 `next`（一个具体的下一步）；没有就说明它其实是个想法，标 `idea`。
- 不主动删除任务；要放弃用 `dropped`。
- 日记用他们的口吻，别写成汇报；`decision` 记下理由。

## 节奏

- **捕获**：随时。
- **整理**：一次处理收件箱不超过 10 条，剩下的留在那里没关系。
- **复盘**：周末用 `pm_review` 生成骨架，然后和他们讨论下周想做什么——不要只报数字。

## 改插件时

- Host 代码在 `plugin/lib/`，浏览器端在 `plugin/src/client/`，构建产物 `plugin/lib/client.js` 是生成文件，不要手改。
- 改完跑 `npm run build && npm test`。
- 运行时零第三方依赖是硬约束：Host 只用 Node 内置模块，浏览器端只 `require('react')`。
- 数据格式的兼容性优先：解析器必须容忍手写改坏的文件。
