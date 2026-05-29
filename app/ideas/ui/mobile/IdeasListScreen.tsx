import type { IdeaSummary } from "../api";
import { serverNowMs } from "@/lib/api";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import { IcoChevR, IcoPlus, IcoTrash } from "@/components/icons";

function relTime(ts: number): string {
  if (!ts) return "";
  const diff = serverNowMs() / 1000 - ts;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(ts * 1000).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function IdeasListScreen({
  ideas,
  err,
  onBack,
  onOpenIdea,
  onNew,
  onDelete,
}: {
  ideas: IdeaSummary[] | null;
  err: string | null;
  onBack: () => void;
  onOpenIdea: (iid: string) => void;
  onNew: () => void;
  onDelete: (iid: string) => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-notion-soft">
      <MobileHeader
        title="点子库"
        onBack={onBack}
        right={
          <button
            onClick={onNew}
            aria-label="新点子"
            className="-mr-1 h-9 w-9 grid place-items-center rounded text-notion-text2 active:bg-notion-active"
          >
            <IcoPlus size={20} />
          </button>
        }
      />

      {err && (
        <div className="bg-red-50 text-red-800 px-4 py-2 text-[13px] border-b border-red-100">
          后端未连通：{err}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {ideas === null && !err && (
          <div className="px-4 py-10 text-center text-[13px] text-notion-text3">加载中…</div>
        )}

        {ideas && ideas.length === 0 && (
          <div className="px-6 py-14 text-center text-[13.5px] text-notion-text3 leading-relaxed">
            还没有点子。点右上 <span className="inline-block align-middle">＋</span> 加一个。
            <br />
            每个点子下面可以开多场对话，聊到关键处一键整理进文档。
          </div>
        )}

        {ideas && ideas.map((idea) => (
          <IdeaRow
            key={idea.id}
            idea={idea}
            onClick={() => onOpenIdea(idea.id)}
            onDelete={() => onDelete(idea.id)}
          />
        ))}
        <div className="h-10" />
      </div>
    </div>
  );
}

function IdeaRow({
  idea,
  onClick,
  onDelete,
}: {
  idea: IdeaSummary;
  onClick: () => void;
  onDelete: () => void;
}) {
  const docStat = idea.doc_chars
    ? `${idea.doc_chars} 字文档`
    : "尚无文档";
  const convStat = idea.conv_count
    ? `${idea.conv_count} 段对话`
    : "未开聊";
  return (
    <div className="bg-notion-bg border-b border-notion-divider flex items-center">
      <button
        onClick={onClick}
        className="flex-1 text-left px-4 py-3.5 min-w-0 active:bg-notion-active"
      >
        <div className="flex items-center gap-2">
          <span
            className="flex-1 text-[15.5px] font-semibold text-notion-text truncate"
            style={{ letterSpacing: "-0.01em" }}
          >
            {idea.title || "无题"}
          </span>
          <span className="text-[11.5px] text-notion-text3 shrink-0">
            {relTime(idea.updated_ts || idea.created_ts)}
          </span>
        </div>
        <div className="mt-1 text-[12.5px] text-notion-text2 truncate">
          {docStat} · {convStat}
        </div>
      </button>
      <button
        onClick={onDelete}
        aria-label="删除"
        className="px-3 h-full text-notion-text3 active:text-red-500 active:bg-notion-active grid place-items-center"
      >
        <IcoTrash size={16} />
      </button>
      <span className="pr-3 text-notion-text3">
        <IcoChevR size={16} />
      </span>
    </div>
  );
}
