# claude app

把本机的 `claude` CLI 包成一个能在手机上用的 AI 工作台。在一台 Mac 上跑个轻量服务，套上网页/移动界面，于是你在手机 Safari 里就能跟 Claude Code 对话、发语音、跑各种小工具——而且这些对话和你在终端里 `claude --resume` 的是同一份历史，手机起的话题回电脑能接着聊。

架构上是**壳子 + 子应用**：壳子管对话/语音/认证/静态服务，子应用（如 Hot App Radar、点子库）各挂自己的 API 和数据目录，按 `manifest.json` 自动加载。远程访问走 cloudflared 隧道或自建 frp 反向代理，统一由 Basic Auth 保护。

> 不是 SaaS。所有数据都在本机，LLM 调用走本机 `claude` CLI（密钥由 CLI 自己管）；远程只是给同一个人在不同设备上用。

---

## 能干嘛

- **裸对话** — 不绑任何项目的 Claude 对话。后端调 `claude -p` 跑 Claude Code session，session 文件落在 `~/.claude/projects/`，所以**手机里发的对话能在终端用 `claude --resume` 继续**，反之亦然
- **流式回复 + live 重连** — `POST /api/conversations/{id}/stream` 走 SSE 一边生成一边推。前端断网/退后台再回来，连上 `GET /api/conversations/{id}/live` 重放未完成的回复，不丢字。同一条对话已有回合在跑时，第二个请求返回 409，让它改走 `/live` 订阅
- **中断记录** — 流式回复被打断（用户取消、超时、网络）后台落 `data/interrupts/{cid}.jsonl`，下次打开对话能看到「这一段被打断了」的占位
- **自动起标题** — 首轮回复完成后异步起 5–10 字中文标题，写到 [data/conv_titles.json](data/conv_titles.json)
- **置顶对话** — `POST /api/conversations/{id}/pin` 把任意 UUID 对话（包括子应用里生成的）顶到主列表，记录在 [data/pinned_convs.json](data/pinned_convs.json)
- **删除对话** — `DELETE /api/conversations/{id}` 删 session jsonl + 标题 / 置顶 / 中断等 sidecar，`claude --resume` 之后也看不到
- **显示名** — `.env` 里 `USER_NAME` 决定 prompt 和界面里称呼你的名字，前端通过 `GET /api/config` 取一次缓存
- **语音输入** — 手机点麦克风录音 → 火山引擎录音文件识别大模型 → 文字进输入框 → 可选让 Claude 把口语顺成书面语。需要在 `.env` 配 `ARK_API_KEY`（火山引擎 X-Api-Key），不配则麦克风按钮失效
- **子应用** — 当前装了两个：
  - **Hot App Radar** ([app/app_radar/README.md](app/app_radar/README.md)) — 每天扫 Product Hunt + App Store 中/美/日榜单，写 app/game 卷宗，按卷宗跟 Claude 聊点子、distill 笔记
  - **点子库** ([app/ideas/](app/ideas/)) — 把每个点子作为一份可演化的 markdown 文档，每个点子下挂多个对话，对话能 distill 回写到点子文档；每个点子还带一个**素材夹**（上传/在线编辑文件），文本类文件会被注入到该点子的 chat prompt 里
- **远程访问** — 两种方式二选一：cloudflared quick tunnel（零配置，URL 每次变）、或自建 frp 反向代理（自有公网服务器，URL 固定），均由 Basic Auth 保护

