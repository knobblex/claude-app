---
name: hot-app-radar
description: Scan Product Hunt and App Store top charts (cn/us/jp) for new and trending apps AND games, analyze each candidate's feature points and value, and write into a personal idea library at app/app_radar/. Invoke when the user types /hot-app-radar, asks to "scan apps", "scan games", "update idea library", "look for new apps", or "find product ideas".
---

# Hot App Radar

每日扫 Product Hunt + App Store（中/美/日）热榜，找出新进榜或大幅上升的 App / 游戏，拆解功能、提炼可迁移点子，沉淀到个人点子库。

App 与游戏走两条独立的工作流，输出落到不同目录、用不同的分析维度，互不污染。

## 工作目录

> 抓取 / 计算脚本会**自己定位到仓库根**（靠脚本自身路径上溯，与当前目录无关）：输出固定落到 `$RADAR_DATA`、凭证固定从 `<repo>/.env` 读，在哪个目录跑都一样。
> 但下文示例里的 `bash`/`python3` 命令用的是**相对仓库根的脚本路径**，所以执行它们时当前目录要停在仓库根（或把命令里的脚本路径换成绝对路径）。

所有运行时/生成数据统一落在 **`data/sub_app/radar/`**（下文记作 `$RADAR_DATA`）。脚本本体在 `app/app_radar/.claude/skills/hot-app-radar/scripts/`。

- 输出（App）：`$RADAR_DATA/reports/YYYY-MM-DD.md`、`$RADAR_DATA/apps/{slug}.md`、`$RADAR_DATA/INDEX.md`
- 输出（游戏）：`$RADAR_DATA/reports/games-YYYY-MM-DD.md`、`$RADAR_DATA/games/{slug}.md`、`$RADAR_DATA/GAMES_INDEX.md`
- 状态：`$RADAR_DATA/snapshots/`（每日原始 JSON）
  - App：`$RADAR_DATA/seen.json`、`$RADAR_DATA/candidates.json`
  - 游戏：`$RADAR_DATA/seen_games.json`、`$RADAR_DATA/game_candidates.json`

你（Claude）自己写卷宗 / 报告时，直接写到 `$RADAR_DATA/...`（即 `data/sub_app/radar/...`，相对仓库根，或用绝对路径），**不需要 `cd` 进去**——`cd` 会让上面那些相对路径的 `bash`/`python3` 命令找不到脚本。**绝不要再往 `app/app_radar/apps`、`app/app_radar/games`、`app/app_radar/reports`、`app/app_radar/data` 写**（旧位置已迁移）。

## 调用方式

- 默认（无参数 / "scan"）：**两条线都跑**，先 App 后游戏。
- "只扫 App" / "skip games"：只跑 App 工作流。
- "只扫游戏" / "scan games" / "/hot-app-radar games"：只跑游戏工作流。

## App 工作流

每次被调用时按顺序做：

### 1. 抓数据

并行运行两个 fetch 脚本：

```bash
bash app/app_radar/.claude/skills/hot-app-radar/scripts/fetch_ph.sh
bash app/app_radar/.claude/skills/hot-app-radar/scripts/fetch_as.sh
```

如果 fetch_ph.sh 报错说缺 `PRODUCT_HUNT_TOKEN`：告诉用户去 `https://www.producthunt.com/v2/oauth/applications` 创建应用拿 Developer Token，写到 `.env`。本次允许跳过 PH 继续跑 App Store。

### 2. 算候选

```bash
python3 app/app_radar/.claude/skills/hot-app-radar/scripts/diff.py
```

输出 `$RADAR_DATA/candidates.json`。规则：
- 新进榜（昨日不在），或
- 排名跳升 ≥20 名，或
- Product Hunt 当日票数 ≥50
- 已在 `$RADAR_DATA/seen.json` 的跳过
- 首次跑（无昨日快照）：每个榜单取 top 30 全部当作新进

### 3. 读候选

读 `$RADAR_DATA/candidates.json`。如果为空数组，直接写一份只有"今日无新候选"的 `$RADAR_DATA/reports/YYYY-MM-DD.md` 然后结束。

### 4. 逐个分析

对每个候选用下面的 schema 拆解。信息源：
- PH 候选：`tagline` + `description` + `topics`
- AS 候选：`description`（来自 iTunes lookup） + `primary_genre`

如果 description 为空或太短（<30字），降级处理：只在当日表里写一句话定义，不出卷宗。

#### 分析 schema

每个候选产出：

- **一句话定义**：10-25 字概括"这个 App 在做什么"
- **核心功能点**：3-5 条 bullet，写"做了什么 + 怎么做"，避免营销话术
- **差异化**：跟同品类已有产品比的特别之处。如果只是常规的 to-do/笔记/翻译/AI 套壳类，明说"无明显差异化"
- **可迁移点子**：1-3 条，必须是脱离这个 App 还成立的设计/机制/交互/商业模式
- **三项评分**（1-5 整数星）：
  - 新颖度：功能或设计有多新（5 = 第一次见）
  - 可迁移性：点子离开本品类还成不成立（5 = 通用方法论）
  - 付费潜力：用户愿意付费的可能性（5 = 明确高客单价 SaaS 模型）

