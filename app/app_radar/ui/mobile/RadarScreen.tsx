import { useCallback, useEffect, useMemo, useState } from "react";
import { radarApi as api, type AppDetail, type AppListItem } from "../api";
import { ChatDrawer } from "@/components/ChatDrawer";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import { MobileDetail } from "./MobileDetail";
import { cn, deriveEmoji, num, sourceShort } from "@/lib/utils";
import { IcoStar } from "@/components/icons";

type Inner =
  | { kind: "list" }
  | { kind: "detail"; slug: string }
  | { kind: "chat"; slug: string };

type Filter = "all" | "fav" | "high" | "PH" | "AS-US" | "AS-CN" | "AS-JP";
type SortKey = "score" | "time";

function pillFor(score: number): { bg: string; dot: string } {
  if (score >= 5) return { bg: "pill-green", dot: "dot-green" };
  if (score >= 4) return { bg: "pill-blue", dot: "dot-blue" };
  if (score >= 3) return { bg: "pill-yellow", dot: "dot-yellow" };
  return { bg: "pill-gray", dot: "dot-gray" };
}

const sourceDotClass: Record<string, string> = {
  PH: "dot-orange", "AS-US": "dot-blue", "AS-CN": "dot-red", "AS-JP": "dot-pink",
};

function AppRowCompact({ app, onClick, onStar }: {
  app: AppListItem; onClick: () => void; onStar: () => void;
}) {
  const fm = app.frontmatter;
  const avg = num(fm.score_avg);
  const novelty = num(fm.score_novelty);
  const port = num(fm.score_portability);
  const rev = num(fm.score_revenue);
  const userTags = app.tags_user || [];
  const sysTags = (fm.tags || []).slice(0, Math.max(0, 3 - userTags.length));
  const emoji = deriveEmoji(app.slug, fm.tags || [], fm.name || "");
  const source = sourceShort[fm.source || ""] || "?";
  const c = pillFor(avg);

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3.5 flex gap-3 items-start active:bg-notion-active bg-notion-bg border-b border-notion-divider"
    >
      <div className="w-10 h-10 rounded-[12px] bg-notion-soft grid place-items-center text-[22px] shrink-0">
        {emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[15.5px] font-semibold text-notion-text truncate flex-1" style={{ letterSpacing: "-0.01em" }}>{fm.name || app.slug}</span>
          {app.kind === "game" && (
            <span className="pill-purple px-1.5 py-0.5 rounded text-[10.5px] font-semibold tracking-wider shrink-0">GAME</span>
          )}
          <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11.5px] font-semibold", c.bg)}>
            <span className={cn("w-1.5 h-1.5 rounded-full", c.dot)} />
            {avg.toFixed(2)}
          </span>
          {app.is_favorite && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onStar(); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onStar(); } }}
              className="text-amber-500 shrink-0 ml-0.5 p-0.5 cursor-pointer"
              aria-label="取消收藏"
            >
              <IcoStar size={15} filled />
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[12px] text-notion-text3 font-mono">
          <span>新{novelty || "?"} 迁{port || "?"} 付{rev || "?"}</span>
          <span className={cn("w-1.5 h-1.5 rounded-full inline-block", sourceDotClass[source] || "dot-gray")} />
          <span>{source}</span>
        </div>
        {(userTags.length || sysTags.length) ? (
          <div className="mt-1.5 flex items-center gap-1 flex-wrap">
            {userTags.map((t) => (
              <span key={t} className="pill-pink px-1.5 py-0.5 rounded text-[11px] font-medium">#{t}</span>
            ))}
            {sysTags.map((t) => (
              <span key={t} className="pill-gray px-1.5 py-0.5 rounded text-[11px] font-medium">{t}</span>
            ))}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function FilterChips({
  filter, setFilter, counts, sort, toggleSort,
}: {
  filter: Filter;
  setFilter: (f: Filter) => void;
  counts: Record<Filter, number>;
  sort: SortKey;
  toggleSort: () => void;
}) {
  const chips: { key: Filter; label: string; emoji?: string }[] = [
    { key: "all", label: "全部" },
    { key: "fav", label: "收藏", emoji: "⭐" },
    { key: "high", label: "高分 ≥4.0" },
    { key: "PH", label: "PH" },
    { key: "AS-US", label: "US" },
    { key: "AS-CN", label: "CN" },
    { key: "AS-JP", label: "JP" },
  ];
  return (
    <div className="flex items-center gap-2 px-4 py-2.5">
      <div className="flex gap-2 overflow-x-auto scrollbar-none flex-1 min-w-0" style={{ scrollbarWidth: "none" }}>
      {chips.map((c) => {
        const on = filter === c.key;
        const count = counts[c.key];
        if (count === 0 && c.key !== "all") return null;
        return (
          <button
            key={c.key}
            onClick={() => setFilter(c.key)}
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-[13.5px] font-medium border transition-colors",
              on
                ? "bg-notion-text text-white border-transparent"
                : "bg-notion-soft text-notion-text border-notion-border active:bg-notion-active",
            )}
          >
            {c.emoji && <span>{c.emoji}</span>}
            <span>{c.label}</span>
            <span className={cn("text-[11.5px] font-mono", on ? "opacity-70" : "text-notion-text3")}>
              {count}
            </span>
          </button>
        );
      })}
      </div>
      <button
        onClick={toggleSort}
        className="shrink-0 inline-flex items-center gap-1 px-2.5 h-8 rounded-full text-[12.5px] font-medium border bg-notion-bg text-notion-text2 border-notion-border active:bg-notion-active"
        aria-label="切换排序"
      >
        <span className="text-notion-text3">排序</span>
        <span className="text-notion-text">{sort === "score" ? "分数" : "时间"}</span>
      </button>
    </div>
  );
}

