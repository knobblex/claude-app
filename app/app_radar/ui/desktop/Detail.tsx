import { useEffect, useState } from "react";
import { radarApi as api, type AppDetail } from "../api";
import { cn, deriveEmoji, extractTagline, fullSource, num, sourceShort } from "@/lib/utils";
import { renderMarkdown } from "@/lib/markdown";
import { ScorePill, Bar, TagPill } from "@/components/atoms";
import {
  IcoArrowL, IcoExternal, IcoMessage, IcoMore,
  IcoLink, IcoCal, IcoBolt, IcoSwap, IcoCoin, IcoChart, IcoTag, IcoNote, IcoStar, IcoSparkles,
} from "@/components/icons";

function DetailActionBar({
  app, onBack, showChat, onToggleChat, chatCount, mobile = false,
}: {
  app: AppDetail; onBack: () => void; showChat: boolean; onToggleChat: () => void; chatCount: number; mobile?: boolean;
}) {
  const fm = app.frontmatter;
  return (
    <div className="h-10 flex items-center justify-between px-3 border-b border-notion-border bg-notion-bg/80 backdrop-blur sticky top-0 z-20">
      <div className="flex items-center gap-1 min-w-0">
        {!mobile && (
          <>
            <button onClick={onBack} className="h-7 px-2 rounded inline-flex items-center gap-1 text-[13px] text-notion-text2 hover:bg-notion-hover hover:text-notion-text">
              <IcoArrowL size={14} /> 返回
            </button>
            <span className="text-notion-text3 mx-1">/</span>
            <span className="text-[13px] text-notion-text3 shrink-0">{fullSource(fm.source)}</span>
            <span className="text-notion-text3 mx-1">/</span>
          </>
        )}
        <span className="text-[13px] text-notion-text font-medium truncate">{fm.name || app.slug}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {fm.url && (
          <a href={fm.url} target="_blank" rel="noreferrer"
             className="h-7 px-2 rounded inline-flex items-center gap-1.5 text-[13px] text-notion-text2 hover:bg-notion-hover hover:text-notion-text">
            <IcoExternal size={13} /> {!mobile && "原始链接"}
          </a>
        )}
        <button onClick={onToggleChat}
                className={cn(
                  "h-7 px-2 rounded inline-flex items-center gap-1.5 text-[13px]",
                  showChat ? "bg-[var(--notion-blueSoft)] text-notion-blue" : "text-notion-text2 hover:bg-notion-hover hover:text-notion-text"
                )}
                style={showChat ? { background: "#d3e5ef", color: "#2383e2" } : undefined}>
          <IcoMessage size={13} /> 聊天
          {chatCount > 0 && !showChat && <span className="text-notion-text3 font-mono text-[11px] ml-0.5">{chatCount}</span>}
        </button>
        {!mobile && (
          <button className="h-7 w-7 grid place-items-center rounded text-notion-text2 hover:bg-notion-hover hover:text-notion-text">
            <IcoMore size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function PageCover({ app, mobile = false }: { app: AppDetail; mobile?: boolean }) {
  const fm = app.frontmatter;
  const sourceCode = sourceShort[fm.source || ""] || "PH";
  const emoji = deriveEmoji(app.slug, fm.tags || [], fm.name || "");
  return (
    <div className={cn("relative", mobile ? "h-[100px]" : "h-[140px]", `cover-${sourceCode}`)}>
      <div className={cn(
        "absolute rounded-xl bg-white border border-notion-border grid place-items-center shadow-[0_2px_6px_rgba(15,15,15,0.06)]",
        mobile
          ? "left-4 -bottom-6 w-[56px] h-[56px] text-[30px]"
          : "left-[80px] -bottom-8 w-[72px] h-[72px] text-[40px]"
      )}>
        {emoji}
      </div>
    </div>
  );
}

function PageTitle({ app, tagline, mobile = false }: { app: AppDetail; tagline: string; mobile?: boolean }) {
  const fm = app.frontmatter;
  return (
    <div className={cn(mobile ? "px-4 pt-10" : "px-20 pt-12 max-w-[860px]")}>
      <h1 className={cn(
        "font-serif font-bold tracking-tight text-notion-text leading-[1.1]",
        mobile ? "text-[28px]" : "text-[44px]"
      )}>{fm.name || app.slug}</h1>
      {tagline && (
        <p className={cn(
          "font-serif italic text-notion-text2 leading-[1.55]",
          mobile ? "mt-3 text-[16px]" : "mt-4 text-[20px] max-w-[680px]"
        )}>
          {tagline}
        </p>
      )}
    </div>
  );
}

function PropertyRow({ icon, label, children, mobile = false }: { icon: React.ReactNode; label: string; children: React.ReactNode; mobile?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1.5 hover:bg-notion-hover rounded px-2 -mx-2 transition-colors">
      <div className={cn(
        "flex items-center gap-2 shrink-0 text-[14px] text-notion-text2 pt-1.5",
        mobile ? "w-[100px]" : "w-[170px]"
      )}>
        <span className="text-notion-text3 shrink-0">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="flex-1 min-w-0 text-[15px] text-notion-text py-1 flex items-center gap-2 flex-wrap">
        {children}
      </div>
    </div>
  );
}

function PropertyTable({ app, onToggleFav, mobile = false }: { app: AppDetail; onToggleFav: () => void; mobile?: boolean }) {
  const fm = app.frontmatter;
  const novelty = num(fm.score_novelty);
  const port = num(fm.score_portability);
  const rev = num(fm.score_revenue);
  const avg = num(fm.score_avg);
  const fav = app.is_favorite;
  const userTags = app.fav_meta?.tags || [];

  return (
    <div className={cn(mobile ? "px-4 mt-8" : "px-20 mt-10 max-w-[860px]")}>
      <div className="space-y-0.5">
        <PropertyRow icon={<IcoLink size={14} />} label="来源" mobile={mobile}>
          <span>{fullSource(fm.source)}</span>
        </PropertyRow>
        <PropertyRow icon={<IcoCal size={14} />} label="首次发现" mobile={mobile}>
          <span className="font-mono text-[13px]">{fm.first_seen}</span>
        </PropertyRow>
        <PropertyRow icon={<IcoBolt size={15} />} label="新颖度" mobile={mobile}>
          <ScorePill value={novelty} size="lg" />
          <span className="text-notion-text3 text-[13px]">
            {novelty === 5 ? "前所未见的产品形状" : novelty === 4 ? "已有形状的小创新" : "较常见"}
          </span>
        </PropertyRow>
        <PropertyRow icon={<IcoSwap size={15} />} label="可迁移" mobile={mobile}>
          <ScorePill value={port} size="lg" />
          <span className="text-notion-text3 text-[13px]">
            {port >= 4 ? "机制能套到多个场景" : port >= 3 ? "部分场景可迁移" : "较封闭"}
          </span>
        </PropertyRow>
        <PropertyRow icon={<IcoCoin size={15} />} label="付费潜力" mobile={mobile}>
          <ScorePill value={rev} size="lg" />
          <span className="text-notion-text3 text-[13px]">
            {rev >= 4 ? "商业模型清晰" : rev >= 3 ? "需求侧验证中" : "待观察"}
          </span>
        </PropertyRow>
        <PropertyRow icon={<IcoChart size={14} />} label="平均" mobile={mobile}>
          <Bar value={avg} />
        </PropertyRow>
        <PropertyRow icon={<IcoTag size={14} />} label="标签" mobile={mobile}>
          {(fm.tags || []).length > 0
            ? (fm.tags || []).map((t) => <TagPill key={t}>{t}</TagPill>)
            : <span className="text-notion-text3 text-[12.5px]">无</span>}
        </PropertyRow>
        <PropertyRow icon={<IcoStar size={15} filled={fav} />} label="收藏" mobile={mobile}>
          <button
            onClick={onToggleFav}
            className={cn(
              "h-8 px-3 rounded inline-flex items-center gap-1.5 text-[13.5px] font-medium border transition-colors",
              fav ? "bg-amber-50 border-amber-200 text-amber-800"
                  : "bg-white border-notion-border2 text-notion-text2 hover:text-notion-text"
            )}
          >
            <IcoStar size={13} filled={fav} /> {fav ? "已收藏" : "加入收藏"}
          </button>
        </PropertyRow>
        {userTags.length > 0 && (
          <PropertyRow icon={<IcoNote size={14} />} label="个人标签" mobile={mobile}>
            {userTags.map((t: string) => <TagPill key={t} kind="user">{t}</TagPill>)}
          </PropertyRow>
        )}
      </div>
    </div>
  );
}

function ToggleBlock({
  icon, title, defaultOpen = false, accent = "gray", hint, children,
}: {
  icon: string; title: string; defaultOpen?: boolean; accent?: "gray" | "amber" | "blue"; hint?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { setOpen(defaultOpen); }, [defaultOpen]);
  const accentClass =
    accent === "amber" ? "border-l-amber-300 bg-amber-50/50"
    : accent === "blue" ? "border-l-notion-blue bg-[var(--notion-blueSoft)]/25"
    : "border-l-notion-border2 bg-notion-soft/60";
  return (
    <div
      className={cn("notion-block my-4 rounded-md border-l-[3px]", accentClass)}
      style={accent === "blue" ? { borderLeftColor: "#2383e2", background: "rgba(211,229,239,0.25)" } : undefined}
    >
      <button onClick={() => setOpen((o) => !o)}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-notion-hover rounded transition-colors">
        <span className={cn("caret", open && "open")}>▸</span>
        <span className="text-[17px]">{icon}</span>
        <span className="font-semibold text-[15.5px] text-notion-text">{title}</span>
        {!open && <span className="text-[13px] text-notion-text3 ml-auto">{hint || "点击展开"}</span>}
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

function NoteEditor({ slug, initialNote, initialTags, onSaved }: {
  slug: string; initialNote: string; initialTags: string[]; onSaved: () => Promise<void>;
}) {
  const [note, setNote] = useState(initialNote || "");
  const [tagsStr, setTagsStr] = useState((initialTags || []).join(", "));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestErr, setSuggestErr] = useState<string | null>(null);
  const [loadingSuggest, setLoadingSuggest] = useState(false);

  useEffect(() => { setNote(initialNote || ""); setTagsStr((initialTags || []).join(", ")); }, [slug, initialNote, initialTags]);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      const tags = tagsStr.split(",").map((s) => s.trim()).filter(Boolean);
      await api.setFavorite(slug, { favorited: true, note, tags });
      setSaved(true);
      await onSaved();
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }
  async function suggest() {
    setLoadingSuggest(true); setSuggestErr(null);
    try {
      const res = await api.suggestNotes(slug);
      if (res.suggestions.length === 0) {
        setSuggestErr("Claude 没解析到候选。");
      } else {
        setSuggestions(res.suggestions);
      }
    } catch (e) {
      setSuggestErr(String((e as Error).message || e));
    } finally {
      setLoadingSuggest(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[12px] uppercase tracking-wider text-notion-text3 font-semibold mb-2">备注</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="为什么记下它？打算什么时候回看？"
          className="w-full min-h-[80px] resize-y px-3 py-2.5 text-[15px] bg-white border border-notion-border rounded-md text-notion-text placeholder:text-notion-text3 leading-[1.6]"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-2">
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => { setNote(s); setSuggestions([]); }}
                    className="text-left text-[14px] px-3 py-2.5 bg-notion-soft border border-notion-border rounded text-notion-text hover:bg-[var(--notion-blueSoft)] hover:border-notion-blue transition-colors leading-relaxed">
              {s}
            </button>
          ))}
        </div>
      )}
      {suggestErr && <div className="text-[13px] text-notion-text3">{suggestErr}</div>}
      <div>
        <label className="block text-[12px] uppercase tracking-wider text-notion-text3 font-semibold mb-2">个人标签</label>
        <input
          value={tagsStr}
          onChange={(e) => setTagsStr(e.target.value)}
          placeholder="逗号分隔，如：下个项目, 灵感库"
          className="w-full h-10 px-3 text-[15px] bg-white border border-notion-border rounded-md text-notion-text placeholder:text-notion-text3"
        />
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving}
                className="h-8 px-3 rounded text-[13.5px] font-medium bg-notion-text text-white hover:bg-[#52504a] disabled:opacity-60">
          {saving ? "保存中…" : saved ? "已保存 ✓" : "保存"}
        </button>
        <button onClick={suggest} disabled={loadingSuggest}
                className="h-8 px-3 rounded text-[13.5px] font-medium bg-white border border-notion-border2 text-notion-text2 hover:text-notion-text inline-flex items-center gap-1.5 disabled:opacity-60">
          <IcoSparkles size={12} /> {loadingSuggest ? "生成中…" : "AI 建议 3 条"}
        </button>
      </div>
    </div>
  );
}

