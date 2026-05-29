import { useCallback, useEffect, useState } from "react";
import { ideasApi, type IdeaSummary } from "../api";
import { IdeasSidebar } from "./IdeasSidebar";
import { IdeaDetail } from "./IdeaDetail";
import { ConversationView } from "./ConversationView";

type Selection =
  | { kind: "none" }
  | { kind: "idea"; iid: string }
  | { kind: "chat"; iid: string; cid: string };

export default function DesktopIdeas() {
  const [sel, setSel] = useState<Selection>({ kind: "none" });
  const [ideas, setIdeas] = useState<IdeaSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // bump to force IdeaDetail to refetch (e.g. after distill in ConversationView)
  const [detailRev, setDetailRev] = useState(0);

  const reload = useCallback(async () => {
    try {
      setIdeas(await ideasApi.listIdeas());
      setErr(null);
    } catch (e) {
      setErr(String((e as Error).message || e));
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function createIdea() {
    const title = (prompt("点子标题？") || "").trim();
    if (!title) return;
    try {
      const { id } = await ideasApi.createIdea(title);
      await reload();
      setSel({ kind: "idea", iid: id });
    } catch (e) {
      alert("新建失败：" + String((e as Error).message || e));
    }
  }

  async function deleteIdea(iid: string) {
    if (!confirm("删除这个点子？所有对话和历史都会删掉。")) return;
    try {
      await ideasApi.deleteIdea(iid);
      if ((sel.kind === "idea" || sel.kind === "chat") && sel.iid === iid) {
        setSel({ kind: "none" });
      }
      await reload();
    } catch (e) {
      alert("删除失败：" + String((e as Error).message || e));
    }
  }

  const activeIid = sel.kind !== "none" ? sel.iid : null;

  return (
    <div className="h-screen flex flex-col bg-notion-soft">
      <header className="shrink-0 h-12 px-5 flex items-center bg-notion-bg border-b border-notion-border">
        <h1 className="text-[15px] font-semibold text-notion-text" style={{ letterSpacing: "-0.01em" }}>
          点子库
        </h1>
        <span className="ml-3 text-[12px] text-notion-text3">
          每个点子一份会演化的文档，下挂多场对话，聊到关键处一键整理
        </span>
      </header>

      {err && (
        <div className="bg-red-50 text-red-800 px-4 py-2 text-[13px] border-b border-red-100">
          后端未连通：{err}
        </div>
      )}

      <main className="flex-1 flex overflow-hidden min-h-0">
        <IdeasSidebar
          ideas={ideas}
          activeIid={activeIid}
          onSelect={(iid) => setSel({ kind: "idea", iid })}
          onNew={createIdea}
          onDelete={deleteIdea}
        />
        <section className="w-[380px] shrink-0 border-r border-notion-border bg-notion-bg overflow-hidden flex flex-col">
          {sel.kind === "none" ? (
            <EmptyDetail />
          ) : (
            <IdeaDetail
              key={`${sel.iid}-${detailRev}`}
              iid={sel.iid}
              activeCid={sel.kind === "chat" ? sel.cid : null}
              onOpenChat={(cid) => setSel({ kind: "chat", iid: sel.iid, cid })}
              onConvCreated={(cid) => setSel({ kind: "chat", iid: sel.iid, cid })}
              onConvDeleted={(cid) => {
                if (sel.kind === "chat" && sel.cid === cid) {
                  setSel({ kind: "idea", iid: sel.iid });
                }
              }}
              onDocUpdated={() => reload()}
            />
          )}
        </section>
        <section className="flex-1 min-w-0 overflow-hidden bg-notion-bg">
          {sel.kind === "chat" ? (
            <ConversationView
              key={sel.cid}
              iid={sel.iid}
              cid={sel.cid}
              onDistilled={() => { setDetailRev((r) => r + 1); reload(); }}
              onTitleChange={() => setDetailRev((r) => r + 1)}
            />
          ) : (
            <EmptyChat hasIdea={sel.kind === "idea"} />
          )}
        </section>
      </main>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="h-full grid place-items-center text-notion-text3 text-[13.5px] px-6 text-center leading-relaxed">
      在左边选一个点子，
      <br />
      或点 + 新建一个。
    </div>
  );
}

function EmptyChat({ hasIdea }: { hasIdea: boolean }) {
  return (
    <div className="h-full grid place-items-center text-notion-text3 text-[13.5px] px-8 text-center leading-relaxed">
      {hasIdea
        ? "选一段对话继续聊，或新建一段。"
        : "选个点子开始。"}
    </div>
  );
}