export function RadarScreen({ onBack }: { onBack: () => void }) {
  const [apps, setApps] = useState<AppListItem[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<AppDetail | null>(null);
  const [inner, setInner] = useState<Inner>({ kind: "list" });
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("score");
  // slug -> bare-conversation UUID. Resolved when chat opens for a slug.
  const [chatCidBySlug, setChatCidBySlug] = useState<Record<string, string>>({});

  const reloadApps = useCallback(async () => {
    try {
      const list = await api.listApps();
      setApps(list);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(String((e as Error).message || e));
    }
  }, []);

  useEffect(() => { reloadApps(); }, [reloadApps]);

  // Resolve the cid the first time chat opens for a given slug. ChatDrawer
  // needs a UUID to hit the shell's /api/conversations/<id>/stream pipeline.
  useEffect(() => {
    if (inner.kind !== "chat") return;
    if (chatCidBySlug[inner.slug]) return;
    const slug = inner.slug;
    let cancelled = false;
    api.getOrCreateConversation(slug)
      .then((r) => { if (!cancelled) setChatCidBySlug((m) => ({ ...m, [slug]: r.id })); })
      .catch(console.error);
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inner.kind === "chat" ? inner.slug : null]);

  useEffect(() => {
    if (inner.kind === "list") { setDetail(null); return; }
    let cancelled = false;
    api.getApp(inner.slug)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(console.error);
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inner.kind === "list" ? null : inner.slug]);

  const counts = useMemo<Record<Filter, number>>(() => {
    const r: Record<Filter, number> = { all: 0, fav: 0, high: 0, PH: 0, "AS-US": 0, "AS-CN": 0, "AS-JP": 0 };
    if (!apps) return r;
    r.all = apps.length;
    for (const a of apps) {
      if (a.is_favorite) r.fav++;
      if (num(a.frontmatter.score_avg) >= 4.0) r.high++;
      const src = sourceShort[a.frontmatter.source || ""];
      if (src && src in r) (r as Record<string, number>)[src]++;
    }
    return r;
  }, [apps]);

  const todayCount = useMemo(() => {
    if (!apps) return 0;
    const today = new Date().toISOString().slice(0, 10);
    return apps.filter((a) => (a.frontmatter.first_seen || "").slice(0, 10) === today).length;
  }, [apps]);

  const visible = useMemo(() => {
    const list = apps || [];
    return list
      .filter((a) => {
        if (filter === "all") return true;
        if (filter === "fav") return a.is_favorite;
        if (filter === "high") return num(a.frontmatter.score_avg) >= 4.0;
        return sourceShort[a.frontmatter.source || ""] === filter;
      })
      .sort((a, b) => {
        if (sort === "time") {
          return (b.frontmatter.first_seen || "").localeCompare(a.frontmatter.first_seen || "");
        }
        return num(b.frontmatter.score_avg) - num(a.frontmatter.score_avg);
      });
  }, [apps, filter, sort]);

  async function toggleStar(slug: string) {
    const app = apps?.find((a) => a.slug === slug);
    if (!app) return;
    try {
      await api.setFavorite(slug, { favorited: !app.is_favorite });
      await reloadApps();
      if (detail && detail.slug === slug) {
        const d = await api.getApp(slug);
        setDetail(d);
      }
    } catch (e) {
      console.error("toggle star failed", e);
    }
  }

  async function refreshDetail() {
    if (inner.kind === "list") return;
    await reloadApps();
    const d = await api.getApp(inner.slug);
    setDetail(d);
  }

  // ---- list view ----
  if (inner.kind === "list") {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    return (
      <div className="flex-1 min-h-0 flex flex-col bg-notion-soft">
        <MobileHeader title="📡 Hot App Radar" onBack={onBack} />
        {loadErr && (
          <div className="bg-red-50 text-red-800 px-4 py-2 text-[13px] border-b border-red-100">
            后端未连通：{loadErr}
          </div>
        )}
        {apps === null && !loadErr ? (
          <div className="flex-1 grid place-items-center text-notion-text3 text-[14px]">加载中…</div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="mx-4 mt-3 mb-2 p-3.5 rounded-[14px] flex gap-3 items-start bg-notion-bg border border-notion-border">
              <span className="text-[22px]">🗞</span>
              <div className="flex-1 min-w-0">
                <div className="text-[14.5px] font-semibold text-notion-text">今日 {dateStr}</div>
                <div className="text-[13px] text-notion-text2 leading-snug mt-0.5">
                  {todayCount > 0
                    ? `今日新进卷宗 ${todayCount} 个，共 ${counts.all} 卷宗 · ${counts.fav} 收藏`
                    : `共 ${counts.all} 卷宗 · ${counts.fav} 收藏 · 今日暂无新发现`}
                </div>
              </div>
            </div>
            <FilterChips
              filter={filter}
              setFilter={setFilter}
              counts={counts}
              sort={sort}
              toggleSort={() => setSort((s) => (s === "score" ? "time" : "score"))}
            />
            <div className="border-t border-notion-divider">
              {visible.length === 0 ? (
                <div className="px-6 py-12 text-center text-[14px] text-notion-text3">
                  没有匹配的卷宗
                </div>
              ) : (
                visible.map((a) => (
                  <AppRowCompact
                    key={a.slug}
                    app={a}
                    onClick={() => setInner({ kind: "detail", slug: a.slug })}
                    onStar={() => toggleStar(a.slug)}
                  />
                ))
              )}
              <div className="h-6 bg-notion-bg" />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- detail / chat (need detail loaded) ----
  if (!detail) {
    return (
      <div className="flex-1 min-h-0 flex flex-col bg-notion-bg">
        <MobileHeader title="加载中…" onBack={() => setInner({ kind: "list" })} />
        <div className="flex-1 grid place-items-center text-notion-text3 text-[14px]">加载中…</div>
      </div>
    );
  }

  if (inner.kind === "chat") {
    const cid = chatCidBySlug[detail.slug];
    return (
      <div className="flex-1 min-h-0 flex flex-col bg-notion-bg">
        <MobileHeader
          title={detail.frontmatter.name || detail.slug}
          onBack={() => setInner({ kind: "detail", slug: detail.slug })}
        />
        {cid ? (
          <ChatDrawer
            target={{ kind: "conv", id: cid }}
            onClose={() => setInner({ kind: "detail", slug: detail.slug })}
            mobile
          />
        ) : (
          <div className="flex-1 grid place-items-center text-notion-text3 text-[14px]">加载中…</div>
        )}
      </div>
    );
  }

  // ---- detail ----
  return (
    <MobileDetail
      key={detail.slug}
      app={detail}
      onBack={() => setInner({ kind: "list" })}
      onToggleFav={async () => { await toggleStar(detail.slug); }}
      onRefresh={refreshDetail}
      onOpenChat={() => setInner({ kind: "chat", slug: detail.slug })}
    />
  );
}
