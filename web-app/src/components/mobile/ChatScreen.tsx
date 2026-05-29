import { useCallback, useEffect, useState } from "react";
import { api, type ChatTarget } from "@/lib/api";
import { ChatDrawer } from "../ChatDrawer";
import { MobileHeader } from "./MobileHeader";

export function ChatScreen({ target, onBack }: { target: ChatTarget; onBack: () => void }) {
  const [title, setTitle] = useState<string>("新对话");

  const loadTitle = useCallback(async () => {
    try {
      const d = await api.getConversation(target.id);
      setTitle(d.title || "新对话");
    } catch {
      // ignore — title is cosmetic
    }
  }, [target.id]);

  useEffect(() => {
    loadTitle();
  }, [loadTitle]);

  // Title is generated async on the server after the first send. Refetch a
  // moment later so it shows up without manual refresh.
  function onMessagesChanged() {
    setTimeout(loadTitle, 1500);
    setTimeout(loadTitle, 4000);
    setTimeout(loadTitle, 9000);
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-notion-bg">
      <MobileHeader title={title || "对话"} onBack={onBack} />
      <ChatDrawer
        target={target}
        onClose={onBack}
        onMessagesChanged={onMessagesChanged}
        mobile
      />
    </div>
  );
}
