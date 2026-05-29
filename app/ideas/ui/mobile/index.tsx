import { useCallback, useEffect, useState } from "react";
import { ideasApi, type IdeaSummary } from "../api";
import { IdeasListScreen } from "./IdeasListScreen";
import { IdeaDetailScreen } from "./IdeaDetailScreen";
import { ConversationScreen } from "./ConversationScreen";

type View =
  | { kind: "list" }
  | { kind: "idea"; iid: string }
  | { kind: "chat"; iid: string; cid: string };

export default function MobileIdeas({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<View>({ kind: "list" });
  const [ideas, setIdeas] = useState<IdeaSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
      setView({ kind: "idea", iid: id });
    } catch (e) {
      alert("新建失败：" + String((e as Error).message || e));
    }
  }

  async function deleteIdea(iid: string) {
    if (!confirm("删除这个点子？所有对话和历史都会删掉。")) return;
    try {
      await ideasApi.deleteIdea(iid);
      await reload();
    } catch (e) {
      alert("删除失败：" + String((e as Error).message || e));
    }
  }

  if (view.kind === "chat") {
    return (
      <ConversationScreen
        iid={view.iid}
        cid={view.cid}
        onBack={() => setView({ kind: "idea", iid: view.iid })}
      />
    );
  }
  if (view.kind === "idea") {
    return (
      <IdeaDetailScreen
        iid={view.iid}
        onBack={() => { setView({ kind: "list" }); reload(); }}
        onOpenChat={(cid) => setView({ kind: "chat", iid: view.iid, cid })}
      />
    );
  }
  return (
    <IdeasListScreen
      ideas={ideas}
      err={err}
      onBack={onBack}
      onOpenIdea={(iid) => setView({ kind: "idea", iid })}
      onNew={createIdea}
      onDelete={deleteIdea}
    />
  );
}
