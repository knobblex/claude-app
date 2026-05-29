import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  serverNowMs,
  type ChatTarget,
  type ConversationContext,
  type ConversationSummary,
} from "@/lib/api";
import { IcoSearch, IcoTrash } from "../icons";
import { BtnPrimary, BtnGhost } from "../atoms";
import { cacheDeleteConversation } from "@/lib/cache";

type Row = ConversationSummary;

function relTime(ts: number): string {
  if (!ts) return "";
  // Use server-aligned "now" so a wrong-clocked device doesn't show "3 days
  // ago" on a message it just sent. Offset is updated from the `Date` header
  // of every API response.
  const diff = serverNowMs() / 1000 - ts;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(ts * 1000).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

// Render a short, sub-app-specific badge from a conversation's context binding.
// New context kinds: just add a case here.
function ContextBadge({ context }: { context: ConversationContext | null | undefined }) {
  if (!context) return null;
  let label: string | null = null;
  if (context.kind === "radar_app") {
    const slug = typeof context.slug === "string" ? context.slug : "";
    label = `📡 雷达 · ${slug}`;
  } else if (typeof context.kind === "string") {
    label = context.kind;
  }
  if (!label) return null;
  return (
    <div className="mb-1">
      <span className="inline-block px-1.5 py-[1px] rounded text-[10.5px] font-medium bg-[#fff3e8] text-[#9a3412]">
        {label}
      </span>
    </div>
  );
}

/**
 * List row (mockup screen 1). 14×16 padding, 12px gap, 40px rounded-12 avatar.
 * Title 15.5/600/-0.01em, time 12px/text3, preview 13.5px/text2/clamp-2.
 *
 * iOS-style swipe-to-delete: drag left to reveal a 76px red action; tap it to
 * delete (with confirm).
 */
const SWIPE_REVEAL = 76;            // width of the revealed delete action
const SWIPE_OPEN_THRESHOLD = 30;    // drag past this to snap open
function ChatListRow({
  row,
  onClick,
  onDelete,
}: {
  row: Row;
  onClick: () => void;
  onDelete: () => void;
}) {
  const title = row.title;
  const prefix = row.last_role === "user" ? "你：" : "Claude：";

  const [offset, setOffset] = useState(0);
  const startX = useRef<number | null>(null);
  const startOffset = useRef(0);
  const moved = useRef(false);

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
    startOffset.current = offset;
    moved.current = false;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startX.current == null) return;
    const dx = e.touches[0].clientX - startX.current;
    const next = Math.max(0, Math.min(SWIPE_REVEAL, startOffset.current - dx));
    if (Math.abs(next - startOffset.current) > 4) moved.current = true;
    setOffset(next);
  }
  function onTouchEnd() {
    setOffset(offset > SWIPE_OPEN_THRESHOLD ? SWIPE_REVEAL : 0);
    startX.current = null;
  }
  function handleRowClick() {
    if (offset > 0) {
      setOffset(0);
      return;
    }
    if (moved.current) return;
    onClick();
  }
  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    // eslint-disable-next-line no-alert
    if (!window.confirm(`删除会话「${title}」？此操作不可恢复。`)) {
      setOffset(0);
      return;
    }
    onDelete();
  }

  return (
    <div className="relative bg-notion-bg border-b border-notion-divider overflow-hidden">
      <button
        onClick={handleDelete}
        aria-label="删除会话"
        className="absolute right-0 top-0 bottom-0 grid place-items-center bg-red-600 text-white active:bg-red-700"
        style={{ width: SWIPE_REVEAL }}
      >
        <IcoTrash size={20} />
      </button>
      <button
        onClick={handleRowClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        className="w-full text-left px-4 py-3.5 flex gap-3 bg-notion-bg active:bg-notion-soft"
        style={{
          transform: `translateX(-${offset}px)`,
          transition: startX.current == null ? "transform 0.18s ease-out" : "none",
        }}
      >
        <div className="w-10 h-10 shrink-0 rounded-[12px] grid place-items-center text-[18px] mt-0.5 bg-conv-soft text-conv-deep font-semibold relative">
          💬
          {row.live && (
            <span
              aria-label="正在生成"
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 ring-2 ring-notion-bg animate-pulse"
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[15.5px] font-semibold text-notion-text truncate flex-1" style={{ letterSpacing: "-0.01em" }}>
              {title}
            </span>
            <span className="text-[12px] text-notion-text3 shrink-0 tabular-nums">{relTime(row.last_ts)}</span>
          </div>
          <StatusBadges live={row.live} lastInterruptTs={row.last_interrupt_ts} />
          <ContextBadge context={row.context} />
          <div className="text-[13.5px] text-notion-text2 leading-[1.45] line-clamp-2">
            <span className="text-notion-text3">{prefix}</span>
            {row.last_preview}
          </div>
        </div>
      </button>
    </div>
  );
}

// "Currently generating" wins over "last turn interrupted" — they shouldn't
// co-occur in practice (a new turn moves past the interrupt) but if they do,
// surface the live state.
function StatusBadges({
  live,
  lastInterruptTs,
}: {
  live: boolean | undefined;
  lastInterruptTs: number | undefined;
}) {
  if (live) {
    return (
      <div className="mb-1 inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[10.5px] font-medium bg-emerald-50 text-emerald-700">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        正在生成
      </div>
    );
  }
  if (lastInterruptTs && lastInterruptTs > 0) {
    return (
      <div className="mb-1 inline-block px-1.5 py-[1px] rounded text-[10.5px] font-medium bg-red-50 text-red-700">
        ⚠ 上次中断
      </div>
    );
  }
  return null;
}

function EmptyState({ onFree, onProjects }: { onFree: () => void; onProjects: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-7 text-center">
      <div className="text-[44px] mb-4 grayscale opacity-90">💬</div>
      <h2
        className="font-serif text-[22px] font-semibold text-notion-text mb-2"
        style={{ letterSpacing: "-0.01em" }}
      >
        从这里开始
      </h2>
      <p
        className="text-[14px] text-notion-text2 mb-6 max-w-[240px]"
        style={{ lineHeight: 1.55 }}
      >
        什么都可以问 Claude——写作、分析、脑暴。也可以从某个项目卷宗起头聊。
      </p>
      <div className="flex flex-col gap-2.5 w-full max-w-[240px]">
        <BtnPrimary onClick={onFree}>新对话</BtnPrimary>
        <BtnGhost onClick={onProjects}>从项目起头</BtnGhost>
      </div>
    </div>
  );
}

export function ChatListScreen({
  onOpen,
  onNewFree,
  onNewFromProject,
}: {
  onOpen: (target: ChatTarget) => void;
  onNewFree: () => void;
  onNewFromProject: () => void;
}) {
  const [convs, setConvs] = useState<ConversationSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.listConversations()
      .then((cv) => { if (!cancelled) setConvs(cv); })
      .catch((e) => { if (!cancelled) setErr(String((e as Error).message || e)); });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo<Row[]>(() => {
    const list = [...(convs || [])];
    list.sort((a, b) => b.last_ts - a.last_ts);
    return list;
  }, [convs]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.title || "").toLowerCase().includes(s) ||
      (r.last_preview || "").toLowerCase().includes(s)
    );
  }, [rows, q]);

  const loading = convs === null && !err;

  return (
    <section className="flex-1 min-h-0 flex flex-col bg-notion-soft">
      {err && (
        <div className="bg-red-50 text-red-800 px-4 py-2 text-[13px] border-b border-red-100">
          后端未连通：{err}
        </div>
      )}
      {loading ? (
        <div className="flex-1 grid place-items-center text-notion-text3 text-[14px]">加载中…</div>
      ) : rows.length === 0 ? (
        <EmptyState onFree={onNewFree} onProjects={onNewFromProject} />
      ) : (
        <>
          <div className="px-4 pt-2 pb-2">
            <div className="relative">
              <IcoSearch
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-notion-text3 pointer-events-none"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索对话…"
                className="w-full h-10 pl-9 pr-3 text-[14.5px] bg-notion-bg border border-notion-border rounded-[10px] text-notion-text placeholder:text-notion-text3"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto border-t border-notion-divider">
            {filtered.length === 0 ? (
              <div className="px-6 py-12 text-center text-[14px] text-notion-text3">无匹配</div>
            ) : (
              filtered.map((r) => (
                <ChatListRow
                  key={`conv:${r.id}`}
                  row={r}
                  onClick={() => onOpen({ kind: "conv", id: r.id })}
                  onDelete={async () => {
                    const id = r.id;
                    setConvs((prev) => (prev || []).filter((c) => c.id !== id));
                    cacheDeleteConversation(id);
                    try {
                      await api.deleteConversation(id);
                    } catch (e) {
                      setErr(String((e as Error).message || e));
                      api.listConversations().then(setConvs).catch(() => {});
                    }
                  }}
                />
              ))
            )}
            <div className="h-4" />
          </div>
        </>
      )}
    </section>
  );
}
