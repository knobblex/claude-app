// Radar sub-app API. URL prefix comes from manifest.json so the prefix lives
// in exactly one place (manifest also drives backend dispatch).

import { apiFetch, type ChatMessage } from "@/lib/api";
import manifest from "../manifest.json";

const P = manifest.backend.prefix; // e.g. "/api/radar"

export interface Frontmatter {
  name?: string;
  source?: string;
  url?: string;
  first_seen?: string;
  score_novelty?: string | number;
  score_portability?: string | number;
  score_revenue?: string | number;
  score_avg?: string | number;
  tags?: string[];
}

export interface AppListItem {
  slug: string;
  kind: "app" | "game";
  frontmatter: Frontmatter;
  is_favorite: boolean;
  tags_user: string[];
  note_user: string;
  favorited_at: string | null;
}

export interface AppDetail {
  slug: string;
  kind: "app" | "game";
  frontmatter: Frontmatter;
  body: string;
  is_favorite: boolean;
  fav_meta: { note?: string; tags?: string[]; favorited_at?: string };
}

export interface ChatSummary {
  slug: string;
  name: string;
  source: string;
  tags: string[];
  last_role: "user" | "assistant";
  last_preview: string;
  last_ts: number;
  count: number;
}

export interface Idea {
  slug: string;
  kind: "app" | "game";
  name: string;
  source: string;
  tags: string[];
  first_seen: string;
  score_avg: string | number;
  index: number;
  title: string;
  body: string;
}

export const radarApi = {
  listApps: () => apiFetch<AppListItem[]>(`${P}/apps`),
  listIdeas: () => apiFetch<Idea[]>(`${P}/ideas`),
  getApp: (slug: string) => apiFetch<AppDetail>(`${P}/apps/${encodeURIComponent(slug)}`),
  setFavorite: (slug: string, payload: { favorited?: boolean; note?: string; tags?: string[] }) =>
    apiFetch<{ ok: true }>(`${P}/favorites/${encodeURIComponent(slug)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listChats: () => apiFetch<ChatSummary[]>(`${P}/chats`),
  getChat: (slug: string) => apiFetch<ChatMessage[]>(`${P}/chat/${encodeURIComponent(slug)}`),
  sendChat: (slug: string, message: string) =>
    apiFetch<{ response: string }>(`${P}/chat/${encodeURIComponent(slug)}`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  // Idempotent: returns the bare-conversation UUID bound to this slug,
  // creating one on first call so chats flow through the shell streamer.
  getOrCreateConversation: (slug: string) =>
    apiFetch<{ id: string; created: boolean }>(`${P}/conversation/${encodeURIComponent(slug)}`, {
      method: "POST",
      body: "{}",
    }),
  getNotes: (slug: string) => apiFetch<{ markdown: string }>(`${P}/notes/${encodeURIComponent(slug)}`),
  distillNotes: (slug: string) =>
    apiFetch<{ summary: string; markdown: string }>(`${P}/notes/${encodeURIComponent(slug)}`, {
      method: "POST",
      body: "{}",
    }),
  suggestNotes: (slug: string) =>
    apiFetch<{ suggestions: string[]; raw: string }>(`${P}/note-suggestions/${encodeURIComponent(slug)}`, {
      method: "POST",
      body: "{}",
    }),
};
