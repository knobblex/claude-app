import { useEffect, useMemo, useState } from "react";
import { radarApi as api, type Idea } from "../api";
import { cn, deriveEmoji, num, relativeDate, sourceShort } from "@/lib/utils";
import { renderMarkdown } from "@/lib/markdown";
import { ScorePill } from "@/components/atoms";
import { IcoSparkles, IcoSort, IcoChevDown, IcoArrowL } from "@/components/icons";

type SortKey = "date" | "score" | "app";

export function IdeasView({ onOpenApp }: { onOpenApp: (slug: string) => void }) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("date");

  useEffect(() => {
    let cancelled = false;
    api.listIdeas()
      .then((d) => { if (!cancelled) setIdeas(d); })
      .catch((e) => { if (!cancelled) setErr(String(e.message || e)); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!ideas) return [];
    const q = search.trim().toLowerCase();
    let list = ideas;
    if (q) {
      list = list.filter((it) => {
        const bag = `${it.name} ${it.title} ${it.body} ${(it.tags || []).join(" ")}`.toLowerCase();
        return bag.includes(q);
      });
    }
    const sorted = [...list];
    if (sort === "date") {
      sorted.sort((a, b) => {
        const d = (b.first_seen || "").localeCompare(a.first_seen || "");
        if (d !== 0) return d;
        if (a.slug !== b.slug) return a.slug.localeCompare(b.slug);
        return a.index - b.index;
      });
    } else if (sort === "score") {
      sorted.sort((a, b) => {
        const d = num(b.score_avg) - num(a.score_avg);
        if (d !== 0) return d;
        if (a.slug !== b.slug) return a.slug.localeCompare(b.slug);
        return a.index - b.index;
      });
    } else {
      sorted.sort((a, b) => {
        const d = a.name.localeCompare(b.name);
        if (d !== 0) return d;
        return a.index - b.index;
      });
    }
    return sorted;
  }, [ideas, search, sort]);

  const totalApps = useMemo(() => {
    if (!ideas) return 0;
    return new Set(ideas.map((i) => i.slug)).size;
  }, [ideas]);

  return (
    <section className="flex-1 min-w-0 flex flex-col overflow-hidden bg-notion-bg">
      <div className="h-10 flex items-center px-3 border-b border-notion-border bg-notion-bg/80 backdrop-blur sticky top-0 z-20 gap-2">
        <IcoSparkles size={14} className="text-notion-text2" />
        <span className="text-[13px] text-notion-text font-medium">全部点子</span>
        <span className="text-[12px] text-notion-text3 font-mono">
          {ideas ? `${filtered.length}/${ideas.length} 条 · ${totalApps} 个 App` : "加载中…"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <input
            type="search"
            placeholder="搜索点子…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 px-2.5 text-[13px] bg-[rgba(55,53,47,0.04)] hover:bg-[rgba(55,53,47,0.06)] border border-transparent rounded text-notion-text placeholder:text-notion-text3 focus:bg-white focus:border-notion-border w-[200px]"
          />
          <button
            onClick={() => setSort((s) => (s === "date" ? "score" : s === "score" ? "app" : "date"))}
            className="h-7 px-2 rounded inline-flex items-center gap-1.5 text-[13px] text-notion-text2 hover:bg-notion-hover"
          >
            <IcoSort size={13} />
            <span className="text-notion-text">{sort === "date" ? "时间" : sort === "score" ? "评分" : "App"}</span>
            <IcoChevDown size={11} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
        {err && <div className="text-[13px] text-red-700 mb-3">加载失败：{err}</div>}
        {ideas === null && !err && <div className="text-[13px] text-notion-text3">加载中…</div>}
        {ideas !== null && filtered.length === 0 && (
          <div className="text-[13px] text-notion-text3 text-center py-12">没有匹配的点子</div>
        )}

        <div className="max-w-[860px] mx-auto space-y-3">
          {filtered.map((it) => (
            <IdeaCard key={`${it.slug}-${it.index}`} idea={it} onOpenApp={onOpenApp} />
          ))}
        </div>
      </div>
    </section>
  );
}

function IdeaCard({ idea, onOpenApp }: { idea: Idea; onOpenApp: (slug: string) => void }) {
  const emoji = deriveEmoji(idea.slug, idea.tags || [], idea.name);
  const avg = num(idea.score_avg);
  const html = useMemo(() => renderMarkdown(idea.body, false), [idea.body]);
  const kindLabel = idea.kind === "game" ? "GAME" : "APP";
  const srcShort = sourceShort[idea.source] || "?";

  return (
    <div className="border border-notion-border rounded-md bg-white hover:border-notion-text3/40 transition-colors p-4">
      <div className="flex items-center gap-2 text-[12px] text-notion-text3 mb-2">
        <button
          onClick={() => onOpenApp(idea.slug)}
          className="inline-flex items-center gap-1.5 hover:text-notion-blue group"
        >
          <span className="text-[14px]">{emoji}</span>
          <span className="text-[13px] text-notion-text2 font-medium group-hover:text-notion-blue truncate max-w-[260px]">
            {idea.name}
          </span>
          <IcoArrowL size={11} className="rotate-180 opacity-60" />
        </button>
        <span>·</span>
        <span className="uppercase tracking-wider font-mono">{kindLabel}/{srcShort}</span>
        {avg > 0 && (
          <>
            <span>·</span>
            <ScorePill value={avg} display={avg.toFixed(2)} size="sm" />
          </>
        )}
        {idea.first_seen && (
          <span className="ml-auto font-mono" title={idea.first_seen}>
            {relativeDate(idea.first_seen)}
          </span>
        )}
      </div>

      <div className="text-[16px] font-semibold text-notion-text leading-snug mb-2">
        <span className="text-notion-text3 font-mono mr-2">{idea.index}.</span>
        {idea.title}
      </div>

      <div
        className={cn("text-[14.5px] text-notion-text2 leading-relaxed", "prose-tight")}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