---

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│  web/server.py  ·  port 5051  ·  纯 Python stdlib            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Basic Auth (.env)                                      │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ Static     /          → web-app/dist/index.html        │  │
│  │            /assets/*  → web-app/dist/assets/           │  │
│  │ Shell API  /api/conversations               (CRUD)     │  │
│  │            /api/conversations/{id}/stream   (SSE)      │  │
│  │            /api/conversations/{id}/live     (SSE 重连) │  │
│  │            /api/conversations/{id}/pin      (置顶)     │  │
│  │            /api/transcribe  (火山 ASR)                 │  │
│  │            /api/polish      (claude -p 整理口语)       │  │
│  │            /api/config      (显示名等壳子配置)         │  │
│  │            /api/sub-apps    (列已加载的子应用)         │  │
│  │ Sub-apps   /api/<prefix>/*  (按 manifest 分发)         │  │
│  └────────────────────────────────────────────────────────┘  │
│         │ subprocess                                         │
│         ▼                                                    │
│    claude -p   (本机 Anthropic auth)                         │
│         │ writes                                             │
│         ▼                                                    │
│    ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl             │
└──────────────────────────────────────────────────────────────┘
                       ▲
                       │ HTTPS
              ┌────────┴───────┐
              │  cloudflared   │
              │  quick tunnel  │
              └────────┬───────┘
                       ▼
              https://xxx.trycloudflare.com  →  iPhone Safari
```

**子应用怎么挂上来**：[web/server.py](web/server.py) 启动时扫 `app/*/manifest.json`，对每个子应用 `importlib.import_module(manifest.backend.module)`，调它的 `register(router, ctx)`。`ctx` 注入：

- `sub_id` / `sub_root` — 子应用 id 与代码根目录
- `data_dirs` — 解析过的绝对路径，**统一指向 `data/sub_app/<id>/`**（manifest 的 `backend.data_dirs` value 是相对该目录的子路径，`"."` = 根本身）
- `prefix` — 它的 API 前缀，例如 `/api/radar` / `/api/ideas`
- `user_name` — 用户显示名，拼 prompt 用
- `services.call_claude` — 壳子借给子应用的 `claude -p` 同步调用入口
- `services.register_context_resolver` — 子应用可注册一个 `kind`，让某个 conversation 在创建时绑定到本子应用的上下文（卷宗 / 点子文档），后续每轮自动注入到 system prompt

加新子应用 = 新建 `app/<id>/manifest.json` + `api/__init__.py` 暴露 `register`，无需改壳子代码。详细规范见 [CLAUDE.md](CLAUDE.md)。

**Conversation context binding**：裸聊创建对话时可带 `{"context": {"kind": "radar_app", "slug": "..."}}`，壳子把绑定写到 `data/conv_contexts.json`。后续每轮调 LLM 前查表 → 调对应 sub-app 的 resolver → 拿到的 prompt prefix 加到 system prompt 头。重启后绑定还在。

**前端双 shell**：[web-app/src/App.tsx](web-app/src/App.tsx) 用 Tailwind `md:` 断点切——桌面（≥768px）走 [`DesktopApp`](web-app/src/DesktopApp.tsx)，手机走 [`MobileApp`](web-app/src/MobileApp.tsx)。共享 [`lib/api.ts`](web-app/src/lib/api.ts)、[`ChatDrawer`](web-app/src/components/ChatDrawer.tsx)、[`lib/cache.ts`](web-app/src/lib/cache.ts)、[`lib/config.ts`](web-app/src/lib/config.ts)。

---

## 目录结构

代码（入 git）和运行时数据（gitignored）严格分开：`app/<id>/` 只放代码，所有产出都落到根 `data/` 下。

```
claude_app/
├── web/
│   ├── server.py             # 壳子：auth + 裸对话 + 流式 + live 重连 + 语音 + 子应用加载
│   ├── index.html            # 古早 vanilla JS viewer，dist 不存在时兜底
│   └── app.js, style.css     # 同上
├── web-app/                  # React + Vite + Tailwind 主前端，见 web-app/README.md
├── app/
│   ├── __init__.py           # 让 app/ 成为 Python 包
│   ├── app_radar/            # 子应用：Hot App Radar
│   │   ├── manifest.json
│   │   ├── api/              # backend：register + handlers（radar.py 是主体）
│   │   ├── ui/               # 前端：index.ts / api.ts / desktop / mobile
│   │   └── README.md
│   └── ideas/                # 子应用：点子库
│       ├── manifest.json
│       ├── api/              # core.py 是主体
│       ├── ui/               # index.ts / api.ts / FilesPanel.tsx / desktop / mobile
│       └── DESIGN.html       # 设计稿
├── data/                     # 所有运行时 / 生成数据，整体 gitignored
│   ├── conversations/        # 老式 hex-id 裸对话（向后兼容）
│   ├── conv_titles.json      # UUID → 标题
│   ├── conv_contexts.json    # UUID → {kind, ...} 上下文绑定
│   ├── mobile_origin_convs.json   # 手机端创建的 UUID 集合
│   ├── pinned_convs.json     # 置顶到主列表的 UUID 集合
│   ├── interrupts/           # {cid}.jsonl 中断记录
│   ├── claude-debug/         # 每轮流式调用的 --debug-file 输出
│   └── sub_app/              # 子应用运行时数据，按 id 分目录
│       ├── ideas/
│       │   ├── ideas/        # <iid>.md  +  history/<iid>.<ts>.md
│       │   ├── conversations/  # <cid>.jsonl  +  index.json
│       │   └── files/        # <iid>/...  每个点子的素材夹
│       └── radar/
│           ├── apps/ games/ reports/   # 卷宗 markdown + 日报
│           └── chats/ notes/ favorites.json ...
├── .env                      # 凭据（gitignored）
└── .env.example
```

> ⚠️ `app/<id>/` 下**不要**再建 `data/` / `apps/` / `reports/` 等运行时目录。子应用一律通过 `ctx["data_dirs"]` 拿路径，全部落到 `data/sub_app/<id>/`。旧仓库里若残留 `app/<id>/data/` 是历史遗留，可忽略 / 删除。

---

## 快速开始

### 1. 装依赖

后端是纯 stdlib Python，没有 pip 依赖。前端常规 npm：

```bash
cd web-app && npm install
```

> `web-app/dist/` 在 `.gitignore` 里，**clone 后不存在**。不先 build 就直接起 `server.py`，后端会回落到旧的 `web/index.html`（vanilla JS 兜底页），不是 React 前端，也不会报错——这是最容易踩的坑。

### 2. 准备 `.env`

复制 `.env.example` 到 `.env`，按需填：

```bash
# 后端 Basic Auth（手机/远程访问要输的密码）
BASIC_AUTH_USER=<your-username>
BASIC_AUTH_PASS=<24 位随机字符串，自己生成>

