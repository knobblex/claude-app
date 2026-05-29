import { useState, type ReactNode } from "react";
import { api, type ChatTarget } from "@/lib/api";
import { MobileTabBar, type MobileTab } from "@/components/mobile/MobileTabBar";
import { ChatListScreen } from "@/components/mobile/ChatListScreen";
import { ChatScreen } from "@/components/mobile/ChatScreen";
import { ProjectsScreen } from "@/components/mobile/ProjectsScreen";
import { MeScreen } from "@/components/mobile/MeScreen";
import { SettingsScreen } from "@/components/mobile/SettingsScreen";
import { IcoPlus } from "@/components/icons";
import { subAppById } from "@/sub-apps/registry";

type Screen =
  | { kind: "tab" }
  | { kind: "chat"; target: ChatTarget }
  | { kind: "sub-app"; id: string }
  | { kind: "settings" };

// Use --app-h CSS var (set in index.css) so the wrapper height accounts for
// iOS PWA standalone quirks + keyboard state.
const ROOT_STYLE = { height: "var(--app-h, 100dvh)" } as const;

function TabHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header
      className="shrink-0 bg-notion-bg border-b border-notion-border"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="h-12 flex items-center px-4">
        <h1 className="text-[17px] font-semibold text-notion-text flex-1">{title}</h1>
        {right}
      </div>
    </header>
  );
}

export default function MobileApp() {
  const [tab, setTab] = useState<MobileTab>("chats");
  const [screen, setScreen] = useState<Screen>({ kind: "tab" });
  const [creating, setCreating] = useState(false);

  async function newFreeChat() {
    if (creating) return;
    setCreating(true);
    try {
      const c = await api.createConversation();
      setScreen({ kind: "chat", target: { kind: "conv", id: c.id } });
    } catch (e) {
      alert("新建对话失败：" + (e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function newFromProject() {
    setTab("projects");
  }

  // sub-screens (not the tab root)
  if (screen.kind === "chat") {
    return (
      <div className="flex flex-col bg-notion-soft" style={ROOT_STYLE}>
        <ChatScreen target={screen.target} onBack={() => setScreen({ kind: "tab" })} />
      </div>
    );
  }
  if (screen.kind === "sub-app") {
    const sub = subAppById[screen.id];
    if (!sub) {
      // Sub-app vanished between selection and render — bail back to tabs.
      setScreen({ kind: "tab" });
      return null;
    }
    const Mobile = sub.Mobile;
    return (
      <div className="flex flex-col bg-notion-soft" style={ROOT_STYLE}>
        <Mobile
          onBack={() => setScreen({ kind: "tab" })}
          onOpenChat={(target) => setScreen({ kind: "chat", target })}
        />
      </div>
    );
  }
  if (screen.kind === "settings") {
    return (
      <div className="flex flex-col bg-notion-soft" style={ROOT_STYLE}>
        <SettingsScreen onBack={() => setScreen({ kind: "tab" })} />
      </div>
    );
  }

  // tab root
  return (
    <div className="flex flex-col bg-notion-soft" style={ROOT_STYLE}>
      {tab === "chats" && (
        <>
          <TabHeader
            title="对话"
            right={
              <button
                onClick={newFreeChat}
                disabled={creating}
                aria-label="新对话"
                className="h-9 w-9 grid place-items-center rounded-md text-notion-text2 active:bg-notion-active disabled:opacity-50"
              >
                <IcoPlus size={22} />
              </button>
            }
          />
          <ChatListScreen
            onOpen={(target) => setScreen({ kind: "chat", target })}
            onNewFree={newFreeChat}
            onNewFromProject={newFromProject}
          />
        </>
      )}

      {tab === "projects" && (
        <>
          <TabHeader title="项目" />
          <ProjectsScreen onOpenSubApp={(id) => setScreen({ kind: "sub-app", id })} />
        </>
      )}

      {tab === "me" && (
        <>
          <TabHeader title="我" />
          <MeScreen onOpenSettings={() => setScreen({ kind: "settings" })} />
        </>
      )}

      <MobileTabBar active={tab} onChange={setTab} />
    </div>
  );
}