### 5. 写输出

#### 5a. 当日报告 `$RADAR_DATA/reports/YYYY-MM-DD.md`

```markdown
# YYYY-MM-DD 雷达扫描

> 共 X 个候选 | 进卷宗 Y 个

## 候选清单

| App | 来源 | 信号 | 一句话定义 | 新颖/迁移/付费 | 卷宗 |
|-----|------|------|-----------|---------------|------|
| {name} | PH / AS-cn / AS-us / AS-jp | {为何被选中} | ... | 4/5/3 | [→](../apps/{slug}.md) 或 — |

## 重点关注

> 仅列平均分 ≥ 4 的 App，附上"可迁移点子"摘要

- **{name}**（{平均分}/5）— {一句话定义}
  - 可迁移点子：{第一条}
```

#### 5b. App 卷宗 `$RADAR_DATA/apps/{slug}.md`

只对**平均分 ≥ 4 OR 任一项 = 5** 的 App 出卷宗。slug 规则：
- PH：用 `slug` 字段
- AS：`{country}-{name 转 kebab-case}`，去掉特殊字符

如果 slug 文件已存在，跳过（去重）。

```markdown
---
name: {App Name}
source: {producthunt | appstore-cn | appstore-us | appstore-jp}
url: {官网或商店链接}
first_seen: YYYY-MM-DD
score_novelty: N
score_portability: N
score_revenue: N
score_avg: N.N
tags: [一级分类, 二级标签...]
---

# {App Name}

> 一句话定义

## 核心功能点
- ...
- ...

## 差异化
...

## 可迁移点子

### 1. {点子标题}
{描述：这个机制是什么，可以套到什么场景}

### 2. ...

## 评分理由
- 新颖度 N/5：{一句话理由}
- 可迁移性 N/5：{一句话理由}
- 付费潜力 N/5：{一句话理由}

## 原始信号
{为何被选中。如：当日 PH 票数 234 / 中国区 Top Free 从 #47 升到 #12}

## 链接
- {url}
```

#### 5c. 更新 `$RADAR_DATA/INDEX.md`

读现有 `$RADAR_DATA/INDEX.md`，把本次新出的卷宗插入到表格里，按 `score_avg desc, first_seen desc` 排序。表头不变，只动表体。

### 6. 标记已见

把所有本次处理过的候选（不管有没有出卷宗）追加到 `$RADAR_DATA/seen.json`：

```json
{
  "<id>": {"first_seen": "YYYY-MM-DD", "name": "...", "source": "..."}
}
```

读旧 seen.json → 合并 → 写回。

### 7. 报告给用户

最后向用户简短输出：
- 抓到 X 个候选，Y 个进卷宗
- 平均分最高的 3 个 App 名 + 一句话
- 当日报告链接：`$RADAR_DATA/reports/YYYY-MM-DD.md`

---

## 游戏工作流

游戏是独立一条线 — 用 iTunes 旧版 RSS + 游戏分类（genre 6014）抓 cn/us/jp 的 top-free / top-paid / top-grossing，单独的去重表、单独的报告、单独的索引、单独的分析维度。

### G1. 抓数据

```bash
bash app/app_radar/.claude/skills/hot-app-radar/scripts/fetch_games.sh
```

写入 `$RADAR_DATA/snapshots/games-{country}-{chart}-{DATE}.json`，结构已经被脚本归一化成 `{feed: {results: [...]}}`，跟 App 一致。

### G2. 算候选

```bash
python3 app/app_radar/.claude/skills/hot-app-radar/scripts/diff_games.py
```

输出 `$RADAR_DATA/game_candidates.json`。规则跟 App 一样（新进 / 跳升 ≥20 / 首次跑取 top 30），去重表是 `$RADAR_DATA/seen_games.json`。

### G3. 读候选

读 `$RADAR_DATA/game_candidates.json`。空数组 → 直接写"今日无新游戏"的 `$RADAR_DATA/reports/games-YYYY-MM-DD.md` 然后结束游戏线。

### G4. 逐个分析（游戏专属 schema）

信息源：iTunes lookup 拿到的 `description` + `sub_genres` + `avg_rating` + `rating_count` + `content_rating`。`description` 短于 30 字 → 只在当日表里一句话定义，不出卷宗。

每个候选产出：

