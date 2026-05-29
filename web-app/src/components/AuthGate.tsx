import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { probeAuth, tryLogin, clearAuth } from "@/lib/auth";

type State = "loading" | "ok" | "prompt";

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("loading");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Initial probe + listen for 401 from anywhere in the app.
  useEffect(() => {
    let cancelled = false;
    probeAuth().then((r) => {
      if (cancelled) return;
      if (r === "ok") setState("ok");
      else setState("prompt"); // both "401" and "down" → show modal; user can retry
    });
    const onExpired = () => {
      clearAuth();
      setState("prompt");
    };
    window.addEventListener("auth-expired", onExpired);
    return () => {
      cancelled = true;
      window.removeEventListener("auth-expired", onExpired);
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user || !pass || submitting) return;
    setSubmitting(true); setErr(null);
    const ok = await tryLogin(user, pass);
    setSubmitting(false);
    if (ok) {
      setPass(""); // don't keep raw password in component state
      setState("ok");
    } else {
      setErr("用户名或密码不对");
    }
  }

  if (state === "ok") return <>{children}</>;

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center text-notion-text3" style={{ minHeight: "100dvh" }}>
        加载中…
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center px-6"
      style={{ minHeight: "100dvh", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="w-full max-w-[340px] bg-notion-bg border border-notion-border rounded-2xl p-6 shadow-[0_6px_20px_-6px_rgba(15,15,15,0.12)]">
        <div className="text-center mb-5">
          <div className="text-[36px] leading-none mb-2">📡</div>
          <div className="font-serif text-[22px] font-bold text-notion-text">Hot App Radar</div>
          <div className="text-[13px] text-notion-text3 mt-1">登录一次，之后无需再输</div>
        </div>
        {/* autoComplete="on" + the input attributes below tell Safari it's a
            login form, so Keychain offers to save and autofill credentials.
            method="post" + action="/" is also needed for iOS Keychain to bite. */}
        <form
          onSubmit={submit}
          method="post"
          action="/"
          autoComplete="on"
          className="space-y-3"
        >
          <div>
            <label className="block text-[12px] text-notion-text2 mb-1.5 font-medium">用户名</label>
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full h-11 px-3 text-[15px] bg-notion-soft border border-notion-border rounded-md text-notion-text"
            />
          </div>
          <div>
            <label className="block text-[12px] text-notion-text2 mb-1.5 font-medium">密码</label>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              className="w-full h-11 px-3 text-[15px] bg-notion-soft border border-notion-border rounded-md text-notion-text"
            />
          </div>
          {err && (
            <div className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {err}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting || !user || !pass}
            className="w-full h-11 rounded-md text-white text-[15px] font-semibold disabled:opacity-50 active:opacity-80 bg-notion-blue"
          >
            {submitting ? "登录中…" : "登录"}
          </button>
        </form>
        <p className="mt-4 text-[12px] text-notion-text3 leading-relaxed text-center">
          首次登录后凭证会存到设备本地，Safari 也能提示保存到 iCloud Keychain，下次秒进。
        </p>
      </div>
    </div>
  );
}
