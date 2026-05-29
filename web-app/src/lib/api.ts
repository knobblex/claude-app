// Generic shell types only. Sub-app-specific shapes (AppListItem, AppDetail, Idea,
// Frontmatter, ChatSummary) live in each sub-app's own ui/api.ts.

export type MessageKind =
  | "user_text"
  | "assistant_text"
  | "tool_use"
  | "tool_result"
  | "interrupted";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts?: number;
  pending?: boolean;
  // Optional fields for richer Claude-session rendering (UUID-id convs only).
  // Legacy per-app chats just have role+content+ts.
  kind?: MessageKind;
  tool?: string;
  input?: unknown;
  tool_use_id?: string;
  result?: string;
  is_error?: boolean;
  // For kind === "interrupted": short reason string (e.g. "claude 卡住 120s 无新输出").
  reason?: string;
}

// Optional binding to a sub-app data source. The shell uses this to inject a
// system-prompt prefix on turn 1 (e.g. embedding a radar dossier). Extend the
// union as new sub-apps register resolvers.
export type ConversationContext =
  | { kind: "radar_app"; slug: string }
  | { kind: string; [key: string]: unknown }; // forward-compatible escape hatch

export interface ConversationSummary {
  id: string;
  title: string;
  last_role: "user" | "assistant";
  last_preview: string;
  last_ts: number;
  count: number;
  context?: ConversationContext | null;
  // True if a turn is currently running for this conversation in the shell's
  // live hub (POST /stream still receiving from claude). Used to render an
  // "in flight" indicator on list rows / in the chat header.
  live?: boolean;
  // Wall-clock ts of the most recent interrupt record, or 0 if none. Lets
  // the UI surface "上次中断" on the row without loading the detail.
  last_interrupt_ts?: number;
}

export interface ConversationDetail {
  id: string;
  title: string;
  messages: ChatMessage[];
  context?: ConversationContext | null;
  live?: boolean;
  last_interrupt_ts?: number;
  // True if the user has pinned this conv to the main list. Sub-app convs
  // are unpinned by default — toggled via setConversationPinned.
  pinned?: boolean;
}

// A chat is always a bare conversation now. Sub-apps participate by creating
// a conversation with a `context` binding; they don't own the chat UI.
export type ChatTarget = { kind: "conv"; id: string };

export function authHeaders(): Record<string, string> {
  try {
    const t = localStorage.getItem("auth.basic.v1");
    return t ? { Authorization: t } : {};
  } catch {
    return {};
  }
}

// Derived from the HTML's location so the same build works at any path prefix.
// e.g. served at "/frp/xf/" → BASE = "/frp/xf"; at root → BASE = "".
export const BASE = new URL(".", document.baseURI).pathname.replace(/\/$/, "");

// Server-clock offset, in ms. Updated from every authenticated response's
// `Date` HTTP header so the "X 分钟前" labels stay correct even if the
// device's clock is wrong (wrong timezone, manual time, drift). Resolution
// is 1s (Date header precision); RTT/2 error is negligible for relative time.
let serverOffsetMs = 0;
function syncServerClock(res: Response): void {
  const d = res.headers.get("Date");
  if (!d) return;
  const serverMs = Date.parse(d);
  if (isNaN(serverMs)) return;
  serverOffsetMs = serverMs - Date.now();
}
export function serverNowMs(): number {
  return Date.now() + serverOffsetMs;
}

/**
 * Shared JSON fetcher with Basic-auth + 401 reset. Sub-apps import this
 * (re-exported as `apiFetch` below) to hit their own routes.
 */
async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  });
  syncServerClock(res);
  if (res.status === 401) {
    // bubble a distinguishable error so AuthGate can react
    try { localStorage.removeItem("auth.basic.v1"); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent("auth-expired"));
    throw new Error("UNAUTHORIZED");
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// Re-export the http helper for sub-apps that need to hit their own routes.
export const apiFetch = http;

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; tool: string; input?: unknown; tool_use_id?: string }
  | { type: "tool_result"; tool_use_id?: string; result: string; is_error?: boolean }
  | { type: "user_message"; text: string; ts?: number }
  | { type: "error"; error: string }
  | { type: "interrupted"; reason: string; partial?: string; ts?: number }
  | { type: "done" };

