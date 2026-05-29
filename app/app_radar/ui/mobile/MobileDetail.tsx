import { useEffect, useState } from "react";
import { radarApi as api, type AppDetail } from "../api";
import { cn, deriveEmoji, extractTagline, num, sourceShort } from "@/lib/utils";
import { renderMarkdown } from "@/lib/markdown";
import {
  IcoArrowL, IcoMessage, IcoMore, IcoSparkles, IcoStar,
} from "@/components/icons";

function pillFor(score: number): { bg: string; dot: string } {
  if (score >= 5) return { bg: "pill-green", dot: "dot-green" };
  if (score >= 4) return { bg: "pill-blue", dot: "dot-blue" };
  if (score >= 3) return { bg: "pill-yellow", dot: "dot-yellow" };
  return { bg: "pill-gray", dot: "dot-gray" };
}

function ScorePillMini({ label, value }: { label: string; value: number }) {
  const c = pillFor(value);
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[12.5px] font-medium", c.bg)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", c.dot)} />
      {label} {value}
    </span>
  );
}

function ToggleBlock({
  icon, title, defaultOpen = false, accent = "gray", children,
}: {
  icon: string;
  title: string;
  defaultOpen?: boolean;
  accent?: "gray" | "amber" | "blue";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => setOpen(defaultOpen), [defaultOpen]);
  const styleMap = {
    gray:  { borderLeftColor: "rgba(55,53,47,0.16)", background: "rgba(247,247,245,0.6)" },
    amber: { borderLeftColor: "#fcd34d", background: "rgba(254,243,199,0.5)" },
    blue:  { borderLeftColor: "#2383e2", background: "rgba(211,229,239,0.25)" },
  } as const;
  return (
    <div className="my-3 rounded-md border-l-[3px]" style={styleMap[accent]}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left active:bg-notion-hover rounded"
      >
        <span
          className="text-[11px] inline-block"
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", color: "rgba(55,53,47,0.45)" }}
        >
          ▸
        </span>
        <span className="text-[16px]">{icon}</span>
        <span className="font-semibold text-[14.5px] text-notion-text">{title}</span>
        {!open && <span className="text-[12px] text-notion-text3 ml-auto">展开</span>}
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}

function NoteEditor({ slug, initialNote, initialTags, onSaved }: {
  slug: string;
  initialNote: string;
  initialTags: string[];
  onSaved: () => Promise<void>;
}) {
  const [note, setNote] = useState(initialNote || "");
  const [tagsStr, setTagsStr] = useState((initialTags || []).join(", "));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setNote(initialNote || "");
    setTagsStr((initialTags || []).join(", "));
  }, [slug, initialNote, initialTags]);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      const tags = tagsStr.split(",").map(s => s.trim()).filter(Boolean);
      await api.setFavorite(slug, { favorited: true, note, tags });
      setSaved(true);
      await onSaved();
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="为什么记下它？打算什么时候回看？"
        className="w-full min-h-[70px] resize-y px-3 py-2 text-[15px] bg-white border border-notion-border rounded-md text-notion-text placeholder:text-notion-text3 leading-[1.55]"
      />
      <input
        value={tagsStr}
        onChange={(e) => setTagsStr(e.target.value)}
        placeholder="个人标签：逗号分隔"
        className="w-full h-10 px-3 text-[14.5px] bg-white border border-notion-border rounded-md text-notion-text placeholder:text-notion-text3"
      />
      <button
        onClick={save}
        disabled={saving}
        className="h-9 px-3 rounded text-[14px] font-medium bg-notion-text text-white active:bg-[#52504a] disabled:opacity-60"
      >
        {saving ? "保存中…" : saved ? "已保存 ✓" : "保存"}
      </button>
    </div>
  );
}

