# hot_app 项目规范

一台 Mac 上跑的多 app 壳：纯 stdlib Python 后端 + Vite/React 前端 + 一堆 sub-app。本文是开发新功能时的默认约定，不用再问用户。

## 0. 决策默认（除非用户明说改）

| 场景 | 默认 |
|---|---|
| 新建一个"独立功能区"（如点子库、雷达、研究室） | 写成 sub-app，挂 `app/<id>/`，不要塞进 `web/server.py` |
| 调 LLM | 走 `call_claude(prompt)`（同步）或 stream 走壳子的 SSE，**不要直接 import anthropic SDK** |
| 模型选择 | 不指定。用本机 `claude` CLI 默认模型 |
| 存储 | JSONL（消息流）+ JSON index（元数据），不上 SQLite/数据库 |
| 运行时/生成数据落点 | **统一在根目录 `data/` 下**。壳子用 `data/<file>`，sub-app 全部用 `data/sub_app/<id>/...`，不要再在 `app/<id>/` 里建 `data/` / `apps/` / `reports/` 等运行时目录 |
| 鉴权 | 共用壳子 Basic Auth，不要自己再做一层 |
| 端口 | 后端 5051；前端 dev `npm run dev` 默认 5173，自动代理 |
| 前端组件分桌面 / 移动 | 是。`ui/desktop/` 和 `ui/mobile/` 独立写，不要响应式 hack |
| 文档 / README | 用户没要求就不要新建 `.md` 文件 |

---

## 1. 怎么调 LLM —— **唯一正确姿势**

**所有 LLM 调用都走 `claude` CLI 的 subprocess，不调任何 SDK。** 这是项目核心约定，理由：
- 复用本机 Claude Code 的会话目录 (`~/.claude/projects/<encoded-cwd>/`)，手机和终端能共享 session
- 工具/权限/模型都由 CLI 管，后端只关心 prompt 进、文本出
- API key 由 CLI 自己读，后端 `.env` 不存 `ANTHROPIC_API_KEY`

### 1.1 同步调用（标题生成、一次性 distill、点子文档重写）

直接调壳子注入的 `call_claude(prompt: str) -> str`：

```python
# 在 sub-app 里
def bind(ctx):
    global _call_claude
    _call_claude = ctx["services"]["call_claude"]

def some_handler(req):
    reply = _call_claude(build_prompt(...))   # 阻塞，180s 超时
    # reply 是 string，失败时形如 "[错误：...]" 或 "[claude 返回错误：...]"
```

实现见 `web/server.py:104-132`。要点：
- `subprocess.run(["claude", "-p", "--permission-mode", "bypassPermissions"], input=prompt, timeout=180, cwd=ROOT)`
- 错误**不抛异常**，返回 `[...]` 字符串。调用方决定要不要 surface 给前端
- 不要在 `_state_lock` 持有时调 `call_claude`（会把多线程并发串行化）

### 1.2 流式调用（聊天主路径）

不要自己起 subprocess。聊天对话应该挂到**壳子的 `/api/conversations/<id>/stream` 路由**，让壳子做 SSE。如果非要 sub-app 自己流式（很少需要），抄 `web/server.py:722-930` 的 `stream_claude_in_session`，必备参数：

```python
cmd = ["claude", "-p", message,
       "--permission-mode", "bypassPermissions",
       "--output-format", "stream-json", "--verbose",
       "--include-partial-messages",          # 没这个 = 假流式，整段才吐
       "--debug-file", str(per_turn_log)]     # 每轮一个文件，便于事后查
if is_first:
    cmd += ["--session-id", session_id, "--system-prompt", SYSTEM_PROMPT]
else:
    cmd += ["--resume", session_id]
```

读取必须 `bufsize=0` + 二进制 + 每行 `decode("utf-8", "replace")`。`text=True` 会让 Python 缓存到整段结束才输出，破坏 partial streaming（这个坑栽过，别再犯）。

两层超时：`STREAM_IDLE_TIMEOUT=120s`（无新 chunk 杀进程）、`STREAM_MAX_TIMEOUT=1800s`（总时长上限）。每 15s 发 SSE keepalive 防 nginx 504。

