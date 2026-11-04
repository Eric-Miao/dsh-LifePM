# 渠道桥接（可选）

LifePM 本身只有一个收消息的入口：

```
POST http://127.0.0.1:19387/lifepm/inbox?k=<token>
content-type: application/json
{ "text": "想到一个婚礼场地", "channel": "wechat" }
```

返回 `{ ok, reply, action }`。`reply` 可以直接回给用户。token 在 **设置 → 连接器 → Ingest token**。

任何能发 HTTP 的东西都可以接进来。下面是按「靠谱程度」排序的方案。

## 1. Telegram（原生，推荐）

插件自己长轮询 Bot API，不需要公网地址、不需要这个目录里的任何脚本。

1. Telegram 找 `@BotFather` → `/newbot` → 拿到 token
2. 把 token 填进 **设置 → 连接器 → Telegram Bot**
3. 给你的 bot 发 `/start`，它回你 chat id；填进去，打开开关
4. 用法：直接发消息 = 进收件箱；`/today`、`/task …`、`/done …`、`/note …`

## 2. 飞书 / Lark（长连接桥，无需公网）

`feishu.mjs` 用官方 SDK 的 WebSocket 长连接接收事件，同样不需要服务器。

1. [open.feishu.cn](https://open.feishu.cn) 开发者后台 → 创建企业自建应用
2. 添加「机器人」能力；权限勾选 `im:message`、`im:message.p2p_msg`、`im:message.group_at_msg`
3. 事件订阅 → **使用长连接** → 添加 `im.message.receive_v1`
4. 发布版本，管理员审核通过
5. 运行：

```bash
cd plugin/bridges
npm install
FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx LIFEPM_TOKEN=xxx node feishu.mjs
```

之后在飞书里给这个机器人发任何消息，都会进 LifePM，并收到一句确认；`/today` 等指令同样可用。

> 想让它在后台常驻：`nohup … &`，或者用 `launchd`/`pm2`。插件没启动时桥接会报错退出，重启即可。

## 3. 企业微信 / 飞书群机器人（只出不进）

用于「每日摘要」「完成提醒」这类推送。在 **设置 → 连接器 → 群机器人 / Webhook** 里加一行：

- 飞书：群设置 → 群机器人 → 添加「自定义机器人」→ 复制 webhook
- 企业微信：群设置 → 群机器人 → 添加 → 复制 webhook

LifePM 会按各自的 JSON 格式发送，点「发一条测试消息」即可验证。

## 4. 微信（个人号）

个人微信没有官方 bot 接口。为了不被封号，推荐这两条路：

### 4a. iOS 快捷指令 / Android 分享（推荐）

把「分享」变成一次捕获，微信里看到什么都行：

1. 快捷指令 App → 新建 → 添加「获取剪贴板」「获取 URL 内容」
2. URL：`http://<你的 Mac 局域网 IP>:19387/lifepm/inbox?k=<token>`
   方法：POST；请求体 JSON：`{"text": "<剪贴板>", "channel": "wechat"}`
3. 打开「在共享表单中显示」，设为只接收文本
4. 以后在微信里长按消息 → 分享 → 选择这个快捷指令

> 局域网访问需要把 web server 绑定到 `0.0.0.0`，见 `README.md` 的「从手机访问」。只在可信网络里这么做。

### 4b. Wechaty（自担风险）

`wechaty.mjs` 是一个模板：它把你发到「文件传输助手」的消息转发进 LifePM。需要你自备可用的 puppet（付费服务或企业号），并自行承担账号风险。

## 5. 其它（n8n / Zapier / 自写脚本）

一个 `curl` 就够：

```bash
curl -s -X POST 'http://127.0.0.1:19387/lifepm/inbox?k=TOKEN' \
  -H 'content-type: application/json' \
  -d '{"text":"/task 订机票 due:周五 #旅行","channel":"curl"}'
```

## 指令

| 输入 | 结果 |
| --- | --- |
| 任意文字 | 收进收件箱 |
| `/today` | 返回今天的三件事与到期项 |
| `/task 内容 #项目 @我 !p1 due:周五` | 直接建任务（放在「现在」） |
| `/done 关键词` | 按标题/ID 匹配并完成 |
| `/note 内容` | 记进今天的日记 |
| `/help` | 指令列表 |
