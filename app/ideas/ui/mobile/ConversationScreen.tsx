import { useCallback, useEffect, useState } from "react";
import { ideasApi } from "../api";
import { ChatDrawer } from "@/components/ChatDrawer";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import { renderMarkdown } from "@/lib/markdown";

export function ConversationScreen({
  iid,
  cid,
  onBack,
}: {
  iid: string;
  cid: string;
  onBack: () => void;
}) {
  const [doc, setDoc] = useState<string>("");
  const [docOpen, setDocOpen] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadDoc = useCallback(async () => {
    try {
      const d = await ideasApi.getIdea(iid);
      setDoc(d.doc || "");
    } catch {
      /* ignore */
    }
  }, [iid]);

  useEffect(() => { loadDoc(); }, [loadDoc]);

  async function distill() {
    if (distilling) return;
    setDistilling(true);
    setToast("整理中…可能要 20–30 秒");
    try {
      const r = await ideasApi.distill(iid, cid);
      setDoc(r.doc);
      setToast(`文档已更新 · +${r.diff.added} / -${r.diff.removed} 行`);
      setTimeout(() => setToast(null), 4000);
    } catch (e) {
      setToast("整理失败：" + String((e as Error).message || e));
      setTimeout(() => setToast(null), 4000);
    } finally {
      setDistilling(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-notion-bg">
      <MobileHeader
        title="对话"
        onBack={onBack}
        right={
          <div className="flex items-center gap-1">
            <button
              onClick={distill}
              disabled={distilling}
              className="px-2 h-9 grid place-items-center text-[12.5px] font-medium text-notion-blue disabled:text-notion-text3 active:opacity-70"
            >
              {distilling ? "整理中…" : "整理"}
            </button>
            <button
              onClick={() => setDocOpen(true)}
              aria-label="查看文档"
              className="-mr-1 px-2 h-9 grid place-items-center rounded text-notion-text2 active:bg-notion-active text-[12.5px] font-medium"
            >
              文档
            </button>
          </div>
        }
      />

      {toast && (
        <div className="shrink-0 px-4 py-2 bg-emerald-50 text-emerald-800 text-[12.5px] border-b border-emerald-100">
          {toast}
        </div>
      )}

      <ChatDrawer target={{ kind: "conv", id: cid }} onClose={onBack} mobile />

      {docOpen && <DocSheet doc={doc} onClose={() => setDocOpen(false)} />}
    </div>
  );
}

function DocSheet({ doc, onClose }: { doc: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-black/40" onClick={onClose}>
      <div
        className="mt-auto h-[88vh] bg-notion-bg rounded-t-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="shrink-0 px-4 h-12 flex items-center justify-between border-b border-notion-border">
          <span className="text-[15px] font-semibold text-notion-text">点子文档</span>
          <button
            onClick={onClose}
            className="text-[13px] text-notion-blue font-medium active:opacity-70"
          >
            关闭
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          {!doc ? (
            <div className="text-notion-text3 text-[13.5px] leading-relaxed py-6 text-center">
              文档暂时为空。聊完点「整理」生成。
            </div>
          ) : (
            <article
              className="text-notion-text text-[14.5px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(doc, false) }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