- **一句话定义**：10-25 字。例如"赛博空间内的 Roguelike 卡牌肉鸽"
- **核心循环**：一句话写"玩家进来 → 做什么 → 拿到什么反馈 → 为什么再来"
- **玩法亮点**：3-5 条 bullet，写"机制是什么 + 跟同品类怎么不同"
- **美术 / 题材**：风格（像素 / 3D / 二次元 / 写实 / 极简 / 手绘…）+ 题材一句话
- **变现模式**：从 `{买断, IAP, 广告, 订阅, 混合, 完全免费}` 中选；如果信息不足写"未知"
- **上手门槛**：高 / 中 / 低 + 一句理由
- **可迁移点子**：1-3 条，必须脱离这款游戏还成立的机制 / 数值设计 / 商业模式 / 心流编排
- **三项评分**（1-5 整数星）：
  - 玩法新颖度：核心机制有多新（5 = 第一次见这种玩法）
  - 美术辨识度：风格是否一眼能认出（5 = 极强独特视觉锤）
  - 商业模型潜力：从付费意愿 + LTV 角度看（5 = 已被验证可长线高 ARPU 模型）

### G5. 写输出

#### G5a. 当日报告 `$RADAR_DATA/reports/games-YYYY-MM-DD.md`

```markdown
# YYYY-MM-DD 游戏雷达

> 共 X 个候选 | 进卷宗 Y 个

## 候选清单

| 游戏 | 来源 | 信号 | 一句话定义 | 玩法/美术/商业 | 卷宗 |
|------|------|------|-----------|----------------|------|
| {name} | AS-cn-game / AS-us-game / AS-jp-game | {为何被选中} | ... | 4/5/3 | [→](../games/{slug}.md) 或 — |

## 重点关注

> 仅列平均分 ≥ 4 的游戏，附"可迁移点子"摘要

- **{name}**（{平均分}/5）— {一句话定义}
  - 可迁移点子：{第一条}
```

#### G5b. 游戏卷宗 `games/{slug}.md`

只对**平均分 ≥ 4 OR 任一项 = 5** 的游戏出卷宗。slug：`{country}-game-{name 转 kebab-case}`，去掉特殊字符。slug 文件已存在则跳过。

```markdown
---
name: {Game Name}
source: {appstore-game-cn | appstore-game-us | appstore-game-jp}
url: {商店链接}
first_seen: YYYY-MM-DD
sub_genres: [Action, Roguelike, ...]
art_style: {像素 / 3D / 二次元 / ...}
monetization: {买断 / IAP / 广告 / 订阅 / 混合 / 完全免费 / 未知}
onboarding: {高 / 中 / 低}
score_gameplay: N
score_art: N
score_revenue: N
score_avg: N.N
content_rating: {4+ / 9+ / 12+ / 17+}
rating: {avg_rating} ({rating_count})
tags: [一级题材, 玩法标签...]
---

# {Game Name}

> 一句话定义

## 核心循环
...

## 玩法亮点
- ...

## 美术 / 题材
...

## 变现模式
...

## 上手门槛
{高/中/低} — 一句理由

## 可迁移点子

### 1. {点子标题}
{描述：这个机制是什么，可以套到什么场景}

### 2. ...

## 评分理由
- 玩法新颖度 N/5：...
- 美术辨识度 N/5：...
- 商业模型潜力 N/5：...

## 原始信号
{为何被选中。如：CN games top-free 从 #47 升到 #12}

## 链接
- {url}
```

#### G5c. 更新 `$RADAR_DATA/GAMES_INDEX.md`

如果 `$RADAR_DATA/GAMES_INDEX.md` 不存在则新建一份，表头：

```markdown
# 游戏点子库

| 游戏 | 题材 | 美术 | 变现 | 玩法/美术/商业 | 平均分 | 首次发现 | 卷宗 |
|------|------|------|------|----------------|--------|----------|------|
```

把本次新出的游戏卷宗插入表体，按 `score_avg desc, first_seen desc` 排序。

### G6. 标记已见

把所有本次处理过的游戏候选追加到 `$RADAR_DATA/seen_games.json`，结构与 App 的 seen.json 一致。读旧 → 合并 → 写回。

### G7. 报告给用户

游戏线跑完后单独输出：
- 抓到 X 个游戏候选，Y 个进卷宗
- 平均分最高的 3 个游戏 + 一句话
- 当日游戏报告链接：`$RADAR_DATA/reports/games-YYYY-MM-DD.md`

如果 App 和游戏都跑了，分两段总结，先 App 后游戏。

---

## 异常处理

- 任一 fetch 脚本失败：在当日对应报告顶部加 `> ⚠️ {source} 抓取失败：{原因}`，但其他源继续走完
- candidates.json / game_candidates.json 为空：写"今日无新候选"报告即可，不更新对应索引
- iTunes lookup 失败导致 description 为空：当作"信息不足"处理，不出卷宗
- 游戏 fetch 脚本走旧版 RSS，偶发 403 / 503，重试一次失败就跳过该榜单

## 不要做的事

- 不要为了凑数给低质量 App / 游戏（套壳产品、克隆作品）出卷宗
- 不要在卷宗里写营销话术或推销语气
- 不要修改已有的卷宗（除非用户明确要求重新分析）
- 不要跳过 seen.json / seen_games.json 的去重
- 不要把游戏写进 App 的 `$RADAR_DATA/apps/` 或 `$RADAR_DATA/INDEX.md`，反之亦然 — 两条线物理隔离