/**
 * Subscribe (GET) to an in-flight turn for this cid. If no turn is currently
 * running on the server, the response immediately yields `{type:"done"}` and
 * closes — caller can then fall back to the persisted message list.
 *
 * The server replays all past events of the live turn (so a late joiner sees
 * the user message and all tokens emitted before they connected) and then
 * streams future events in real time. Used for:
 *   - rejoining a conversation after navigating away mid-generation
 *   - sharing a conversation across devices in real time
 */
export async function attachLive(
  id: string,
  signal: AbortSignal,
  onEvent: (e: StreamEvent) => void,
): Promise<void> {
  await consumeSSE(
    BASE + `/api/conversations/${encodeURIComponent(id)}/live`,
    { method: "GET", headers: authHeaders(), signal },
    onEvent,
  );
}

async function consumeSSE(
  url: string,
  init: RequestInit,
  onEvent: (e: StreamEvent) => void,
): Promise<void> {
  const res = await fetch(url, init);
  syncServerClock(res);
  if (res.status === 401) {
    try { localStorage.removeItem("auth.basic.v1"); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent("auth-expired"));
    throw new Error("UNAUTHORIZED");
  }
  if (!res.ok || !res.body) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const obj = JSON.parse(line.slice(6)) as StreamEvent;
          onEvent(obj);
          if (obj.type === "done") return;
        } catch { /* skip malformed line */ }
      }
    }
  }
}

/**
 * POST a message and stream the assistant's reply as SSE events. Keeps bytes
 * flowing so reverse proxies (nginx with `proxy_read_timeout 60s`) don't 504.
 */
export async function streamConversation(
  id: string,
  message: string,
  onEvent: (e: StreamEvent) => void,
): Promise<void> {
  await consumeSSE(
    BASE + `/api/conversations/${encodeURIComponent(id)}/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ message }),
    },
    onEvent,
  );
}

export interface SubAppManifestSummary {
  id: string;
  name: string;
  icon: string;
  backend: { prefix: string };
  frontend: {
    mobile: { openFrom: "projects"; label: string };
    desktop: { section: "projects"; label: string };
  };
}

export const api = {
  listSubApps: () => http<SubAppManifestSummary[]>("/api/sub-apps"),
  listConversations: () => http<ConversationSummary[]>("/api/conversations"),
  createConversation: (context?: ConversationContext) =>
    http<{ id: string; title: string; context?: ConversationContext | null }>(
      "/api/conversations",
      {
        method: "POST",
        body: JSON.stringify(context ? { context } : {}),
      },
    ),
  getConversation: (id: string) =>
    http<ConversationDetail>(`/api/conversations/${encodeURIComponent(id)}`),
  sendConversationMessage: (id: string, message: string) =>
    http<{ response: string }>(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  deleteConversation: (id: string) =>
    http<{ ok: true }>(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  setConversationPinned: (id: string, pinned: boolean) =>
    http<{ id: string; pinned: boolean }>(`/api/conversations/${encodeURIComponent(id)}/pin`, {
      method: "POST",
      body: JSON.stringify({ pinned }),
    }),
  streamConversation,
  attachLive,
  transcribeAudio: async (blob: Blob, ext: string): Promise<{ text: string }> => {
    const fd = new FormData();
    fd.append("audio", blob, `recording.${ext}`);
    fd.append("ext", ext);
    const res = await fetch(BASE + "/api/transcribe", { method: "POST", body: fd, headers: authHeaders() });
    syncServerClock(res);
    if (res.status === 401) {
      try { localStorage.removeItem("auth.basic.v1"); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent("auth-expired"));
      throw new Error("UNAUTHORIZED");
    }
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    const j = await res.json();
    return { text: j.text || "" };
  },
  polishText: (text: string) =>
    http<{ polished: string }>("/api/polish", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
};
