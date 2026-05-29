import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, type ChatMessage, type ChatTarget, type StreamEvent } from "@/lib/api";
import { cacheGetConversation, cachePutConversation } from "@/lib/cache";
import { cn } from "@/lib/utils";
import { useAutoPolish } from "@/lib/settings";
import { useUserName } from "@/lib/config";
import { fmtElapsed, useRecorder } from "@/lib/voice";
import { renderChatMarkdown } from "@/lib/markdown";
import { toast } from "@/lib/toast";
import { IcoMessage, IcoMic, IcoPin, IcoSend, IcoStopSquare, IcoX } from "./icons";

// Tail-anchored render window. Opening a long conversation mounts only the
// last CHAT_WINDOW messages; "加载更早" reveals CHAT_WINDOW more each click.
// Caps the one-time DOM + markdown cost that froze the thread on open.
const CHAT_WINDOW = 40;

function hourGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

async function loadMessages(target: ChatTarget): Promise<ChatMessage[]> {
  const d = await api.getConversation(target.id);
  return d.messages;
}

// Applies one streaming event to the messages array immutably. Used inside
// setMessages(prev => applyStreamEvent(prev, ev)) to keep React state updates
// pure. Handles three event shapes:
//   - text:        token delta → append to trailing pending text block, or
//                  start a new one if the previous block was a tool.
//   - tool_use:    finalize trailing pending text (drop it if empty), push a
//                  new tool_use row immediately so the user sees the call.
//   - tool_result: push a new tool_result row right after the tool_use it
//                  belongs to.
function applyStreamEvent(prev: ChatMessage[], ev: StreamEvent): ChatMessage[] {
  if (ev.type === "user_message") {
    // Sent during live-stream replay so a late joiner sees what was just
    // posted. Dedupe against the last REAL user message in the array — not
    // just the trailing one — because claude CLI flushes the user line to
    // jsonl as soon as the turn starts, so getConversation mid-turn may
    // already return [..., uN, asst_partial], leaving the user msg buried
    // under a partial assistant text. tool_result rows are skipped (they
    // technically carry role:"user" but represent tool output, not user
    // input). If a matching last-user-msg exists, drop this event.
    for (let i = prev.length - 1; i >= 0; i--) {
      const m = prev[i];
      if (m.role !== "user" || m.kind === "tool_result") continue;
      if (m.content === ev.text) return prev;
      break;
    }
    return [...prev, { role: "user", content: ev.text, ts: ev.ts }];
  }
  if (ev.type === "text") {
    const copy = prev.slice();
    const last = copy[copy.length - 1];
    if (last && last.pending && last.kind === "assistant_text") {
      copy[copy.length - 1] = { ...last, content: (last.content || "") + ev.text };
    } else {
      copy.push({
        role: "assistant",
        kind: "assistant_text",
        content: ev.text,
        pending: true,
      });
    }
    return copy;
  }
  if (ev.type === "tool_use") {
    const copy = prev.slice();
    const last = copy[copy.length - 1];
    if (last && last.pending && last.kind === "assistant_text") {
      if (!last.content) copy.pop();
      else copy[copy.length - 1] = { ...last, pending: false };
    }
    copy.push({
      role: "assistant",
      kind: "tool_use",
      content: "",
      tool: ev.tool,
      input: ev.input,
      tool_use_id: ev.tool_use_id,
    });
    return copy;
  }
  if (ev.type === "tool_result") {
    return [
      ...prev,
      {
        role: "user",
        kind: "tool_result",
        content: "",
        tool_use_id: ev.tool_use_id,
        result: ev.result,
        is_error: ev.is_error,
      },
    ];
  }
  if (ev.type === "interrupted") {
    // Finalize any trailing pending assistant text — the turn died, no more
    // tokens are coming. Then push a breadcrumb so the user sees the turn
    // ended unhappily even after refreshing.
    const copy = prev.slice();
    const last = copy[copy.length - 1];
    if (last && last.pending && last.kind === "assistant_text") {
      if (!last.content) copy.pop();
      else copy[copy.length - 1] = { ...last, pending: false };
    }
    copy.push({
      role: "assistant",
      kind: "interrupted",
      content: ev.partial || "",
      reason: ev.reason,
      ts: ev.ts,
    });
    return copy;
  }
  return prev;
}