# 界面/prompt 里显示的名字；留空回落 BASIC_AUTH_USER → "用户"
USER_NAME=

# 火山引擎录音文件识别大模型（语音输入）
# https://console.volcengine.com/speech/new/setting/apikeys 拿 X-Api-Key
ARK_API_KEY=
ARK_ASR_MODEL=                        # 可选，留空默认 doubao-seed-asr-2-0

# Product Hunt API（radar 子应用扫描时用）
# https://www.producthunt.com/v2/oauth/applications 拿 Developer Token
PRODUCT_HUNT_TOKEN=
```

随机密码：`python3 -c "import secrets;print(secrets.token_urlsafe(18))"`

> **不要**在 `.env` 里设 `ANTHROPIC_API_KEY` —— LLM 走本机 `claude` CLI，密钥由 CLI 自己读。

### 3. 启动

**Dev 模式**（改前端立即生效）：

```bash
# 终端 1：壳子
python3 web/server.py
# → Shell → http://localhost:5051/
# → sub-apps : 2 loaded (radar, ideas)

# 终端 2：前端 dev server with HMR
cd web-app && npm run dev
# → http://localhost:5174/
```

浏览器开 `http://localhost:5174/`。Vite 把 `/api/*` 代理到 5051 并自动注入 Basic Auth 头（从项目根 `.env` 读）。

**生产模式**（手机访问、隧道访问、frp/cloudflared 穿透）：

```bash
cd web-app && npm run build      # 必须先 build，生成 dist/（gitignore 的，不在仓库里）
python3 web/server.py            # 起壳子，直接服务 dist/index.html
# → http://localhost:5051/  直接返回 React 应用，/api/* 是后端
```

> 每次前端代码改动后都要重新 `npm run build`，然后刷新页面。

### 4. 手机远程访问

两种方式，按需选一种（或同时跑都行）。

#### 方式 A：cloudflared quick tunnel（零配置）

```bash
~/.local/bin/cloudflared tunnel --url http://localhost:5051 --protocol http2
```

终端会打印 `https://xxx-yyy-zzz.trycloudflare.com`。手机 Safari 打开 → 输 BASIC_AUTH 用户密码 → 进「对话」tab。

