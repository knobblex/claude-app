// Local credential storage so the user only signs in once per device.
// We store the full `Authorization: Basic <base64(user:pass)>` header value;
// subsequent API requests inject it on every fetch.
//
// This survives PWA close/reopen. Reinstalling the PWA on iOS clears
// localStorage — in that case the in-app login modal asks again, and Safari
// Keychain (if the password was saved there) can autofill in one tap.

import { BASE } from "./api";

const KEY = "auth.basic.v1";

export function getAuthHeader(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Decode the username from the stored `Basic base64(user:pass)` header. */
export function getAuthUser(): string | null {
  const header = getAuthHeader();
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0))
    );
    const user = decoded.split(":")[0];
    return user || null;
  } catch {
    return null;
  }
}

export function setAuthHeader(value: string | null): void {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore (private mode) */
  }
}

export function basicAuthHeader(user: string, pass: string): string {
  // btoa needs Latin-1; user/pass should be ASCII in practice. For safety
  // encode UTF-8 first.
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return "Basic " + btoa(bin);
}

/**
 * Probe whether the current stored credentials (or none) are accepted.
 * Returns:
 *   - "ok"   : auth not required, or stored token is valid
 *   - "401"  : auth required and stored token missing/invalid
 *   - "down" : server unreachable
 */
export async function probeAuth(): Promise<"ok" | "401" | "down"> {
  const header = getAuthHeader();
  try {
    const res = await fetch(BASE + "/api/sub-apps", {
      headers: header ? { Authorization: header } : {},
    });
    if (res.status === 401) return "401";
    if (res.ok) return "ok";
    // 500 / 502 / 503 / 504 etc. — origin unreachable through tunnel or server
    // crashed. Bucket with "down" so AuthGate shows the login modal instead of
    // rendering the app and having every fetch silently fail.
    return "down";
  } catch {
    return "down";
  }
}

/**
 * Try the given credentials. On success, save to localStorage and return true.
 */
export async function tryLogin(user: string, pass: string): Promise<boolean> {
  const header = basicAuthHeader(user, pass);
  try {
    const res = await fetch(BASE + "/api/sub-apps", { headers: { Authorization: header } });
    if (res.ok) {
      setAuthHeader(header);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function clearAuth(): void {
  setAuthHeader(null);
}
