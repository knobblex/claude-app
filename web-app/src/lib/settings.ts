import { useEffect, useState } from "react";

const KEY_AUTO_POLISH = "settings:autoPolish";

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "1" || v === "true";
  } catch {
    return fallback;
  }
}

function writeBool(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* ignore */ }
}

export function getAutoPolish(): boolean {
  return readBool(KEY_AUTO_POLISH, false);
}

export function setAutoPolish(v: boolean) {
  writeBool(KEY_AUTO_POLISH, v);
  // notify listeners in same window (storage event only fires cross-window)
  window.dispatchEvent(new CustomEvent("settings:change", { detail: { key: KEY_AUTO_POLISH } }));
}

export function useAutoPolish(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => getAutoPolish());
  useEffect(() => {
    const onChange = () => setV(getAutoPolish());
    window.addEventListener("settings:change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("settings:change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return [v, (next: boolean) => { setAutoPolish(next); setV(next); }];
}