可以 Safari → 分享 → 添加到主屏幕，效果接近原生 app（全屏，没浏览器 chrome）。

> ⚠️ Quick tunnel 每次重启 URL 会变。要固定 URL 得注册免费 Cloudflare 账号 → named tunnel。
>
> ⚠️ 如果 Mac 上跑 ClashX/Mihomo 之类代理，给 `cloudflared` 的规则里加 `DOMAIN-SUFFIX,argotunnel.com,DIRECT`，否则 QUIC/HTTP2 会被劫持成 fake-ip 段连不上。

#### 方式 B：自建 frp 反向代理（URL 固定）

适合手上有公网 VPS 的场景：服务器上跑 `frps`，本机跑 `frpc`，把 5051 反代到 `公网IP:<remotePort>`。URL 不随重启变，且不依赖 Cloudflare 边缘。

下载 frp：<https://github.com/fatedier/frp/releases>。

**服务端**（公网 VPS，跑 `frps`）—— `frps.toml`：

```toml
bindPort = 7000
auth.token = "<和客户端保持一致的随机串>"
```

启动：`./frps -c frps.toml`。云厂商安全组放行 `7000`（frp 控制端口）和准备暴露的 `<remotePort>`。

**客户端**（本机 Mac，跑 `frpc`）—— `frpc.toml`：

```toml
serverAddr = "<你的公网服务器 IP 或域名>"
serverPort = 7000
auth.token = "<和服务端一致的随机串>"

[[proxies]]
name = "hot-app"
type = "tcp"
localIP = "127.0.0.1"
localPort = 5051
remotePort = <和服务端一致的端口>
```

启动：`./frpc -c frpc.toml`。手机 Safari 打开 `http://<公网IP>:<remotePort>/` → 输 Basic Auth → 用。

> ⚠️ frp 本身是裸 TCP 转发，传输不加密。靠后端的 Basic Auth 防陌生人，但**密码会以明文走公网**。要真正安全请在 VPS 上额外挂 Nginx + Let's Encrypt 做 TLS 终结，把 frp 的 `remotePort` 留在内网回环、由 Nginx 反代过去。
>
> ⚠️ `auth.token` 是 frpc/frps 间的握手凭据，泄露会被人接管你的 frps 转发任意端口。建议用 `python3 -c "import secrets;print(secrets.token_urlsafe(24))"` 生成，不要往 git/聊天里贴。
>
> ⚠️ 本机壳子只监听 `127.0.0.1:5051`（`localIP = "127.0.0.1"`），不要改成 `0.0.0.0` —— 那等于在局域网里也裸奔。

---

## Shell API

后端 `/api/*` 全部要求 Basic Auth（静态资源和 OPTIONS preflight 除外）。前端通过 [web-app/src/lib/api.ts](web-app/src/lib/api.ts) 调。

| 路径 | 用途 |
|---|---|
| `GET    /api/conversations` | 列裸对话（合并老式 hex-id + 手机端创建 + 置顶的 Claude session；`?include_cli=1` 把终端创建的也算上） |
| `POST   /api/conversations` | 新建 UUID 对话；body 可传 `{"context": {"kind": "...", ...}}` 绑定上下文 |
| `GET    /api/conversations/{id}` | 详情，含 messages（user_text / assistant_text / tool_use / tool_result）+ 中断记录 + `pinned` / `live` 状态 |
| `POST   /api/conversations/{id}` | 发一条消息，同步返回完整回复 |
| `POST   /api/conversations/{id}/stream` | 同上但 SSE 流式（已有回合在跑则返回 409） |
| `GET    /api/conversations/{id}/live` | SSE 订阅正在进行中的流（断网回来重连用） |
| `POST   /api/conversations/{id}/pin` | `{pinned: bool}` 置顶/取消置顶到主列表 |
| `DELETE /api/conversations/{id}` | 删 session jsonl + 标题/置顶/中断 sidecar |
| `POST   /api/transcribe` | multipart 上传 audio → 火山 ASR → `{text, raw, timings}` |
| `POST   /api/polish` | `{text}` → `claude -p` 顺成书面语 → `{polished}` |
| `GET    /api/config` | 壳子配置（当前只有 `{user_name}`） |
| `GET    /api/sub-apps` | 已加载子应用的 manifest 列表 |

