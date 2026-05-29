import { useCallback, useEffect, useState } from "react";
import { ideasApi, type IdeaDetail, type ConvSummary } from "../api";
import { serverNowMs } from "@/lib/api";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import { renderMarkdown } from "@/lib/markdown";
import { IcoPlus, IcoTrash, IcoChevR } from "@/components/icons";
import { FilesPanel } from "../FilesPanel";

function relTime(ts: number): string {
  if (!ts) return "";
  const diff = serverNowMs() / 1000 - ts;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(ts * 1000).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function IdeaDetailScreen({
  iid,
  onBack,
  onOpenChat,
}: {
  iid: string;
  onBack: () => void;
  onOpenChat: (cid: string) => void;
}) {
  const [data, setData] = useState<IdeaDetail | null>(null);
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
      onOpenChat(id);
    } catch (e) {
      alert("新建对话失败：" + String((e as Error).message || e));
    }
  }

  async function delConv(cid: string) {
    if (!confirm("删除这段对话？")) return;
    try {
      await ideasApi.deleteConversation(iid, cid);
      await load();
    } catch (e) {
      alert("删除失败：" + String((e as Error).message || e));
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-notion-soft">
      <MobileHeader
        title={data?.title || "点子"}
        onBack={onBack}
        right={
          <button
            onClick={newConv}
            aria-label="新对话"
            className="-mr-1 h-9 w-9 grid place-items-center rounded text-notion-text2 active:bg-notion-active"
          >
            <IcoPlus size={20} />
          </button>
        }
      />

      {err && (
        <div className="bg-red-50 text-red-800 px-4 py-2 text-[13px] border-b border-red-100">
          {err}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {data === null && !err && (
          <div className="px-4 py-10 text-center text-[13px] text-notion-text3">加载中…</div>
        )}

        {data && (
          <>
            {/* 文档预览块 */}
            <div className="bg-notion-bg border-b border-notion-divider">
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <span
                  className="text-[11px] uppercase font-semibold text-notion-text3"
                  style={{ letterSpacing: "0.08em" }}
                >
                  点子文档 · {data.doc_chars} 字
                </span>
                {data.doc && (
                  <button
                    onClick={() => setDocOpen((v) => !v)}
                    className="text-[12.5px] text-notion-blue font-medium active:opacity-70"
                  >
                    {docOpen ? "收起" : "看全文"}
                  </button>
                )}
              </div>
              <div className="px-4 pb-4">
                {!data.doc && (
                  <div className="text-[13.5px] text-notion-text3 leading-relaxed">
                    文档暂时为空。开一段对话聊聊这个点子，
                    <br />
                    然后用「整理到文档」把对话沉淀成设计稿。
                  </div>
                )}
                {data.doc && !docOpen && (
                  <div className="text-[13.5px] text-notion-text2 leading-relaxed line-clamp-3 whitespace-pre-wrap">
                    {data.doc.replace(/^#+\s*/gm, "").slice(0, 240)}
                  </div>
                )}
                {data.doc && docOpen && (
                  <article
                    className="text-notion-text text-[14.5px] leading-relaxed mt-2"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(data.doc, false) }}
                  />
                )}
              </div>
            </div>

            {/* 素材夹 */}
            <div className="bg-notion-bg border-b border-notion-divider">
              <FilesPanel iid={iid} />
            </div>

            {/* 对话列表 */}
            <div className="flex items-center justify-between px-5 pt-5 pb-2">
              <span
                className="text-[11px] uppercase font-semibold text-notion-text3"
                style={{ letterSpacing: "0.08em" }}
              >
                对话 · {data.conversations.length}
              </span>
              <button
                onClick={newConv}
                className="flex items-center gap-1 text-[12.5px] text-notion-blue font-medium active:opacity-70"
              >
                <IcoPlus size={14} /> 新对话
              </button>
            </div>

            {data.conversations.length === 0 && (
              <div className="px-6 py-10 text-center text-[13.5px] text-notion-text3 leading-relaxed">
                还没开始聊。点上方 + 开一段。
              </div>
            )}

            {data.conversations.map((c) => (
              <ConvRow
                key={c.id}
                conv={c}
                onClick={() => onOpenChat(c.id)}
                onDelete={() => delConv(c.id)}
              />
            ))}
            <div className="h-10" />
          </>
        )}
      </div>
    </div>
  );
}

function ConvRow({
  conv,
  onClick,
  onDelete,
}: {
  conv: ConvSummary;
  onClick: () => void;
  onDelete: () => void;
}) {
  const prefix = conv.last_role === "user" ? "你：" : conv.last_role === "assistant" ? "AI：" : "";
  return (
    <div className="bg-notion-bg border-b border-notion-divider flex items-center">
      <button
        onClick={onClick}
        className="flex-1 text-left px-4 py-3.5 min-w-0 active:bg-notion-active"
      >
        <div className="flex items-center gap-2">
          <span
            className="flex-1 text-[15px] font-semibold text-notion-text truncate"
            style={{ letterSpacing: "-0.01em" }}
          >
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
          <span className="text-[11.5px] text-notion-text3 shrink-0">
            {relTime(conv.last_ts || conv.created_ts)}
          </span>
        </div>
        <div className="mt-1 text-[13px] text-notion-text2 truncate">
          {conv.last_preview ? `${prefix}${conv.last_preview}` : "（尚未开始）"}
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
