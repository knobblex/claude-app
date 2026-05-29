// Lightweight localStorage cache for conversation detail (messages + title).
// Used for stale-while-revalidate rendering: synchronously hydrate from cache
// on mount, then overwrite with the fresh server fetch when it arrives.
//
// Bounded to MAX_ITEMS most recently used. On QuotaExceededError we drop the
// LRU tail until the put succeeds.

import type { ConversationDetail } from "./api";

const NS = "conv-cache:v1:";
const INDEX_KEY = "conv-cache:v1:index";
const MAX_ITEMS = 30;

function readIndex(): string[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

function writeIndex(idx: string[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
  } catch { /* quota — caller handles */ }
}

export function cacheGetConversation(id: string): ConversationDetail | null {
  try {
    const s = localStorage.getItem(NS + id);
    return s ? (JSON.parse(s) as ConversationDetail) : null;
  } catch {
    return null;
  }
}

// Defer to an idle frame (falls back to a macrotask). JSON.stringify of a
// large conversation + the synchronous localStorage write both block the main
// thread; keeping them off the render-commit path is the point.
const scheduleIdle: (cb: () => void) => void =
  typeof window !== "undefined" && typeof window.requestIdleCallback === "function"
    ? (cb) => window.requestIdleCallback(cb)
    : (cb) => setTimeout(cb, 0);

export function cachePutConversation(id: string, d: ConversationDetail): void {
  // Fire-and-forget: callers never read the cache back synchronously, so the
  // whole write (stringify included) runs on an idle frame, not inline.
  scheduleIdle(() => {
    const payload = JSON.stringify(d);

    // Update LRU index (newest first).
    const idx = readIndex().filter((x) => x !== id);
    idx.unshift(id);
    while (idx.length > MAX_ITEMS) {
      const old = idx.pop();
      if (old) {
        try { localStorage.removeItem(NS + old); } catch { /* ignore */ }
      }
    }

    // Attempt write; on quota error, drop oldest until it fits.
    for (;;) {
      try {
        localStorage.setItem(NS + id, payload);
        writeIndex(idx);
        return;
      } catch {
        // QuotaExceededError or similar; drop oldest and retry once.
        const old = idx.pop();
        if (!old || old === id) {
          // Nothing more to drop — give up silently.
          writeIndex(idx);
          return;
        }
        try { localStorage.removeItem(NS + old); } catch { /* ignore */ }
      }
    }
  });
}

export function cacheDeleteConversation(id: string): void {
  try { localStorage.removeItem(NS + id); } catch { /* ignore */ }
  writeIndex(readIndex().filter((x) => x !== id));
}
