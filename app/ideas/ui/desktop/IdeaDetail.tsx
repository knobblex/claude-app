import { useCallback, useEffect, useState } from "react";
import { ideasApi, type IdeaDetail as IdeaDetailT, type ConvSummary } from "../api";
import { serverNowMs } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { IcoPlus, IcoTrash } from "@/components/icons";
import { cn } from "@/lib/utils";
import { FilesPanel } from "../FilesPanel";

function relTime(ts: number): string {
  if (!ts) return "";
  const diff = serverNowMs() / 1000 - ts;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(ts * 1000).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function IdeaDetail({
  iid,
  activeCid,
  onOpenChat,
  onConvCreated,
  onConvDeleted,
  onDocUpdated,
}: {
  iid: string;
  activeCid: string | null;
  onOpenChat: (cid: string) => void;
  onConvCreated: (cid: string) => void;
  onConvDeleted: (cid: string) => void;
  onDocUpdated: () => void;
}) {
  const [data, setData] = useState<IdeaDetailT | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [docOpen, setDocOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await ideasApi.getIdea(iid));
      setErr(null);
    } catch (e) {
      setErr(String((e as Error).message || e));
    }
  }, [iid]);

  useEffect(() => { load(); }, [load]);

  async function newConv() {
    try {
      const { id } = await ideasApi.createConversation(iid);
      await load();
      onConvCreated(id);
    } catch (e) {
      alert("新建对话失败：" + String((e as Error).message || e));
    }
  }

  async function delConv(cid: string) {
    if (!confirm("删除这段对话？")) return;
    try {
      await ideasApi.deleteConversation(iid, cid);
      onConvDeleted(cid);
      await load();
      onDocUpdated();
    } catch (e) {
      alert("删除失败：" + String((e as Error).message || e));
    }
  }

  if (err) {
    return <div className="p-4 text-red-600 text-[13px]">{err}</div>;
  }
  if (!data) {
    return <div className="p-4 text-notion-text3 text-[13px]">加载中…</div>;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 px-4 pt-4 pb-3 border-b border-notion-border">
        <h2 className="text-[16px] font-semibold text-notion-text truncate" style={{ letterSpacing: "-0.01em" }}>
          {data.title}
        </h2>
        <div className="mt-1 text-[11.5px] text-notion-text3">
          文档 {data.doc_chars} 字 · {data.conversations.length} 段对话
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* 文档块 */}
        <div className="px-4 pt-4 pb-3 border-b border-notion-divider">
          <div className="flex items-center justify-between mb-2">
            <span
              className="text-[11px] uppercase font-semibold text-notion-text3"
              style={{ letterSpacing: "0.08em" }}
            >
              文档
            </span>
            {data.doc && (
              <button
                onClick={() => setDocOpen((v) => !v)}
                className="text-[12px] text-notion-blue font-medium hover:opacity-80"
              >
                {docOpen ? "折叠" : "展开"}
              </button>
            )}
          </div>
          {!data.doc && (
            <div className="text-[12.5px] text-notion-text3 leading-relaxed">
              文档暂时为空。开一段对话聊聊，<br />
              然后用「整理到文档」沉淀成设计稿。
            </div>
          )}
          {data.doc && !docOpen && (
            <div className="text-[12.5px] text-notion-text2 leading-relaxed line-clamp-4 whitespace-pre-wrap">
              {data.doc.replace(/^#+\s*/gm, "").slice(0, 280)}
            </div>
          )}
          {data.doc && docOpen && (
            <article
              className="text-notion-text text-[13px] leading-relaxed mt-1 max-h-[40vh] overflow-y-auto pr-1"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(data.doc, false) }}
            />
          )}
        </div>

        {/* 素材夹 */}
        <div className="border-b border-notion-divider">
          <FilesPanel iid={iid} />
        </div>

        {/* 对话列表 */}
        <div className="px-3 pt-3 pb-1 flex items-center justify-between">
          <span
            className="text-[11px] uppercase font-semibold text-notion-text3"
            style={{ letterSpacing: "0.08em" }}
          >
            对话 · {data.conversations.length}
          </span>
          <button
            onClick={newConv}
            className="flex items-center gap-1 text-[12px] text-notion-blue font-medium hover:opacity-80"
          >
            <IcoPlus size={12} /> 新对话
          </button>
        </div>

        <div className="px-2 pb-4">
          {data.conversations.length === 0 && (
            <div className="px-3 py-5 text-[12.5px] text-notion-text3 leading-relaxed">
              还没开始聊。
              <br />
              点上方 + 开一段。
            </div>
          )}
          {data.conversations.map((c) => (
            <ConvRow
              key={c.id}
              conv={c}
              active={c.id === activeCid}
              onClick={() => onOpenChat(c.id)}
              onDelete={() => delConv(c.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ConvRow({
  conv,
  active,
  onClick,
  onDelete,
}: {
  conv: ConvSummary;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const prefix = conv.last_role === "user" ? "你：" : conv.last_role === "assistant" ? "AI：" : "";
  return (
    <div
      className={cn(
        "group flex items-center rounded-md",
        active ? "bg-notion-active" : "hover:bg-notion-hover",
      )}
    >
      <button onClick={onClick} className="flex-1 min-w-0 text-left px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[13px] font-semibold text-notion-text truncate">
            {conv.title || "新对话"}
          </span>
          {conv.distilled_count > 0 && (
            <span
              className="text-[10px] px-1.5 py-[1px] rounded-md bg-emerald-50 text-emerald-700 shrink-0"
              title={`已整理进文档 ${conv.distilled_count} 次`}
            >
              ✓ {conv.distilled_count}
            </span>
          )}
          <span className="text-[11px] text-notion-text3 shrink-0">
            {relTime(conv.last_ts || conv.created_ts)}
          </span>
        </div>
        {conv.last_preview && (
          <div className="mt-0.5 text-[11.5px] text-notion-text2 truncate">
            {prefix}
            {conv.last_preview}
          </div>
        )}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        aria-label="删除"
        className="opacity-0 group-hover:opacity-100 px-2 py-2 text-notion-text3 hover:text-red-500 rounded-md"
      >
        <IcoTrash size={13} />
      </button>
    </div>
  );
}
