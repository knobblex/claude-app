import { useMemo, useState } from "react";
import type { AppListItem } from "../api";
import { cn, num, sourceDot, sourceShort, deriveEmoji, relativeDate } from "@/lib/utils";
import { ScorePill, TagPill } from "@/components/atoms";
import { IcoSort, IcoLayers, IcoChevDown, IcoStar } from "@/components/icons";

type AppRowProps = {
  app: AppListItem;
  selected: boolean;
  onClick: () => void;
  onStar: () => void;
};

function AppRow({ app, selected, onClick, onStar }: AppRowProps) {
  const fm = app.frontmatter;
  const avg = num(fm.score_avg);
  const novelty = num(fm.score_novelty);
  const port = num(fm.score_portability);
  const rev = num(fm.score_revenue);
  const userTags = app.tags_user || [];
  const sysTags = (fm.tags || []).slice(0, Math.max(0, 3 - userTags.length));
  const emoji = deriveEmoji(app.slug, fm.tags || [], fm.name || "");
  const source = fm.source || "";

  return (
    <div
      onClick={onClick}
      className={cn(
        "group cursor-pointer pl-7 pr-2.5 py-2 mx-1.5 rounded transition-colors",
        selected ? "bg-[var(--notion-blueSoft)]" : "hover:bg-notion-hover"
      )}
      style={selected ? { background: "rgba(35,131,226,0.16)" } : undefined}
    >
      <div className="flex items-center gap-2">
        <span className="text-[16px] leading-none w-[20px] text-center shrink-0">{emoji}</span>
        <span className="text-[15px] font-medium text-notion-text truncate flex-1">{fm.name || app.slug}</span>
        {app.kind === "game" && (
          <span className="pill-purple px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider shrink-0">GAME</span>
        )}
        <ScorePill value={avg} display={avg.toFixed(2)} size="sm" />
        <button
          onClick={(e) => { e.stopPropagation(); onStar(); }}
          className={cn(
            "p-1 rounded shrink-0",
            app.is_favorite
              ? "text-amber-500 opacity-100"
              : "text-notion-text3 opacity-0 group-hover:opacity-100 hover:text-notion-text2"
          )}
        >
          <IcoStar size={14} filled={app.is_favorite} />
        </button>
      </div>
      <div className="flex items-center gap-2 mt-1.5 ml-[28px] text-[12px] text-notion-text3 font-mono">
        <span>新{novelty || "?"}</span>
        <span>迁{port || "?"}</span>
        <span>付{rev || "?"}</span>
        <span className={cn("ml-1 w-1.5 h-1.5 rounded-full", sourceDot[source] || "dot-gray")} />
        <span className="uppercase tracking-wider">{sourceShort[source] || "?"}</span>
        {fm.first_seen && (
          <span className="ml-auto normal-case tracking-normal" title={fm.first_seen}>
            {relativeDate(fm.first_seen)}
          </span>
        )}
      </div>
      {(userTags.length || sysTags.length) ? (
        <div className="flex items-center gap-1.5 flex-wrap mt-2 ml-[28px]">
          {userTags.map((t) => <TagPill key={t} kind="user" size="sm">{t}</TagPill>)}
          {sysTags.map((t) => <TagPill key={t} size="sm">{t}</TagPill>)}
        </div>
      ) : null}
    </div>
  );
}

function GroupHeader({ name, count, expanded, onToggle, hint }: {
  name: string; count: number; expanded: boolean; onToggle: () => void; hint?: string;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full px-4 py-2 flex items-center gap-1.5 text-[12.5px] uppercase tracking-wider text-notion-text3 hover:bg-notion-hover transition-colors"
    >
      <span className={cn("caret", expanded && "open")}>▸</span>
      <span className="font-semibold">{name}</span>
      <span className="text-notion-text3/80 font-mono normal-case ml-1">{count}</span>
      {hint && <span className="ml-auto text-[11px] normal-case tracking-normal text-notion-text3">{hint}</span>}
    </button>
  );
}