**Claude session 共享**：UUID 化的对话直接走 `claude -p --session-id <uuid>` / `--resume <uuid>`，session 文件写在 `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`，CLI 和 mobile 共享同一份历史。

## 子应用 API

- **Hot App Radar**：前缀 `/api/radar`，详见 [app/app_radar/README.md](app/app_radar/README.md)
- **点子库**：前缀 `/api/ideas`，主要路由：
  - `GET  /api/ideas/ideas` / `POST /api/ideas/ideas` — 列/建点子
  - `GET  /api/ideas/ideas/{iid}` / `POST .../update` / `DELETE` — CRUD
  - `GET  /api/ideas/ideas/{iid}/history` / `GET .../history/{ts}` / `POST .../history/{ts}/restore` — 文档版本
  - `GET  /api/ideas/ideas/{iid}/conversations` / `POST` / `DELETE .../{cid}` — 点子下的多对话
  - `POST /api/ideas/ideas/{iid}/conversations/{cid}/distill` — distill 当前对话 → 重写点子文档（旧版进 history）
  - `GET  /api/ideas/ideas/{iid}/files` / `GET|POST|DELETE .../files/{path}` — 点子素材夹：列目录 / 读写 / 删文件，文本类文件会被注入该点子的 chat prompt
  - 聊天本身复用壳子的 `/api/conversations/{cid}/stream`（创建时绑定 `kind=ideas_conv` 上下文，每轮自动注入点子文档 + 素材夹）

---

## 常见 chore

| 想做 | 怎么做 |
|---|---|
| 改密码 | 改 `.env` 的 `BASIC_AUTH_PASS`，重启 `server.py`。所有现有 session 失效 |
| 改显示名 | 改 `.env` 的 `USER_NAME`，重启 `server.py`（前端 `/api/config` 每次加载取一次） |
| 强行下线远程访问 | 关掉 `cloudflared` / `frpc` 进程即可（服务端 `frps` 也可在 VPS 上关掉） |
| 看后端日志 | 跑 `python3 web/server.py` 的那个终端窗口；`[transcribe]` 行打印每段语音耗时拆解；`[sub-app]` 行打印子应用加载情况 |
| 看某轮流式调用的原始 Claude CLI 输出 | `data/claude-debug/{cid}.{ts}.log` |
| 删某条裸对话 | 界面里删，或 `DELETE /api/conversations/{uuid}`，或手动删 `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` 再清 [data/conv_titles.json](data/conv_titles.json) 对应 key |
| 重新打包前端 | `cd web-app && npm run build` |
| 加一个子应用 | 新建 `app/<id>/manifest.json` + `api/__init__.py`（暴露 `register(router, ctx)`），重启壳子。前端 sub-app 在 [web-app/src/sub-apps/registry.ts](web-app/src/sub-apps/registry.ts) 通过 `import.meta.glob` 自动收集，不用注册 |

---

## 凭据安全

- `.env` 在 `.gitignore` 里，不会进 git；`data/` 也已 gitignore（防止聊天记录、收藏、点子文档、素材进仓库）
- `BASIC_AUTH_PASS` 必须是高强度随机串：拿到隧道 URL 的人会试着撞库，密码弱了就等于把 `claude -p` 给别人用
- `ARK_API_KEY` / `PRODUCT_HUNT_TOKEN` 同理，泄露能被人代刷
- 短信/截图/聊天里**不要贴 `.env` 内容**

---

## 已知坑

- iOS Safari「加到主屏幕」PWA 模式下要 iOS 16.4+ 才能用麦克风；老版本回退到 Safari 浏览器里录音
- ClashX/Mihomo 默认 fake-ip 模式会破坏 cloudflared 的 QUIC 边缘 IP；用 `--protocol http2` 或代理规则放行
- 桌面/手机共用 [`ChatDrawer`](web-app/src/components/ChatDrawer.tsx) 通过 `mobile` prop 控制样式，魔改时两端都要看
- 长按消息（复制、重发）、对话重命名还没做（删除/置顶已有）
