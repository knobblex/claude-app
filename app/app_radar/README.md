# Hot App Radar

`hot_app` 的子应用：每天扫 Product Hunt + App Store 中/美/日榜单，把候选 app/game 写成 markdown 卷宗，然后在 Web/手机上浏览卷宗、按卷宗跟 Claude 聊点子、把对话 distill 成笔记。

壳子、远程访问、双 shell 见根目录 [README.md](../../README.md)。这份 README 只讲 radar 子应用本身。

---

## 形态

- **每日扫描** — `hot-app-radar` Skill（Claude Code 系统级技能）调 PH GraphQL + 抓 App Store 榜单，给每个新发现并行起 subagent 生成卷宗（评分、tagline、可迁移分析）。可挂 cron 自动跑
- **桌面雷达** — Notion 风三栏：sidebar 浏览 app 列表，detail 看卷宗，右抽屉跟 Claude 聊「这个 app 的机制能套到哪儿」
- **手机端** — 从「项目」tab 进雷达，看卷宗、按卷宗起对话
- **per-app 对话** — 给具体卷宗起的对话会绑定 `context = {kind: "radar_app", slug}`，每轮自动把卷宗内容注入到 system prompt
- **distill 笔记** — 一键把一段对话提炼成 bullet 笔记，落 `data/sub_app/radar/notes/{slug}.md`

---

## 目录

代码（入 git）：

```
app/app_radar/
├── manifest.json              # id=radar, prefix=/api/radar
├── api/
│   ├── __init__.py            # 只做路由表（register）
│   └── radar.py               # 实际逻辑 + register_context_resolver("radar_app", ...)
└── ui/
    ├── index.ts               # 默认导出 { manifest, Mobile, Desktop }
    ├── api.ts                 # 用 apiFetch 包 /api/radar/*
    ├── desktop/
    └── mobile/
```

运行时/生成数据（gitignored，统一落根 `data/`）：

```
data/sub_app/radar/
├── INDEX.md                   # apps 总览（人读，skill 维护）
├── GAMES_INDEX.md             # games 总览
├── apps/                      # app 卷宗（markdown + frontmatter）
├── games/                     # game 卷宗
├── reports/                   # 每日扫描日报
├── favorites.json
├── chats/{slug}.jsonl         # per-app 对话历史
├── notes/{slug}.md            # distill 笔记
├── seen.json                  # 已收录 app slug（去重用）
├── seen_games.json
├── candidates.json
├── game_candidates.json
├── conv_index.json
└── snapshots/                 # 每日榜单原始快照
```

> ⚠️ 旧路径 `app/app_radar/{data,apps,games,reports,INDEX.md,GAMES_INDEX.md}` 已废弃，迁移到 `data/sub_app/radar/` 下。

---

## API

前缀 `/api/radar`。全部要求 Basic Auth。

| 路径 | 用途 |
|---|---|
| `GET  /api/radar/apps` | 所有 app 卷宗摘要（含分数、收藏、用户标签） |
| `GET  /api/radar/apps/{slug}` | 单个 app（frontmatter + markdown body） |
| `GET  /api/radar/favorites` | 收藏列表 |
| `POST /api/radar/favorites/{slug}` | 收藏/取消/写备注/打标签 |
| `GET  /api/radar/chats` | 所有 per-app 对话摘要 |
| `GET  /api/radar/chat/{slug}` | per-app 对话历史 |
| `POST /api/radar/chat/{slug}` | per-app 发消息（同步返回） |
| `POST /api/radar/conversation/{slug}` | 在壳子的 UUID 对话体系里**新建一个绑定到该 slug 的 conversation**（context = `radar_app:{slug}`），返回 cid。之后走壳子的 `/api/conversations/{cid}/stream` 即可流式聊，每轮自动注入卷宗 |
| `GET  /api/radar/ideas` | 从所有卷宗抽出的 idea bullet |
| `GET  /api/radar/notes/{slug}` | 读 distill 笔记 |
| `POST /api/radar/notes/{slug}` | 把当前对话 distill 成笔记追加 |
| `POST /api/radar/note-suggestions/{slug}` | 让 Claude 给几条候选笔记 |

注：原先 per-app 聊天是 sub-app 自己跑 `claude -p`（`/api/radar/chat/...`），新流程改走壳子的 conversation + context resolver，所以前端推荐用 `POST /api/radar/conversation/{slug}` 拿 cid 后走流式。`/chat/{slug}` 同步接口暂保留兼容。

---

## 每日扫描

`hot-app-radar` Skill 的工作：

1. 调 Product Hunt GraphQL 拿当日票数 ≥ 50 的新品
2. 抓 App Store 中/美/日的 Top Free / Top Paid（新进榜或排名跳升 ≥ 20）
3. 跟 `data/sub_app/radar/seen.json` 比对去重
4. 用并行 subagent 给每个候选生成卷宗（评分新颖度/可迁移/付费潜力/平均分，写 markdown）
5. 写入 `data/sub_app/radar/apps/` 或 `data/sub_app/radar/games/` + 更新 `seen.json` + 在 `data/sub_app/radar/reports/{date}/` 写日报 + 更新 `data/sub_app/radar/INDEX.md` / `GAMES_INDEX.md`

要自动跑：用 Claude Code 的 `/schedule` 创建一个 cron，每天定时触发 `/hot-app-radar`。

---

## Context resolver

`radar.py` 在 `bind(ctx)` 里调：

```python
ctx["services"]["register_context_resolver"]("radar_app", _radar_app_context)
```

`_radar_app_context({"kind":"radar_app","slug":"foo"})` 读卷宗 markdown 返回 system prompt prefix。壳子在每轮 LLM 调用前查 `data/conv_contexts.json` (壳子级) 拿 binding，调 resolver，把 prefix 拼到 system prompt 头。

加新的「按 X 起对话」类型只需新增一个 kind 和 resolver。

---

## 设置 & 行为

**桌面端「聊天抽屉」**：

- ⌘ ↵ 发送
- 「提炼点子」按钮把当前对话 distill 成 `data/sub_app/radar/notes/{slug}.md`

**手机端「我 → 设置」**：

- **录音转写后自动整理** — 开了之后语音录完自动调 `/api/polish` 顺，省一步
- 主题 / 默认语言 / 字号 — UI 占位

---

## 常见 chore

| 想做 | 怎么做 |
|---|---|
| 重置某 app 的 per-app 对话 | `rm data/sub_app/radar/chats/{slug}.jsonl` |
| 清掉某 app 的笔记 | `rm data/sub_app/radar/notes/{slug}.md` |
| 让扫描重新拾到一个已收录的 app | 编辑 `data/sub_app/radar/seen.json` 删掉对应 slug |
| 看某天扫了啥 | `data/sub_app/radar/reports/{date}/` |