### 1.3 Prompt 拼装范式

字符串拼接，**不用模板引擎**。结构固定：
1. 角色定位 + 风格指令（简洁、中文、必要时反驳、不堆 markdown 标题）
2. 注入的上下文（设计文档 / 当前点子 / 卷宗）
3. 最近 N 轮历史（`用户：...` / `你：...`，N 取 10~12）
4. 用户新消息 + 结束符 `你：`

参考 `app/app_radar/api/radar.py` 里的 `build_chat_prompt`。

### 1.4 系统提示约定

- 壳子级（裸聊）：`BARE_SYSTEM_PROMPT`，在 `web/server.py:227` 附近，短句
- Sub-app 级：放在 sub-app 的 prompt builder 里，**不传 `--system-prompt`**（首轮也只用壳子默认），因为我们把上下文塞 prompt body 里更可控
- 例外：要把整个对话 session 绑死到一份 system prompt 时才用 `--system-prompt`（参考裸聊路径）

### 1.5 不要做的事

- ❌ `pip install anthropic` / `from anthropic import ...`
- ❌ 写 `model="claude-3-5-sonnet-..."` 硬编码模型名
- ❌ 重试循环（CLI 自己有重试；上层再重试只会放大尾延迟）
- ❌ 在 prompt 里塞 `<system>` `<user>` XML 标签 —— 走的是 `-p` 而非 messages API
- ❌ 把 `_call_claude` 当 import-time 全局用（`bind()` 跑完才有值）

---

## 2. Sub-app 范式

每个独立功能区是一个 sub-app：`app/<id>/`，壳子启动时扫 `manifest.json` 自动挂载。

### 2.1 目录骨架

代码（入 git）：

```
app/<id>/
├── manifest.json          # id / 路由前缀 / 数据目录 / 前端 entry
├── api/
│   ├── __init__.py        # 只暴露 register(router, ctx)
│   └── <feature>.py       # 实际逻辑：bind(ctx) + handler 函数
└── ui/
    ├── index.ts           # export { manifest, Mobile, Desktop }
    ├── api.ts             # 用 apiFetch 调本 sub-app 的路由
    ├── desktop/           # 桌面组件
    └── mobile/            # 移动组件
```

运行时数据（不入 git，整体 gitignore 在根 `data/`）：

```
data/sub_app/<id>/         # 所有 JSONL / JSON index / markdown 都落这里
├── ...
```

`app/<id>/` 下**只放代码**，**不要建 `data/` / `apps/` / `reports/` 等运行时目录**。所有产出（包括 skill 跑出来的卷宗 markdown、日报等）都进 `data/sub_app/<id>/`。

### 2.2 manifest.json

```json
{
  "id": "ideas",
  "name": "点子库",
  "icon": "lightbulb",
  "version": 1,
  "backend": {
    "module": "app.ideas.api",
    "prefix": "/api/ideas",
    "data_dirs": { "root": ".", "ideas": "ideas", "conversations": "conversations" }
  },
  "frontend": {
    "entry": "ui/index.ts",
    "mobile":  { "openFrom": "projects", "label": "点子库" },
    "desktop": { "section": "projects",   "label": "点子库" }
  }
}
```

`data_dirs` 的 value 是相对 `data/sub_app/<id>/` 的子路径（`"."` 即根本身）。壳子启动时统一拼成 `ROOT / "data" / "sub_app" / <id> / value` 塞进 `ctx`。例：`{ "ideas": "ideas" }` → `<repo>/data/sub_app/ideas/ideas/`。

### 2.3 register / bind 范式

```python
# api/__init__.py — 只做路由表
from . import core
def register(router, ctx):
    core.bind(ctx)
    p = ctx["prefix"]
    router.add("GET",    f"{p}/ideas",                core.list_ideas)
    router.add("POST",   f"{p}/ideas",                core.create_idea)
    router.add("GET",    f"{p}/ideas/<iid>",          core.get_idea)
    # ...
```