// Format the most-relevant single-line summary of a tool's input.
// e.g. Bash → command, Read → file_path, ToolSearch → query, etc.
function summarizeToolInput(tool: string, input: unknown): string {
  if (input == null || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  const pick = (key: string) => (typeof i[key] === "string" ? (i[key] as string) : "");
  switch (tool) {
    case "Bash": return pick("command");
    case "Read":
    case "Edit":
    case "Write":
    case "NotebookEdit": return pick("file_path");
    case "ToolSearch": return pick("query");
    case "WebFetch":
    case "WebSearch": return pick("url") || pick("query") || pick("prompt");
    case "Grep": return pick("pattern") + (pick("path") ? ` in ${pick("path")}` : "");
    case "Glob": return pick("pattern");
    case "Agent": return pick("description") || pick("subagent_type");
    case "TodoWrite": {
      const todos = i.todos;
      return Array.isArray(todos) ? `${todos.length} todos` : "";
    }
    default: {
      // Pick first string field as fallback
      for (const k of Object.keys(i)) {
        if (typeof i[k] === "string") return `${k}=${(i[k] as string).slice(0, 60)}`;
      }
      return "";
    }
  }
}

// Tool rows: indent under the message body (24px = dot avatar 18 + 6 gap).
function ToolUseRow({ msg }: { msg: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const summary = summarizeToolInput(msg.tool || "", msg.input);
  return (
    <div className="ml-6 mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex max-w-full items-start gap-1.5 px-2 py-1 rounded text-[12.5px] text-notion-text2 bg-conv-soft border border-conv-soft hover:border-notion-blue/40 active:opacity-80"
      >
        <span className="text-conv-deep text-[10px] mt-[3px] shrink-0">▸</span>
        <span className="font-mono font-semibold text-conv-deep shrink-0">{msg.tool || "tool"}</span>
        {summary && (
          <span className="font-mono text-notion-text3 truncate min-w-0">{summary}</span>
        )}
      </button>
      {open && (
        <pre className="mt-1.5 ml-4 p-2 bg-notion-soft border border-notion-border rounded text-[11.5px] leading-relaxed font-mono text-notion-text2 max-h-60 overflow-auto whitespace-pre-wrap break-words">
{JSON.stringify(msg.input ?? {}, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ToolResultRow({ msg }: { msg: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const result = msg.result || "";
  const preview = result.split("\n").find((l) => l.trim()) || result;
  return (
    <div className="ml-9 mb-2.5 -mt-1">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex max-w-full items-start gap-1.5 px-2 py-1 rounded text-[12px]",
          msg.is_error
            ? "bg-red-50 border border-red-200 text-red-800"
            : "bg-notion-soft border border-notion-border text-notion-text2 hover:border-notion-text3"
        )}
      >
        <span className="text-notion-text3 mt-[2px] shrink-0">↳</span>
        <span className="text-notion-text3 shrink-0 font-mono">{msg.is_error ? "error" : "result"}</span>
        <span className="font-mono truncate min-w-0">{preview.slice(0, 100)}</span>
      </button>
      {open && (
        <pre className="mt-1.5 ml-4 p-2 bg-notion-bg border border-notion-border rounded text-[11.5px] leading-relaxed font-mono text-notion-text2 max-h-72 overflow-auto whitespace-pre-wrap break-words">
{result}
        </pre>
      )}
    </div>
  );
}

/**
 * Thread message item (mockup screens 4-5). No bubbles, document-like.
 *   - 18×18 round dot avatar (user orange T, Claude blue C)
 *   - 12px/600/text2 author name + 11px/text3 timestamp inline
 *   - 15.5px content, leading-1.65, text1, -0.005em letter-spacing
 *   - 24px mb between message blocks
 */
// Tiny status pill that sits next to the "对话" label in the chat header.
// `streaming` wins over `interrupted` since a new live turn means the user
// has effectively moved past the prior failure.
function ChatStatusPill({
  streaming,
  interrupted,
}: {
  streaming: boolean;
  interrupted: boolean;
}) {
  if (streaming) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full text-[10.5px] font-medium bg-emerald-50 text-emerald-700">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        生成中
      </span>
    );
  }
  if (interrupted) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full text-[10.5px] font-medium bg-red-50 text-red-700">
        ⚠ 上次中断
      </span>
    );
  }
  return null;
}

function InterruptedRow({ msg }: { msg: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const fmt = msg.ts
    ? new Date(msg.ts * 1000).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })
    : "";
  const hasPartial = !!(msg.content && msg.content.trim());
  return (
    <div className="mb-6">
      <div className="flex items-start gap-2 px-2.5 py-2 rounded border border-red-300/60 bg-red-50/60 text-[12.5px] text-red-700">
        <span className="text-[11px] mt-[1px] shrink-0">⚠</span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">此轮已中断{fmt && <span className="ml-2 font-normal text-red-600/70">{fmt}</span>}</div>
          <div className="mt-0.5 break-words text-red-600/90">{msg.reason || "未知原因"}</div>
          {hasPartial && (
            <button
              onClick={() => setOpen(!open)}
              className="mt-1 text-[11.5px] text-red-700/80 hover:text-red-800 underline-offset-2 hover:underline"
            >
              {open ? "收起" : "展开"}已收到的部分回复（{msg.content!.length} 字）
            </button>
          )}
          {open && hasPartial && (
            <pre className="mt-1.5 p-2 bg-white/70 border border-red-200 rounded text-[12px] leading-relaxed font-mono text-notion-text2 max-h-72 overflow-auto whitespace-pre-wrap break-words">
{msg.content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

const CommentItem = memo(function CommentItem({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  const userName = useUserName();
  // Markdown parsing is the per-message hot cost. Memoize on content so the
  // 2–3 full re-renders during conversation open (cache paint → fetch →
  // attachLive) reparse nothing, and a finalized block never re-parses on a
  // sibling's update. Hook runs unconditionally — must precede the early
  // returns below. Plain-text branches (user / pending / tool / interrupted)
  // skip the parse entirely.
  const isAssistantText =
    !isUser && !msg.pending &&
    msg.kind !== "tool_use" && msg.kind !== "tool_result" && msg.kind !== "interrupted";
  const html = useMemo(
    () => (isAssistantText ? renderChatMarkdown(msg.content) : ""),
    [isAssistantText, msg.content],
  );

  if (msg.kind === "tool_use") return <ToolUseRow msg={msg} />;
  if (msg.kind === "tool_result") return <ToolResultRow msg={msg} />;
  if (msg.kind === "interrupted") return <InterruptedRow msg={msg} />;

  const avatarChar = isUser ? userName.slice(0, 1) : "C";
  const fmt = msg.ts
    ? new Date(msg.ts * 1000).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })
    : "";
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={cn(
            "inline-grid place-items-center w-[18px] h-[18px] rounded-full text-[10px] font-semibold shrink-0",
            isUser ? "bg-user-soft text-user-deep" : "bg-conv-soft text-conv-deep",
          )}
        >
          {avatarChar}
        </span>
        <span className="text-[12px] font-semibold text-notion-text2">
          {isUser ? userName : "Claude"}
        </span>
        {fmt && <span className="text-[11px] text-notion-text3">{fmt}</span>}
      </div>
      {msg.pending ? (
        <div
          className="text-[15.5px] text-notion-text3 italic whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
          style={{ lineHeight: 1.65, letterSpacing: "-0.005em" }}
        >
          {msg.content}
          <span className="inline-flex items-center ml-1.5">
            <span className="ldot" /><span className="ldot" /><span className="ldot" />
          </span>
        </div>
      ) : !isUser ? (
        <div
          className="chat-md text-[15.5px] text-notion-text break-words [overflow-wrap:anywhere]"
          style={{ lineHeight: 1.65, letterSpacing: "-0.005em" }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div
          className="text-[15.5px] text-notion-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
          style={{ lineHeight: 1.65, letterSpacing: "-0.005em" }}
        >
          {msg.content}
        </div>
      )}
    </div>
  );
});

export function ChatDrawer({
  target,
  onClose,
  onMessagesChanged,
  mobile = false,
}: {
  target: ChatTarget;
  onClose: () => void;
  onMessagesChanged?: () => void;
  mobile?: boolean;
}) {
  const userName = useUserName();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // True while a turn is in flight for this conversation, EVEN IF it was
  // started on another device or before we got here. Updated from:
  //   - initial fetch's `detail.live`
  //   - first non-done event on the always-on attachLive
  //   - the local `sending` flag (this tab is the originator)
  // Cleared when attachLive resolves cleanly (done event).
  const [liveRemote, setLiveRemote] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Tail-anchored render window: only the last `windowSize` messages mount.
  // "加载更早" grows it by CHAT_WINDOW; reset per conversation.
  const [windowSize, setWindowSize] = useState(CHAT_WINDOW);
  const threadRef = useRef<HTMLDivElement>(null);
  // Distance from viewport-top to content-bottom captured right before
  // "加载更早" expands the window, so the layout effect can restore the
  // scroll anchor — prepended messages must appear above, not shove the view.
  const restoreDistRef = useRef<number | null>(null);
  // True while THIS tab's send() is reading the POST /stream response. When
  // set, the always-on attachLive subscription must NOT also apply text /
  // tool events — both code paths receive identical broadcasts and would
  // double-write. `user_message` is exempt: applyStreamEvent dedupes it
  // against the optimistic insert, so always letting it through is safe and
  // necessary for the cross-device case.
  const originatorRef = useRef(false);
  const targetKey = `conv:${target.id}`;

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    // Stale-while-revalidate: synchronously paint from cache so the screen
    // shows previous content instantly on reopen. Network fetch below
    // overwrites with the canonical state.
    const cached = cacheGetConversation(target.id);
    if (cached) setMessages(cached.messages);

    (async () => {
      try {
        const fresh = await api.getConversation(target.id);
        if (cancelled) return;
        // Adopt fresh only if it actually has content. An empty payload
        // means claude CLI's jsonl hasn't been flushed yet (a first turn
        // is still in flight); the live-attach below will replay messages
        // from memory. Calling setMessages([]) here would wipe the screen
        // and overwrite a still-useful cache.
        if (fresh.messages.length > 0) {
          setMessages(fresh.messages);
          cachePutConversation(target.id, fresh);
        }
        if (fresh.live) setLiveRemote(true);
        setPinned(!!fresh.pinned);
        // Attach to the live hub: if a turn is currently running (because
        // we left mid-generation or another device is sending), we'll
        // replay+follow it. Otherwise the server closes the stream
        // immediately and this is a cheap no-op.
        // Vibrate at end of a *real* live turn (saw actual assistant output),
        // not when attach landed on an already-idle stream (server returns
        // immediate `done` and we should be silent). iOS Safari/PWA silently
        // ignores Vibration API; Android phones get a tactile cue.
        let sawAssistantContent = false;
        // True once attachLive actually mutated `messages` (any stream event
        // reached applyStreamEvent). Gates the canonical refetch below: an
        // idle stream returns an immediate `done` and changes nothing, so the
        // 3rd full getConversation+re-render is pure waste — the common case
        // when opening an old conversation.
        let streamMutated = false;
        await api.attachLive(target.id, ac.signal, (ev) => {
          if (cancelled) return;
          if (ev.type === "error") { setErr(ev.error || "出错"); return; }
          if (ev.type === "done") return;
          if (ev.type !== "interrupted") setLiveRemote(true);
          if (originatorRef.current && ev.type !== "user_message") return;
          if (ev.type === "text" || ev.type === "tool_use") sawAssistantContent = true;
          streamMutated = true;
          setMessages((prev) => applyStreamEvent(prev, ev));
        });
        if (!cancelled) setLiveRemote(false);
        if (sawAssistantContent) {
          try { navigator.vibrate?.([60, 40, 60]); } catch { /* unsupported */ }
        }
        if (cancelled || !streamMutated) return;
        // Live closed after a real turn. Pull the canonical persisted state to
        // fix any partial-stream rendering — but again, skip if it's still
        // empty (would mean the turn ended before flushing, unusual but
        // possible).
        const finalState = await api.getConversation(target.id);
        if (cancelled) return;
        if (finalState.messages.length > 0) {
          setMessages(finalState.messages);
          cachePutConversation(target.id, finalState);
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        console.error(e);
      }
    })();
    return () => { cancelled = true; ac.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages.length]);

  // New conversation → collapse the window back to the tail.
  useEffect(() => { setWindowSize(CHAT_WINDOW); }, [targetKey]);

  // After "加载更早" grows the window, restore the scroll anchor so the
  // newly-prepended messages land above without yanking the viewport.
  useLayoutEffect(() => {
    const el = threadRef.current;
    if (el && restoreDistRef.current != null) {
      el.scrollTop = el.scrollHeight - restoreDistRef.current;
      restoreDistRef.current = null;
    }
  }, [windowSize]);

  async function send() {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput("");
    setSending(true);
    setErr(null);

    const optimistic: ChatMessage[] = [
      ...messages,
      { role: "user", content: msg, ts: Math.floor(Date.now() / 1000) },
      // Empty pending placeholder; first text event accretes into it, first
      // tool_use event finalizes/drops it and pushes a tool row instead.
      { role: "assistant", kind: "assistant_text", content: "", pending: true },
    ];
    setMessages(optimistic);

    try {
      originatorRef.current = true;
      try {
        await api.streamConversation(target.id, msg, (ev: StreamEvent) => {
          if (ev.type === "error") {
            setErr(ev.error || "出错");
            return;
          }
          if (ev.type === "done") return;
          setMessages((prev) => applyStreamEvent(prev, ev));
        });
      } finally {
        originatorRef.current = false;
      }
      const fresh = await api.getConversation(target.id);
      // If jsonl hasn't flushed yet, keep the streamed state; don't blank
      // the screen by overwriting with an empty array. Same protection as
      // the mount path above.
      if (fresh.messages.length > 0) {
        setMessages(fresh.messages);
        cachePutConversation(target.id, fresh);
      }
      onMessagesChanged?.();
      // Tactile cue: this turn finished (Android vibrates; iOS no-op).
      try { navigator.vibrate?.([60, 40, 60]); } catch { /* unsupported */ }
    } catch (e) {
      setErr(String((e as Error).message || e));
      // rollback pending
      const fresh = await loadMessages(target).catch(() => messages);
      setMessages(fresh);
    } finally {
      setSending(false);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  async function togglePin() {
    const next = !pinned;
    setPinned(next);  // optimistic
    try {
      await api.setConversationPinned(target.id, next);
    } catch (e) {
      setPinned(!next);  // rollback
      toast(String((e as Error).message || e) || "操作失败", "error");
    }
  }

  function loadEarlier() {
    const el = threadRef.current;
    // Preserve distance-from-bottom across the expansion (see layout effect).
    restoreDistRef.current = el ? el.scrollHeight - el.scrollTop : null;
    setWindowSize((w) => w + CHAT_WINDOW);
  }

  const visibleCount = messages.filter((m) => !m.pending).length;
  // Tail-anchored window slice. Each message keeps its ABSOLUTE index as the
  // React key (the array only ever grows at the tail), so memoized
  // CommentItems survive both window growth and streaming without remounting.
  const sliceStart = Math.max(0, messages.length - windowSize);
  const windowed = sliceStart === 0 ? messages : messages.slice(sliceStart);

  return (
    <aside className={cn(
      "bg-notion-bg flex flex-col min-h-0",
      mobile
        ? "w-full flex-1"                           // mobile: take remaining flex space
        : "shrink-0 h-full drawer-shadow animate-slideIn w-[420px]" // desktop: fixed width side drawer
    )}>
      <div className="shrink-0 h-10 flex items-center justify-between px-3 border-b border-notion-border">
        <div className="flex items-center gap-2">
          <IcoMessage size={14} className="text-notion-text2" />
          <span className="font-semibold text-[14px] text-notion-text">对话</span>
          <ChatStatusPill
            streaming={sending || liveRemote}
            interrupted={
              messages.length > 0 && messages[messages.length - 1].kind === "interrupted"
            }
          />
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={togglePin}
            aria-label={pinned ? "从主列表移除" : "钉到主列表"}
            title={pinned ? "已显示在主对话列表 · 点击移除" : "钉到主对话列表"}
            className={cn(
              "h-8 w-8 grid place-items-center rounded hover:bg-notion-hover",
              pinned ? "text-notion-blue" : "text-notion-text3 hover:text-notion-text2",
            )}
          >
            <IcoPin size={14} filled={pinned} />
          </button>
          {!mobile && (
            <button onClick={onClose} aria-label="关闭聊天"
                    className="h-8 w-8 grid place-items-center rounded text-notion-text2 hover:bg-notion-hover hover:text-notion-text">
              <IcoX size={14} />
            </button>
          )}
        </div>
      </div>

      <div
        ref={threadRef}
        className={cn(
          "flex-1 min-h-0 overflow-y-auto",
          mobile ? "px-[18px] pt-5 pb-4" : "px-5 py-5",
        )}
      >
        {!mobile && (
          <div className="text-[11.5px] uppercase tracking-wider text-notion-text3 font-semibold mb-4">
            {visibleCount} 条
          </div>
        )}
        {messages.length === 0 ? (
          mobile ? (
            // Serif greeting (mockup screen 3). No suggestion chips per YAGNI.
            <div className="flex flex-col items-center justify-center h-full pb-16 px-6">
              <h2
                className="font-serif text-[26px] font-semibold text-notion-text text-center"
                style={{ letterSpacing: "-0.015em" }}
              >
                {hourGreeting()}，{userName}
              </h2>
              <p className="mt-3 text-[14px] text-notion-text3 text-center max-w-[260px]">
                什么都可以问 — 写作、分析、脑暴。
              </p>
            </div>
          ) : (
            <div className="text-center text-[14.5px] text-notion-text3 py-10">
              还没聊过。问点什么吧 ↓
            </div>
          )
        ) : (
          <>
            {sliceStart > 0 && (
              <button
                onClick={loadEarlier}
                className="w-full mb-4 py-1.5 rounded text-[12.5px] text-notion-text2 bg-conv-soft border border-conv-soft hover:border-notion-text3 active:opacity-80"
              >
                加载更早 · 还有 {sliceStart} 条
              </button>
            )}
            {windowed.map((m, j) => (
              <CommentItem key={sliceStart + j} msg={m} />
            ))}
          </>
        )}
        {err && <div className="text-[13px] text-red-700 mt-2 px-3 py-2 bg-red-50 rounded">{err}</div>}
      </div>

      {mobile ? (
        <MobileComposer input={input} setInput={setInput} sending={sending} onSend={send} />
      ) : (
        <div className="border-t border-notion-border p-3">
          <div className="flex items-end gap-2 bg-notion-soft border border-notion-border rounded-md p-2.5 focus-within:border-notion-blue focus-within:bg-white">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder="在这条页面下评论…  ⌘ ↵ 发送"
              disabled={sending}
              className="flex-1 min-h-[32px] max-h-[140px] resize-none px-1 py-1 text-[14.5px] leading-relaxed bg-transparent border-0 text-notion-text placeholder:text-notion-text3 disabled:opacity-60"
              style={{ boxShadow: "none" }}
            />
            <button onClick={send} disabled={sending || !input.trim()}
                    className="h-8 px-3 rounded text-[13px] font-medium text-white inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50 bg-notion-blue">
              <IcoSend size={13} /> 发送
            </button>
          </div>
          <div className="mt-2 text-[12px] text-notion-text3 flex items-center gap-2">
            <kbd className="notion-kbd">⌘</kbd>
            <kbd className="notion-kbd">↵</kbd>
            <span>发送</span>
          </div>
        </div>
      )}
    </aside>
  );
}

// =====================================================================
// Mobile-only composer with mic / recording / transcribe / polish flow
// =====================================================================
type Phase = "idle" | "recording" | "transcribing" | "polishing";

function MobileComposer({
  input,
  setInput,
  sending,
  onSend,
}: {
  input: string;
  setInput: (s: string) => void;
  sending: boolean;
  onSend: () => Promise<void> | void;
}) {
  const recorder = useRecorder();
  const [autoPolish] = useAutoPolish();
  const [phase, setPhase] = useState<Phase>("idle");
  const [originalDraft, setOriginalDraft] = useState<string | null>(null);
  const transcribingRef = useRef(false);

  // Surface recorder permission errors
  useEffect(() => {
    if (recorder.error) {
      toast(recorder.error, "error");
      setPhase("idle");
    }
  }, [recorder.error]);

  // When recorder produces a blob, send to /api/transcribe
  useEffect(() => {
    if (recorder.state !== "stopped" || !recorder.blob) return;
    if (transcribingRef.current) return;
    transcribingRef.current = true;
    const blob = recorder.blob;
    const ext = recorder.ext;
    const durMs = recorder.elapsedMs;
    // Short-recording guard: a tap/quick press shouldn't trigger a full upload.
    // Most clips < 400ms are accidental; <1KB blobs are essentially silent.
    if (durMs < 400 || blob.size < 1000) {
      toast("录音太短了，按住说久一点再松开", "error");
      setPhase("idle");
      recorder.reset();
      transcribingRef.current = false;
      return;
    }
    setPhase("transcribing");
    (async () => {
      try {
        const r = await api.transcribeAudio(blob, ext);
        const text = (r.text || "").trim();
        if (!text) {
          toast("没识别到内容，再试一次", "error");
          setPhase("idle");
          return;
        }
        if (autoPolish) {
          setOriginalDraft(text);
          setInput(text);
          setPhase("polishing");
          try {
            const p = await api.polishText(text);
            setInput(p.polished || text);
          } catch (e) {
            console.error("[polish]", e);
            toast("整理失败，可直接发送原文", "error");
          }
          setPhase("idle");
        } else {
          setInput(text);
          setOriginalDraft(null);
          setPhase("idle");
        }
      } catch (e) {
        console.error("[transcribe]", e);
        toast("转写失败，请稍后再试", "error");
        setPhase("idle");
      } finally {
        recorder.reset();
        transcribingRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.state, recorder.blob]);

  async function handleStartRecording() {
    if (phase !== "idle" || sending) return;
    await recorder.start();
    if (recorder.error == null) setPhase("recording");
  }

  function handleStopRecording() {
    if (phase !== "recording") return;
    recorder.stop();
    // phase will flip to "transcribing" via the blob effect above
  }

  async function handlePolishClick() {
    if (phase !== "idle" || !input.trim()) return;
    setPhase("polishing");
    setOriginalDraft(input);
    try {
      const p = await api.polishText(input);
      setInput(p.polished || input);
    } catch (e) {
      console.error("[polish]", e);
      toast("整理失败", "error");
    } finally {
      setPhase("idle");
    }
  }

  function handleUndoPolish() {
    if (originalDraft == null) return;
    setInput(originalDraft);
    setOriginalDraft(null);
  }

  async function handleSend() {
    if (sending || !input.trim()) return;
    await onSend();
    setOriginalDraft(null);
  }

  function onTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    // If user materially diverges from polished text, clear undo target
    if (originalDraft != null && e.target.value === originalDraft) {
      setOriginalDraft(null);
    }
  }

  const showText = phase === "idle" || phase === "polishing";
  const showSend = input.trim().length > 0 && phase === "idle";
  const draftHasContent = input.trim().length > 0;

  return (
    <div className="shrink-0 composer-safe-bottom border-t border-notion-border bg-notion-bg">
      {/* Polish bar */}
      {phase !== "recording" && phase !== "transcribing" && (
        <PolishBar
          phase={phase}
          hasOriginal={originalDraft != null}
          hasDraft={draftHasContent}
          onPolish={handlePolishClick}
          onUndo={handleUndoPolish}
        />
      )}
      <div className="px-3 pt-2 pb-3">
        {phase === "recording" ? (
          <div className="flex items-center gap-3 bg-rec-warm border border-rec-warmBorder rounded-[22px] pl-4 pr-1.5 h-12">
            <span className="rec-dot w-2.5 h-2.5 rounded-full bg-rec-red shrink-0" />
            <span className="text-[14px] font-semibold text-user-deep font-mono tabular-nums shrink-0">
              {fmtElapsed(recorder.elapsedMs)}
            </span>
            <Waveform bands={recorder.bands} />
            <button
              onClick={handleStopRecording}
              aria-label="停止录音"
              className="w-9 h-9 rounded-full bg-rec-red text-white grid place-items-center shrink-0"
            >
              <IcoStopSquare size={14} />
            </button>
          </div>
        ) : phase === "transcribing" ? (
          <div className="flex items-center gap-3 bg-[#f5f4f0] border border-notion-border rounded-[22px] pl-4 pr-1.5 h-12">
            <span className="rec-spinner shrink-0" />
            <span className="flex-1 text-[14.5px] text-notion-text2">转写中…</span>
            <button disabled className="w-8 h-8 rounded-full bg-notion-border2 text-white/70 grid place-items-center shrink-0">
              <IcoSend size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2 bg-[#f5f4f0] border border-notion-border rounded-[22px] pl-4 pr-1.5 py-1.5 focus-within:bg-white focus-within:border-notion-text/20">
            <textarea
              value={input}
              onChange={onTextareaChange}
              rows={1}
              placeholder={showText ? "问点什么…" : ""}
              disabled={sending || phase === "polishing"}
              className="flex-1 min-h-[34px] max-h-[140px] resize-none py-2 text-[15px] leading-relaxed bg-transparent border-0 text-notion-text placeholder:text-notion-text3 disabled:opacity-60"
              style={{ boxShadow: "none" }}
            />
            {showSend ? (
              <button
                onClick={handleSend}
                disabled={sending}
                aria-label="发送"
                className="w-8 h-8 rounded-full bg-[#18181b] text-white grid place-items-center shrink-0 disabled:opacity-50"
              >
                <IcoSend size={14} />
              </button>
            ) : (
              <button
                onClick={handleStartRecording}
                disabled={phase !== "idle" || sending}
                aria-label="开始录音"
                className="w-8 h-8 rounded-full bg-[#ececea] text-notion-text grid place-items-center shrink-0 active:bg-[#e0dfdb] disabled:opacity-50"
              >
                <IcoMic size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Waveform({ bands }: { bands: number[] }) {
  // 12 bars, 2.5px wide, recording orange (#ea580c).
  return (
    <div className="flex-1 flex items-center justify-center gap-[2px] h-7 mx-1">
      {bands.map((v, i) => {
        const h = Math.max(0.12, Math.min(1, v * 1.6));  // pad floor + amplify
        return (
          <span
            key={i}
            className="block w-[2.5px] rounded-full bg-rec-orange"
            style={{ height: `${Math.round(h * 24)}px`, transition: "height 60ms linear" }}
          />
        );
      })}
    </div>
  );
}

function PolishBar({
  phase,
  hasOriginal,
  hasDraft,
  onPolish,
  onUndo,
}: {
  phase: Phase;
  hasOriginal: boolean;
  hasDraft: boolean;
  onPolish: () => void;
  onUndo: () => void;
}) {
  // Polish pills (mockup screens 9-11). idle = white outline, loading = blue
  // soft + spinner, done = green soft + checkmark.
  const base = "inline-flex items-center gap-1.5 px-[11px] py-[5px] rounded-full text-[12.5px] font-medium";
  if (phase === "polishing") {
    return (
      <div className="px-3 pt-2 pb-1.5 flex items-center gap-2">
        <span className={`${base} bg-notion-blueSoft text-[#1d4ed8] border border-transparent`}>
          <span
            className="rec-spinner"
            style={{ width: 11, height: 11, borderWidth: 1.5, borderColor: "rgba(29,78,216,0.3)", borderTopColor: "#1d4ed8" }}
          />
          整理中…
        </span>
      </div>
    );
  }
  if (hasOriginal) {
    return (
      <div className="px-3 pt-2 pb-1.5 flex items-center gap-2">
        <button
          onClick={onUndo}
          className={`${base} bg-polish-greenBg border border-polish-greenBorder text-polish-greenText`}
        >
          ✓ 已整理 · 撤销
        </button>
        <span className="text-[11.5px] text-notion-text3">原稿被 Claude 顺过</span>
      </div>
    );
  }
  if (hasDraft) {
    return (
      <div className="px-3 pt-2 pb-1.5 flex items-center gap-2">
        <button
          onClick={onPolish}
          className={`${base} bg-white border border-notion-border2 text-notion-text`}
        >
          <span className="text-notion-blue text-[11px]">✨</span> 整理一下
        </button>
        <span className="text-[11.5px] text-notion-text3">用 Claude 顺成书面语</span>
      </div>
    );
  }
  return null;
}
