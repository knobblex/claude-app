// Shell config fetched once from the backend (GET /api/config). Currently just
// the display name shown in greetings / profile / message author labels.
// Cached at module level so the fetch happens once per page load regardless of
// how many components call the hook.
import { useEffect, useState } from "react";
import { apiFetch } from "./api";

const FALLBACK = "用户";

let cached: string | null = null;
let inflight: Promise<string> | null = null;

function fetchUserName(): Promise<string> {
  if (cached !== null) return Promise.resolve(cached);
  if (!inflight) {
    inflight = apiFetch<{ user_name?: string }>("/api/config")
      .then((c) => (cached = c.user_name || FALLBACK))
      .catch(() => (cached = FALLBACK));
  }
  return inflight;
}

/** The configured display name. Returns FALLBACK until the fetch resolves. */
export function useUserName(): string {
  const [name, setName] = useState<string>(cached ?? FALLBACK);
  useEffect(() => {
    fetchUserName().then(setName);
  }, []);
  return name;
}
