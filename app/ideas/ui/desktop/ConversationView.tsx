import { useState } from "react";
import { ideasApi } from "../api";
import { ChatDrawer } from "@/components/ChatDrawer";

export function ConversationView({
  iid,
  cid,
  onDistilled,
}: {
  iid: string;
  cid: string;
  onDistilled: () => void;
  onTitleChange?: () => void;
}) {
  const [distilling, setDistilling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function distill() {
    if (distilling) return;
    setDistilling(true);
    setToast("整理中…可能要 20–30 秒");
    try {
      const r = await ideasApi.distill(iid, cid);
      setToast(`文档已更新 · +${r.diff.added} / -${r.diff.removed} 行`);
      onDistilled();
      setTimeout(() => setToast(null), 5000);
    } catch (e) {
      setToast("整理失败：" + String((e as Error).message || e));
      setTimeout(() => setToast(null), 5000);
    } finally {
      setDistilling(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-6 h-10 border-b border-notion-border flex items-center justify-end gap-3">
        {toast && (
          <span className="text-[12.5px] text-emerald-700 truncate">{toast}</span>
        )}
        <button
          onClick={distill}
          disabled={distilling}
          className="text-[12.5px] font-medium px-3 py-1 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:bg-notion-soft disabled:text-notion-text3"
        >
          {distilling ? "整理中…" : "整理到文档"}
        </button>
      </div>

      {/* mobile=true 让 ChatDrawer 撑满 + 自带麦克风 composer。
          ideas 桌面端的"对话"区域恰好需要这套行为。 */}
      <div className="flex-1 min-h-0 flex">
        <ChatDrawer target={{ kind: "conv", id: cid }} onClose={() => { /* noop */ }} mobile />
      </div>
    </div>
  );
}