```python
# api/core.py — 模块级变量在 bind() 之前是 None，禁止 import 时碰
SUB_ROOT: Path = None  # type: ignore
DATA_DIR: Path = None  # type: ignore
_call_claude = None

def bind(ctx):
    global SUB_ROOT, DATA_DIR, _call_claude
    SUB_ROOT = ctx["sub_root"]
    DATA_DIR = ctx["data_dirs"]["root"]
    _call_claude = ctx["services"]["call_claude"]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
```

`ctx` 内容：`sub_id`、`sub_root`(`Path`)、`data_dirs`(`dict[str, Path]`)、`prefix`(`str`)、`user_name`(`str`，用户显示名，拼 prompt 用)、`services["call_claude"]`。

### 2.4 Handler 签名

```python
def list_ideas(req):                # GET /api/ideas
    req._send_json(200, [...])

def get_idea(req, iid):             # GET /api/ideas/<iid>
    iid = unquote(iid)              # 别忘了解 URL 编码
    ...

def create_idea(req):               # POST /api/ideas
    data = req._read_json_body()
    ...
```

错误统一 `req._send_json(4xx, {"error": "..."})`。

---

## 3. 数据存储

**只用 JSONL + JSON，不上 SQLite/DB。** 单用户单机，文件就够，方便 grep/diff/备份。

### 3.1 落点规则（唯一）

所有运行时 / 生成数据都进根目录 `data/`，整体被 `.gitignore`：

```
data/
├── conversations/                 # 壳子裸聊
├── interrupts/
├── conv_titles.json
├── conv_contexts.json
├── mobile_origin_convs.json
├── pinned_convs.json
├── claude-debug/
└── sub_app/
    ├── ideas/                     # ← sub-app id=ideas
    │   ├── ideas/
    │   ├── conversations/
    │   └── ...
    └── radar/                     # ← sub-app id=radar
        ├── apps/                  # 卷宗 markdown
        ├── games/
        ├── reports/
        ├── notes/
        ├── chats/
        └── ...
```

- 壳子（`web/server.py`）直接写 `data/<file>`
- Sub-app 全部走 `ctx["data_dirs"][...]`，落到 `data/sub_app/<id>/`
- 跑批 / 工具脚本（如 radar 的 fetch / diff）也写 `data/sub_app/<id>/`，**不要**回到 `app/<id>/` 下建运行时目录
- 新建 sub-app **绝不要**写 `app/<id>/data/`、`app/<id>/apps/` 等 — `app/<id>/` 只放代码

### 3.2 文件约定

- **消息流**：`{cid}.jsonl`，一行一条 `{"role", "content", "ts"}`
- **元数据索引**：`index.json` 是 `{id: meta}` 字典，meta 含 `title / last_role / last_preview / last_ts / count / created_ts`
- **业务文档**（点子文档、设计文档）：单独 `.md` 文件，按 id 命名
- **历史 / 版本**：要保留就在文件名加时间戳，如 `<iid>.<ts>.md` 放历史目录

### 3.3 写时机

- append 消息：直接 `open("a")` 追加一行 —— 不需要锁
- 改 index.json：必须在 `with _state_lock:` 里 read-modify-write
- 不要把 `index.json` 锁拿去包 `_call_claude` 调用

---

## 4. 前端约定

栈：Vite + React 18 + TypeScript + Tailwind。无外部状态库，hooks + localStorage 够用。

### 4.1 调后端

只通过 `web-app/src/lib/api.ts` 导出的 `apiFetch<T>(path, init?)`。它会自动：
- 加 Basic Auth header
- 401 时清 localStorage + 抛 `auth-expired` 事件，由 `AuthGate` 接管
- 同步 server-clock（用于"X 分钟前"标签）

Sub-app 在自己的 `ui/api.ts` 里 `import { apiFetch } from "@/lib/api"`，调本 sub-app 的 `/api/<prefix>/...`。

### 4.2 流式聊天

复用 `streamConversation(id, msg, onEvent)` / `attachLive(id, signal, onEvent)`。事件类型见 `StreamEvent` union：`text` / `tool_use` / `tool_result` / `user_message` / `error` / `done`。`done` 必到，到了 reader 主动关。

