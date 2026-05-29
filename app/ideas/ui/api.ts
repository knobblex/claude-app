// 点子库 sub-app API. URL prefix lives in manifest.json — single source of truth.

import { apiFetch, authHeaders, BASE } from "@/lib/api";
import manifest from "../manifest.json";

const P = manifest.backend.prefix; // "/api/ideas"

// 把 "foo/bar baz.md" 编成每段都 encodeURIComponent 但保留 / 的路径
function encodePath(rel: string): string {
  return rel.split("/").map(encodeURIComponent).join("/");
}

export interface IdeaSummary {
  id: string;
  title: string;
  doc_chars: number;
  conv_count: number;
  created_ts: number;
  updated_ts: number;
}

export interface ConvSummary {
  id: string;
  title: string;
  last_role: "user" | "assistant" | null;
  last_preview: string;
  last_ts: number;
  created_ts: number;
  count: number;
  distilled_count: number;
}

export interface IdeaDetail {
  id: string;
  title: string;
  doc: string;
  doc_chars: number;
  created_ts: number;
  updated_ts: number;
  conversations: ConvSummary[];
}

export interface HistoryEntry {
  ts: number;
  chars: number;
}

export interface DistillResult {
  doc: string;
  doc_chars: number;
  history_ts: number;
  diff: { added: number; removed: number };
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
  mtime: number;
}

export interface DirListing {
  path: string;
  type: "dir";
  entries: FileEntry[];
}

export const ideasApi = {
  listIdeas: () => apiFetch<IdeaSummary[]>(`${P}/ideas`),
  createIdea: (title: string) =>
    apiFetch<{ id: string; title: string }>(`${P}/ideas`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  getIdea: (iid: string) => apiFetch<IdeaDetail>(`${P}/ideas/${encodeURIComponent(iid)}`),
  updateIdea: (iid: string, body: { title?: string; doc?: string }) =>
    apiFetch<{ ok: true; updated_ts: number }>(`${P}/ideas/${encodeURIComponent(iid)}/update`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteIdea: (iid: string) =>
    apiFetch<{ ok: true }>(`${P}/ideas/${encodeURIComponent(iid)}`, { method: "DELETE" }),
  listHistory: (iid: string) =>
    apiFetch<HistoryEntry[]>(`${P}/ideas/${encodeURIComponent(iid)}/history`),
  getHistory: (iid: string, ts: number) =>
    apiFetch<{ ts: number; doc: string }>(`${P}/ideas/${encodeURIComponent(iid)}/history/${ts}`),
  restoreHistory: (iid: string, ts: number) =>
    apiFetch<{ ok: true; doc: string; updated_ts: number }>(
      `${P}/ideas/${encodeURIComponent(iid)}/history/${ts}/restore`,
      { method: "POST" },
    ),

  // 聊天本身走壳子的 /api/conversations/<cid>/stream（ChatDrawer 直接对接）。
  // 这里只剩 sub-app 自己的：列表 / 新建 / 删除 / distill。
  listConversations: (iid: string) =>
    apiFetch<ConvSummary[]>(`${P}/ideas/${encodeURIComponent(iid)}/conversations`),
  createConversation: (iid: string) =>
    apiFetch<{ id: string; title: string }>(`${P}/ideas/${encodeURIComponent(iid)}/conversations`, {
      method: "POST",
      body: "{}",
    }),
  deleteConversation: (iid: string, cid: string) =>
    apiFetch<{ ok: true }>(
      `${P}/ideas/${encodeURIComponent(iid)}/conversations/${encodeURIComponent(cid)}`,
      { method: "DELETE" },
    ),
  distill: (iid: string, cid: string) =>
    apiFetch<DistillResult>(
      `${P}/ideas/${encodeURIComponent(iid)}/conversations/${encodeURIComponent(cid)}/distill`,
      { method: "POST" },
    ),

  // 素材夹：apiFetch 是 JSON 专用的，文件读写绕开它直接 fetch。
  listFiles: (iid: string, rel: string = "") =>
    apiFetch<DirListing>(
      rel
        ? `${P}/ideas/${encodeURIComponent(iid)}/files/${encodePath(rel)}`
        : `${P}/ideas/${encodeURIComponent(iid)}/files`,
    ),

  fileUrl: (iid: string, rel: string): string =>
    `${BASE}${P}/ideas/${encodeURIComponent(iid)}/files/${encodePath(rel)}`,

  readFileText: async (iid: string, rel: string): Promise<string> => {
    const res = await fetch(ideasApi.fileUrl(iid, rel), { headers: authHeaders() });
    if (res.status === 401) {
      try { localStorage.removeItem("auth.basic.v1"); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent("auth-expired"));
      throw new Error("UNAUTHORIZED");
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  },

  readFileBlob: async (iid: string, rel: string): Promise<Blob> => {
    const res = await fetch(ideasApi.fileUrl(iid, rel), { headers: authHeaders() });
    if (res.status === 401) {
      try { localStorage.removeItem("auth.basic.v1"); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent("auth-expired"));
      throw new Error("UNAUTHORIZED");
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.blob();
  },

  writeFile: async (iid: string, rel: string, body: Blob | string): Promise<FileEntry> => {
    const url = ideasApi.fileUrl(iid, rel);
    const res = await fetch(url, { method: "POST", body, headers: authHeaders() });
    if (res.status === 401) {
      try { localStorage.removeItem("auth.basic.v1"); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent("auth-expired"));
      throw new Error("UNAUTHORIZED");
    }
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.json() as Promise<FileEntry>;
  },

  deleteFile: (iid: string, rel: string) =>
    apiFetch<{ ok: true }>(
      `${P}/ideas/${encodeURIComponent(iid)}/files/${encodePath(rel)}`,
      { method: "DELETE" },
    ),
};
