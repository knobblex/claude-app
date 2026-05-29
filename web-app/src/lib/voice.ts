import { useEffect, useRef, useState } from "react";

export type RecState = "idle" | "permission" | "recording" | "stopped";

export interface UseRecorder {
  state: RecState;
  level: number;        // 0..1, smoothed average level
  bands: number[];      // 12 per-bin levels for waveform, each 0..1
  blob: Blob | null;
  mime: string | null;
  ext: string;          // "m4a" | "webm" | ...
  error: string | null;
  elapsedMs: number;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
}

const BAND_COUNT = 12;
const MAX_DURATION_MS = 60_000;  // hard stop at 60s

function pickMime(): { mime: string; ext: string } {
  if (typeof MediaRecorder === "undefined") return { mime: "", ext: "m4a" };
  const candidates: { mime: string; ext: string }[] = [
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c.mime)) return c;
    } catch { /* ignore */ }
  }
  return { mime: "", ext: "m4a" };
}

export function useRecorder(): UseRecorder {
  const [state, setState] = useState<RecState>("idle");
  const [level, setLevel] = useState(0);
  const [bands, setBands] = useState<number[]>(() => new Array(BAND_COUNT).fill(0));
  const [blob, setBlob] = useState<Blob | null>(null);
  const [mime, setMime] = useState<string | null>(null);
  const [ext, setExt] = useState<string>("m4a");
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const t0Ref = useRef(0);
  const stopTimerRef = useRef<number | null>(null);

  function cleanup() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  }

  async function start() {
    if (state === "recording" || state === "permission") return;
    setError(null);
    setBlob(null);
    setBands(new Array(BAND_COUNT).fill(0));
    setLevel(0);
    setElapsedMs(0);
    setState("permission");
    try {
      // Secure context guard: navigator.mediaDevices is only exposed on
      // HTTPS or http://localhost. On http://192.168.x.x it is undefined,
      // and accessing .getUserMedia would throw a confusing TypeError.
      if (typeof window !== "undefined" && window.isSecureContext === false) {
        throw new Error(
          "浏览器只在 HTTPS 或 localhost 下允许录音。请用 cloudflared 隧道地址（https://*.trycloudflare.com）或在 Mac 本机用 localhost 访问。"
        );
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          "当前环境拿不到麦克风（mediaDevices 不可用）。多半是访问地址不是 HTTPS。换成 cloudflared 的 https URL 试试。"
        );
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const picked = pickMime();
      setMime(picked.mime || null);
      setExt(picked.ext);
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream, picked.mime ? { mimeType: picked.mime } : undefined);
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        const finalMime = rec.mimeType || picked.mime || "audio/mp4";
        setBlob(new Blob(chunks, { type: finalMime }));
        setState("stopped");
        cleanup();
      };
      rec.onerror = (ev) => {
        console.error("[recorder] MediaRecorder error", ev);
        setError("录音出错");
        cleanup();
        setState("idle");
      };

      // Analyser for level/bands visualisation
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 64;
      an.smoothingTimeConstant = 0.6;
      src.connect(an);
      audioCtxRef.current = ctx;
      analyserRef.current = an;

      const buf = new Uint8Array(an.frequencyBinCount); // 32 bins
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(buf);
        let sum = 0;
        const next = new Array(BAND_COUNT);
        const step = buf.length / BAND_COUNT;
        for (let i = 0; i < BAND_COUNT; i++) {
          const idx = Math.min(buf.length - 1, Math.floor(i * step + step / 2));
          const v = buf[idx] / 255;
          next[i] = v;
          sum += v;
        }
        setBands(next);
        setLevel(sum / BAND_COUNT);
        setElapsedMs(performance.now() - t0Ref.current);
        rafRef.current = requestAnimationFrame(tick);
      };

      t0Ref.current = performance.now();
      rec.start();
      recorderRef.current = rec;
      setState("recording");
      tick();

      stopTimerRef.current = window.setTimeout(() => {
        try { rec.stop(); } catch { /* ignore */ }
      }, MAX_DURATION_MS);
    } catch (e) {
      // Surface only short user-readable messages; everything else falls back
      // to a generic line and the raw cause goes to the console for debugging.
      const name = (e as Error).name;
      let msg: string;
      if (name === "NotAllowedError") {
        msg = "麦克风权限被拒绝。请到「设置 → Safari → 麦克风」放行后重试。";
      } else if (name === "NotFoundError") {
        msg = "找不到麦克风设备。";
      } else if ((e as Error).message && (e as Error).message.length < 80) {
        // Trust short messages thrown above (HTTPS / mediaDevices guards).
        msg = (e as Error).message;
      } else {
        msg = "麦克风出错";
      }
      console.error("[recorder]", e);
      setError(msg);
      setState("idle");
      cleanup();
    }
  }

  function stop() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); } catch { /* ignore */ }
    }
  }

  function reset() {
    cleanup();
    setState("idle");
    setBlob(null);
    setBands(new Array(BAND_COUNT).fill(0));
    setLevel(0);
    setElapsedMs(0);
    setError(null);
  }

  useEffect(() => () => cleanup(), []);

  return { state, level, bands, blob, mime, ext, error, elapsedMs, start, stop, reset };
}

export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
