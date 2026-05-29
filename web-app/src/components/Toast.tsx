import { useEffect, useState } from "react";
import type { ToastDetail } from "@/lib/toast";

type Item = ToastDetail & { id: number };

/**
 * Single-slot toast (no stacking) anchored to the bottom of the screen above
 * the composer; on iOS keyboard-open it falls back to top-anchor (see
 * .toast-wrap CSS in index.css).
 *
 * a11y: error → role="alert" + aria-live="assertive" (interrupts SR speech);
 * info → role="status" + aria-live="polite" (queued).
 */
export function Toast() {
  const [item, setItem] = useState<Item | null>(null);

  useEffect(() => {
    let timer: number | null = null;
    function onToast(e: Event) {
      const ce = e as CustomEvent<ToastDetail>;
      if (timer) window.clearTimeout(timer);
      setItem({ id: Date.now(), ...ce.detail });
      timer = window.setTimeout(() => setItem(null), ce.detail.ttlMs);
    }
    window.addEventListener("app-toast", onToast);
    return () => {
      window.removeEventListener("app-toast", onToast);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  if (!item) return null;

  const isError = item.kind === "error";

  return (
    <div
      className="toast-wrap"
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      <div key={item.id} className={isError ? "toast-pill error" : "toast-pill"}>
        {item.text}
      </div>
    </div>
  );
}
