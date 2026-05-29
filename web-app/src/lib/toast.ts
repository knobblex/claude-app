// Lightweight toast — dispatch a CustomEvent that <Toast /> at the app root
// listens for. Pattern matches the existing `auth-expired` event in lib/api.ts.

export type ToastKind = "info" | "error";

export type ToastDetail = {
  text: string;
  kind: ToastKind;
  ttlMs: number;
};

export function toast(text: string, kind: ToastKind = "info", ttlMs = 2400): void {
  window.dispatchEvent(
    new CustomEvent<ToastDetail>("app-toast", {
      detail: { text, kind, ttlMs },
    }),
  );
}