### 4.3 桌面 vs 移动

**两套独立组件**，不要 `useMediaQuery` + 单组件分支。断点 768px：
- `<768px` → `MobileApp` 渲染 `ui/mobile/...`
- `≥768px` → `DesktopApp` 渲染 `ui/desktop/...`

移动端必须遵守 mobile baseline（见用户 memory）：
- viewport meta + JS 禁双指缩放
- 输入框 font-size ≥ 16px（防 iOS 自动放大）
- safe-area inset 顶/底 padding
- 高度用 `100dvh` 不是 `100vh`

### 4.4 缓存

`web-app/src/lib/cache.ts`：localStorage LRU，存最近 30 个对话详情。新 sub-app 想缓存抄它的 API。

---

## 5. 后端约定（壳子 `web/server.py`）

- 纯 stdlib `BaseHTTPRequestHandler` + `ThreadingHTTPServer`，无 Flask/FastAPI
- 路由通过 `Router` 类（`web/server.py:1218`）正则注册到 `SUB_ROUTES`
- 请求体：`req._read_json_body()`；响应：`req._send_json(status, payload)`
- multipart（语音上传）：`parse_multipart(req)`，见现有 `/api/transcribe`
- SSE：手动写 `text/event-stream`，每事件 `data: <json>\n\n`，每 15s 发 `:keepalive\n\n` 注释

并发模型：每请求一个线程。共享状态（titles、index.json）必须过 `_state_lock`。**锁内不调 LLM、不写大文件。**

---

## 6. 环境 / 启动

`.env`（项目根，已 gitignore）：

```
BASIC_AUTH_USER=<your-username>
BASIC_AUTH_PASS=<random>
USER_NAME=<显示名，可空；空则回落 BASIC_AUTH_USER → "用户">
ARK_API_KEY=<volcengine, 仅语音>
ARK_ASR_MODEL=doubao-seed-asr-2-0
PRODUCT_HUNT_TOKEN=<radar sub-app 用>
```

`.env` 由 `web/server.py:53-61` 手工解析，不依赖 python-dotenv。

启动：

```bash
# 后端
python3 web/server.py            # 占 5051

# 前端 dev（改前端立即热更新）
cd web-app && npm run dev        # 占 5173，代理到 5051

# 前端生产构建（部署/远程用）
cd web-app && npm run build      # 产物 dist/，后端会直接服务
```

远程访问：`cloudflared tunnel --url http://localhost:5051 --protocol http2`。

---

## 7. 添加新 sub-app 的 checklist

1. `app/<id>/manifest.json` —— 抄 `ideas/manifest.json` 改 id / prefix / data_dirs。**`data_dirs` value 写相对路径，落到 `data/sub_app/<id>/` 下**（不要写 `data/...`、不要落回 `app/<id>/`）
2. `app/<id>/api/__init__.py` 写 `register(router, ctx)` 路由表
3. `app/<id>/api/<feature>.py` 写 `bind(ctx)` + handler。要调 LLM 就存 `ctx["services"]["call_claude"]`。所有持久化路径必须从 `ctx["data_dirs"]` 来，不要在 sub-app 目录里拼路径
4. `app/<id>/ui/index.ts` —— `export default { manifest, Mobile, Desktop }`
5. `app/<id>/ui/api.ts` —— 用 `apiFetch` 包装本 sub-app 的路由
6. `app/<id>/ui/mobile/` + `app/<id>/ui/desktop/` 两套组件
7. 重启 `python3 web/server.py`，壳子扫到 manifest 自动挂载（自动 `mkdir -p data/sub_app/<id>/`）；前端 `npm run dev` 热加载
8. 如果 sub-app 配套有 Claude Code skill / 跑批脚本，**它们也只能写 `data/sub_app/<id>/`**，凭证读 `<repo>/.env`

参考实现：**`app/ideas/`**（多点子 + 每点子下多对话 + distill 回写文档）、**`app/app_radar/`**（卷宗库 + per-item 聊天 + 笔记 distill）。