function IdeasBlock({ slug }: { slug: string }) {
  const [md, setMd] = useState("");
  const [loading, setLoading] = useState(true);
  const [distilling, setDistilling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getNotes(slug)
      .then((r) => { if (!cancelled) { setMd(r.markdown); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  async function distill() {
    setDistilling(true);
    try {
      const r = await api.distillNotes(slug);
      setMd(r.markdown);
    } catch {/* ignore */} finally {
      setDistilling(false);
    }
  }

  return (
    <div>
      {loading ? (
        <div className="text-[13.5px] text-notion-text3 py-2">加载中…</div>
      ) : md ? (
        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(md, false) }} />
      ) : (
        <div className="text-[14px] text-notion-text3 leading-relaxed py-1">
          还没提炼过点子。先跟 Claude 聊几句这个 App，再回这里提炼。
        </div>
      )}
      <button
        onClick={distill}
        disabled={distilling}
        className="mt-3 h-9 px-3 rounded text-[14px] font-medium bg-white border border-notion-border2 text-notion-text2 active:text-notion-text inline-flex items-center gap-1.5 disabled:opacity-60"
      >
        <IcoSparkles size={13} /> {distilling ? "提炼中…" : md ? "重新提炼" : "提炼对话点子"}
      </button>
    </div>
  );
}

export function MobileDetail({
  app,
  onBack,
  onToggleFav,
  onRefresh,
  onOpenChat,
}: {
  app: AppDetail;
  onBack: () => void;
  onToggleFav: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onOpenChat: () => void;
}) {
  const fm = app.frontmatter;
  const tagline = extractTagline(app.body);
  const sourceCode = sourceShort[fm.source || ""] || "PH";
  const emoji = deriveEmoji(app.slug, fm.tags || [], fm.name || "");
  const novelty = num(fm.score_novelty);
  const port = num(fm.score_portability);
  const rev = num(fm.score_revenue);
  const fav = app.is_favorite;
  const sourceLabels: Record<string, string> = {
    PH: "Product Hunt", "AS-US": "US", "AS-CN": "CN", "AS-JP": "JP",
  };
  const sourceLabel = sourceLabels[sourceCode] || sourceCode;
  const bodyHtml = renderMarkdown(app.body, true);
  const userTags = app.fav_meta?.tags || [];

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-notion-bg relative">
      {/* sticky top action bar — safe-area on outer wrapper so the 44px tap row stays intact */}
      <div
        className="shrink-0 border-b border-notion-border bg-notion-bg"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="h-11 flex items-center justify-between px-1.5 [&_button]:h-9 [&_button]:w-9 [&_button]:grid [&_button]:place-items-center [&_button]:rounded">
          <div className="flex items-center">
            <button onClick={onBack} aria-label="返回" className="text-notion-text2 active:bg-notion-hover">
              <IcoArrowL size={20} />
            </button>
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={onToggleFav} aria-label="收藏" className="text-notion-text2 active:bg-notion-hover">
              <IcoStar size={20} filled={fav} className={fav ? "text-amber-500" : ""} />
            </button>
            <button className="text-notion-text2 active:bg-notion-hover" aria-label="更多">
              <IcoMore size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto relative">
        {/* cover */}
        <div className={cn("relative h-[84px]", `cover-${sourceCode}`)}>
          <div className="absolute left-5 -bottom-5 w-14 h-14 rounded-xl bg-white border border-notion-border grid place-items-center text-[32px] shadow-[0_2px_6px_rgba(15,15,15,0.06)]">
            {emoji}
          </div>
        </div>

        {/* title */}
        <div className="px-5 pt-8 pb-3">
          <h1 className="font-serif text-[30px] font-bold tracking-tight text-notion-text leading-[1.1]">
            {fm.name || app.slug}
          </h1>
          {tagline && (
            <p className="font-serif italic mt-2 text-[16.5px] text-notion-text2 leading-[1.5]">
              {tagline}
            </p>
          )}
        </div>

        {/* pill strip */}
        <div className="px-5 pb-2 flex gap-1.5 flex-wrap">
          <ScorePillMini label="新" value={novelty} />
          <ScorePillMini label="迁" value={port} />
          <ScorePillMini label="付" value={rev} />
          <span className="pill-gray px-2 py-0.5 rounded text-[12.5px] font-medium">
            {sourceLabel} · {fm.first_seen?.slice(0, 10)}
          </span>
        </div>

        {/* tags strip */}
        {((fm.tags || []).length > 0 || userTags.length > 0) && (
          <div className="px-5 pb-3 flex gap-1.5 flex-wrap">
            {userTags.map((t: string) => (
              <span key={t} className="pill-pink px-1.5 py-0.5 rounded text-[11.5px] font-medium">#{t}</span>
            ))}
            {(fm.tags || []).map((t) => (
              <span key={t} className="pill-gray px-1.5 py-0.5 rounded text-[11.5px] font-medium">{t}</span>
            ))}
          </div>
        )}

        <hr className="border-0 border-t border-notion-divider mx-5 my-2" />

        {/* body */}
        <article
          className="px-5 pb-6 prose-content"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />

        <div className="px-5 mt-4 pb-32 space-y-1">
          <ToggleBlock icon="💭" title="我的备注 / 标签" defaultOpen={fav} accent="amber">
            <NoteEditor
              slug={app.slug}
              initialNote={app.fav_meta?.note || ""}
              initialTags={app.fav_meta?.tags || []}
              onSaved={onRefresh}
            />
          </ToggleBlock>
          <ToggleBlock icon="💡" title="我的点子（自动提炼）" accent="blue">
            <IdeasBlock slug={app.slug} />
          </ToggleBlock>
        </div>
      </div>

      {/* floating CTA */}
      <div
        className="absolute left-0 right-0 grid place-items-center pointer-events-none"
        style={{ bottom: `calc(env(safe-area-inset-bottom) + 16px)` }}
      >
        <button
          onClick={onOpenChat}
          className="pointer-events-auto inline-flex items-center gap-2 px-5 h-12 rounded-full text-white text-[15px] font-semibold bg-notion-blue shadow-[0_8px_20px_-4px_rgba(35,131,226,0.45)] active:scale-95 transition-transform"
        >
          <IcoMessage size={18} />
          跟 Claude 聊这个 App
        </button>
      </div>
    </div>
  );
}