function IdeasBlock({ slug }: { slug: string }) {
  const [md, setMd] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [distilling, setDistilling] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getNotes(slug).then((r) => { if (!cancelled) { setMd(r.markdown); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setErr(String(e.message || e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [slug]);

  async function distill() {
    setDistilling(true); setErr(null);
    try {
      const r = await api.distillNotes(slug);
      setMd(r.markdown);
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setDistilling(false);
    }
  }

  return (
    <div>
      {loading ? (
        <div className="text-[14px] text-notion-text3 py-2">加载中…</div>
      ) : md ? (
        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(md, false) }} />
      ) : (
        <div className="text-[14.5px] text-notion-text3 py-2 leading-relaxed">还没有提炼的点子。先去跟 Claude 聊几句这个 App，然后用下方按钮把对话里的点子归档下来。</div>
      )}
      {err && <div className="text-[13px] text-notion-text3 my-2">{err}</div>}
      <button onClick={distill} disabled={distilling}
              className="mt-4 h-8 px-3 rounded text-[13.5px] font-medium bg-white border border-notion-border2 text-notion-text2 hover:text-notion-text inline-flex items-center gap-1.5 disabled:opacity-60">
        <IcoSparkles size={12} /> {distilling ? "提炼中…" : md ? "重新提炼" : "提炼对话点子"}
      </button>
    </div>
  );
}

export function Detail({
  app,
  onBack,
  onToggleFav,
  onRefresh,
  showChat,
  onToggleChat,
  chatCount,
  mobile = false,
}: {
  app: AppDetail;
  onBack: () => void;
  onToggleFav: () => Promise<void>;
  onRefresh: () => Promise<void>;
  showChat: boolean;
  onToggleChat: () => void;
  chatCount: number;
  mobile?: boolean;
}) {
  const tagline = extractTagline(app.body);
  const bodyHtml = renderMarkdown(app.body, true);
  const inset = mobile ? "px-4" : "px-20 max-w-[820px]";

  return (
    <section className="flex-1 min-w-0 bg-notion-bg flex flex-col h-full overflow-hidden">
      <DetailActionBar app={app} onBack={onBack} showChat={showChat} onToggleChat={onToggleChat} chatCount={chatCount} mobile={mobile} />
      <div className="flex-1 overflow-y-auto pb-24">
        <PageCover app={app} mobile={mobile} />
        <PageTitle app={app} tagline={tagline} mobile={mobile} />
        <PropertyTable app={app} onToggleFav={onToggleFav} mobile={mobile} />

        <article className={cn(inset, "mt-12")} dangerouslySetInnerHTML={{ __html: bodyHtml }} />

        <div className={cn(inset, "mt-12")}>
          <hr className="border-0 border-t border-notion-divider" />
        </div>

        <div className={cn(inset, "mt-8 space-y-2")}>
          <ToggleBlock icon="💭" title="我的备注 / 标签" defaultOpen={app.is_favorite} accent="amber"
                       hint={app.is_favorite ? undefined : "未收藏 — 展开后可写"}>
            <NoteEditor
              slug={app.slug}
              initialNote={app.fav_meta?.note || ""}
              initialTags={app.fav_meta?.tags || []}
              onSaved={onRefresh}
            />
          </ToggleBlock>
          <ToggleBlock icon="💡" title="我的点子（自动提炼）" defaultOpen={showChat} accent="blue">
            <IdeasBlock slug={app.slug} />
          </ToggleBlock>
        </div>
      </div>
    </section>
  );
}