export function Sidebar({
  apps,
  selectedSlug,
  onSelect,
  onStar,
  totalCount,
  mobile = false,
}: {
  apps: AppListItem[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onStar: (slug: string) => void;
  totalCount: number;
  mobile?: boolean;
}) {
  const [groupBy, setGroupBy] = useState<"score" | "source">("score");
  const [sort, setSort] = useState<"avg" | "novelty" | "first_seen">("avg");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const sortedApps = useMemo(() => {
    const arr = [...apps];
    if (sort === "avg") arr.sort((a, b) => num(b.frontmatter.score_avg) - num(a.frontmatter.score_avg));
    if (sort === "novelty") arr.sort((a, b) => num(b.frontmatter.score_novelty) - num(a.frontmatter.score_novelty));
    if (sort === "first_seen") arr.sort((a, b) => (b.frontmatter.first_seen || "").localeCompare(a.frontmatter.first_seen || ""));
    return arr;
  }, [apps, sort]);

  const groups = useMemo<[string, AppListItem[]][]>(() => {
    const buckets = new Map<string, AppListItem[]>();
    if (groupBy === "score") {
      const ranges: [string, (a: AppListItem) => boolean][] = [
        ["4.33 高分", (a) => num(a.frontmatter.score_avg) >= 4.33],
        ["4.0 良好", (a) => num(a.frontmatter.score_avg) >= 4.0 && num(a.frontmatter.score_avg) < 4.33],
        ["3.67 一般", (a) => num(a.frontmatter.score_avg) >= 3.5 && num(a.frontmatter.score_avg) < 4.0],
        ["其它", (a) => num(a.frontmatter.score_avg) < 3.5],
      ];
      for (const [n, fn] of ranges) {
        const list = sortedApps.filter(fn);
        if (list.length) buckets.set(n, list);
      }
    } else {
      const sources: [string, string][] = [
        ["Product Hunt", "producthunt"],
        ["App Store · 美", "appstore-us"],
        ["App Store · 中", "appstore-cn"],
        ["App Store · 日", "appstore-jp"],
      ];
      for (const [n, code] of sources) {
        const list = sortedApps.filter((a) => a.frontmatter.source === code);
        if (list.length) buckets.set(n, list);
      }
    }
    return Array.from(buckets.entries());
  }, [sortedApps, groupBy]);

  const isOpen = (n: string) => openGroups[n] !== false;
  const toggleGroup = (n: string) => setOpenGroups((g) => ({ ...g, [n]: !isOpen(n) }));

  return (
    <aside className={cn(
      "bg-notion-bg flex flex-col min-h-0",
      mobile ? "w-full flex-1 border-0" : "w-[360px] shrink-0 border-r border-notion-border"
    )}>
      <div className="px-4 py-2.5 border-b border-notion-divider flex items-center gap-1.5 text-[13.5px] text-notion-text2">
        <button
          onClick={() => setSort((s) => (s === "avg" ? "novelty" : s === "novelty" ? "first_seen" : "avg"))}
          className="h-8 px-2 rounded inline-flex items-center gap-1.5 hover:bg-notion-hover"
        >
          <IcoSort size={14} /> 排序
          <span className="text-notion-text ml-0.5">{sort === "avg" ? "平均" : sort === "novelty" ? "新颖" : "首次"}</span>
          <IcoChevDown size={12} />
        </button>
        <button
          onClick={() => setGroupBy((g) => (g === "score" ? "source" : "score"))}
          className="h-8 px-2 rounded inline-flex items-center gap-1.5 hover:bg-notion-hover"
        >
          <IcoLayers size={14} /> 分组
          <span className="text-notion-text ml-0.5">{groupBy === "score" ? "评分" : "来源"}</span>
          <IcoChevDown size={12} />
        </button>
        <span className="ml-auto text-notion-text3 text-[12.5px] font-mono">{apps.length}/{totalCount}</span>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {groups.length === 0 && (
          <div className="px-4 py-8 text-[14.5px] text-notion-text3 text-center">没有匹配</div>
        )}
        {groups.map(([name, list]) => (
          <div key={name} className="mb-1">
            <GroupHeader
              name={name}
              count={list.length}
              expanded={isOpen(name)}
              onToggle={() => toggleGroup(name)}
            />
            {isOpen(name) && (
              <div className="space-y-0.5 mb-1">
                {list.map((a) => (
                  <AppRow
                    key={a.slug}
                    app={a}
                    selected={a.slug === selectedSlug}
                    onClick={() => onSelect(a.slug)}
                    onStar={() => onStar(a.slug)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="h-4" />
      </div>
    </aside>
  );
}
