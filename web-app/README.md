# web-app

`hot_app` 的 React 前端。React 19 + Vite + TypeScript + Tailwind v3。一份 build 同时跑桌面和手机两套 UI，子应用从壳子外部以约定路径自动加载。

整体定位、后端、远程访问见根目录 [README.md](../README.md)。这份 README 只讲前端怎么组织。

---

## 跑起来

```bash
npm install
npm run dev          # http://localhost:5174  ← 带 HMR
npm run build        # → dist/，server.py 直接服务
npm run lint
```

dev server 自动把 `/api/*` 代理到 `http://localhost:5051`，并从根目录 `../.env` 读 `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` 注入 `Authorization` 头——本地开发感觉不到 auth。见 [vite.config.ts](vite.config.ts)。

---

## 双 shell

[src/App.tsx](src/App.tsx) 用 Tailwind `md:` 断点切：

```tsx
<AuthGate>
  <div className="hidden md:contents"><DesktopApp /></div>
  <div className="contents md:hidden"><MobileApp /></div>
  <Toast />
</AuthGate>
```

- **[DesktopApp.tsx](src/DesktopApp.tsx)** — ≥768px，Notion 风三栏
- **[MobileApp.tsx](src/MobileApp.tsx)** — <768px，三 tab（对话 / 项目 / 我）
- 两边共享 [`ChatDrawer`](src/components/ChatDrawer.tsx)，通过 `mobile` prop 切样式。改它时**两端都要看**

---

## 子应用怎么进来

壳子前端不直接 import 子应用。Vite 在 build 时扫一个 glob：

```ts
// src/sub-apps/registry.ts
const modules = import.meta.glob<{ default: SubApp }>(
  "@sub-apps/app/*/ui/index.ts",
  { eager: true }
);
```

`@sub-apps` 别名指向仓库根 `hot_app/`（见 [vite.config.ts](vite.config.ts) `resolve.alias`），所以每个 `hot_app/app/<id>/ui/index.ts` 都会自动注册。子应用 entry 必须默认导出 `{ manifest, Mobile, Desktop }`，类型见 [src/sub-apps/types.ts](src/sub-apps/types.ts)。

当前自动注册的子应用：

- `app/app_radar/ui/` — Hot App Radar
- `app/ideas/ui/` — 点子库

子应用源码住在 web-app **外面**，所以 vite.config 也开了：

- `server.fs.allow` — 让 Vite 允许读项目根之外的文件
- `resolve.alias.react` / `react-dom` 锚定到 `web-app/node_modules`，避免子应用解析时往别处找出第二份 React

加新子应用就是 `hot_app/app/<id>/ui/index.ts` 写好导出，**不用动 web-app 代码**。

---

## 目录

```
src/
├── App.tsx              # 双 shell 路由
├── DesktopApp.tsx       # 桌面三栏
├── MobileApp.tsx        # 手机三 tab
├── main.tsx             # ReactDOM.createRoot
├── index.css            # Tailwind base + 全局变量
├── components/
│   ├── AuthGate.tsx     # 401 时弹账号密码框，存 localStorage["auth.basic.v1"]
│   ├── ChatDrawer.tsx   # 桌面/手机共用的对话面板（含语音 + live 重连）
│   ├── EmptyState.tsx
│   ├── Toast.tsx
│   ├── atoms.tsx        # Button / Card / Input 等小件
│   ├── icons.tsx        # SVG sprite 引用
│   └── mobile/          # MobileTabBar / ChatList / Settings / Projects ...
├── lib/
│   ├── api.ts           # 所有 fetch 集中点；BASE 自动从 baseURI 推
│   ├── auth.ts          # Basic Auth 持久化
│   ├── cache.ts         # localStorage LRU，缓存最近 30 个对话详情
│   ├── voice.ts         # useRecorder hook（MediaRecorder + AnalyserNode 实时电平 + 12 band 波形）
│   ├── settings.ts      # localStorage 设置项
│   ├── markdown.ts      # 简易 markdown 渲染
│   ├── toast.ts         # 全局 toast 触发
│   └── utils.ts
└── sub-apps/
    ├── registry.ts      # 自动注册 hot_app/app/*/ui/index.ts
    └── types.ts         # SubApp / Manifest 类型契约
```

---

## 几个有意思的细节

- **BASE 路径**：[api.ts](src/lib/api.ts) 里 `BASE = new URL(".", document.baseURI).pathname` 从 HTML 的 `<base>` 推前缀。同一份 build 既能在 `/` 也能在 `/frp/xf/` 这种反代下工作，不用重新编
- **SSE 流式 + live 重连**：`POST /api/conversations/{id}/stream` 起一轮流，事件 `text` / `tool_use` / `tool_result` / `user_message` / `keepalive` / `done`。若 UI 中途断开（切 tab、息屏、网络），重连时优先 `GET /api/conversations/{id}/live` 订阅同一轮（壳子保留事件 buffer）；`live` 返回 404 才回退到去读对话详情
- **缓存**：[cache.ts](src/lib/cache.ts) localStorage LRU，存最近 30 个对话详情。打开列表时立即 render cached → 后台 fetch 最新 → 再覆盖。新 sub-app 想缓存抄它的 API
- **录音**：[useRecorder](src/lib/voice.ts) 优先选 `audio/mp4`（iOS Safari 唯一原生支持的容器）；MediaRecorder 不支持时降级到 `audio/webm`。后端走火山 ASR，extension 直接透给火山，无需 afconvert 转码
- **iOS Safari 适配**：禁双指缩放 + `viewport-fit=cover` + `dvh` 高度单位 + 16px input 字号防 zoom + safe-area padding。手机端 baseline 改动要保留这一套
- **React dedup**：`resolve.dedupe + alias` 双保险，确保子应用导入的 React 跟 web-app 是同一份实例，避免 hooks invariant 错误
- **Tailwind v3**：不是 v4。配置在 [tailwind.config.js](tailwind.config.js) + [postcss.config.js](postcss.config.js)

---

## 改前端时的几条规则

- 桌面/手机用同一个 [`ChatDrawer`](src/components/ChatDrawer.tsx)，魔改时**桌面手机两端都要测**
- 移动端默认禁双指缩放；改 viewport meta 之前看一眼 [index.html](index.html) 顶部的注释
- 不要在子应用里直接 import `web-app/src/...` 的内部模块；走 `@sub-apps` 别名或者让子应用自己实现
- 新增 API 调用统一往 [src/lib/api.ts](src/lib/api.ts) 加，不要在组件里散 fetch
- 子应用调本子应用 API 用各自的 `ui/api.ts`，里面 `import { apiFetch } from "@/lib/api"` 包薄壳
