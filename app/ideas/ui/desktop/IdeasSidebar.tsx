import type { IdeaSummary } from "../api";
import { serverNowMs } from "@/lib/api";
import { IcoPlus, IcoTrash } from "@/components/icons";
import { cn } from "@/lib/utils";

function relTime(ts: number): string {
  if (!ts) return "";
  const diff = serverNowMs() / 1000 - ts;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(ts * 1000).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function IdeasSidebar({
  ideas,
  activeIid,
  onSelect,
  onNew,
  onDelete,
}: {
  ideas: IdeaSummary[] | null;
  activeIid: string | null;
  onSelect: (iid: string) => void;
  onNew: () => void;
  onDelete: (iid: string) => void;
}) {
  return (
    <aside className="w-[260px] shrink-0 border-r border-notion-border bg-notion-bg flex flex-col">
      <div className="px-3 pt-3 pb-1 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-notion-text3 font-semibold">
          点子
        </span>
        <button
          onClick={onNew}
          className="flex items-center gap-1 text-[12px] text-notion-blue font-medium hover:opacity-80"
        >
          <IcoPlus size={12} /> 新点子
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 space-y-0.5">
        {ideas === null && (
          <div className="px-3 py-4 text-[12.5px] text-notion-text3">加载中…</div>
        )}
        {ideas && ideas.length === 0 && (
          <div className="px-3 py-6 text-[12.5px] text-notion-text3 leading-relaxed">
            还没点子。
            <br />
            点上方"+ 新点子"加一个。
          </div>
        )}
        {ideas && ideas.map((idea) => {
          const active = activeIid === idea.id;
          return (
            <div
              key={idea.id}
              className={cn(
                "group flex items-center rounded-md",
                active ? "bg-notion-active" : "hover:bg-notion-hover",
              )}
            >
              <button
                onClick={() => onSelect(idea.id)}
                className="flex-1 min-w-0 text-left px-2.5 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-[13.5px] font-semibold text-notion-text truncate">
                    {idea.title || "无题"}
                  </span>
                  <span className="text-[11px] text-notion-text3 shrink-0">
                    {relTime(idea.updated_ts || idea.created_ts)}
                  </span>
                </div>
                <div className="mt-0.5 text-[11.5px] text-notion-text3 truncate">
                  {idea.doc_chars} 字 · {idea.conv_count} 段
                </div>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(idea.id); }}
                aria-label="删除"
                className="opacity-0 group-hover:opacity-100 px-2 py-2 text-notion-text3 hover:text-red-500 rounded-md"
              >
                <IcoTrash size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
