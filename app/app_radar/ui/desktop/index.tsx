import { useCallback, useEffect, useMemo, useState } from "react";
import { radarApi, type AppDetail, type AppListItem } from "../api";
import { TopBar, type View } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { EmptyState } from "@/components/EmptyState";
import { Detail } from "./Detail";
import { ChatDrawer } from "@/components/ChatDrawer";
import { IdeasView } from "./IdeasView";

export default function DesktopRadar() {
  const [view, setView] = useState<View>("list-all");
  const [search, setSearch] = useState("");
  const [apps, setApps] = useState<AppListItem[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<AppDetail | null>(null);
  const [chatCounts, setChatCounts] = useState<Record<string, number>>({});
  // slug -> bare-conversation UUID, resolved lazily when the chat drawer
  // opens. ChatDrawer needs a UUID cid to hit /api/conversations/<id>/stream.
  const [chatCidBySlug, setChatCidBySlug] = useState<Record<string, string>>({});

  const reloadApps = useCallback(async () => {
    try {
      const list = await radarApi.listApps();
      setApps(list);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(String((e as Error).message || e));
    }
  }, []);

  useEffect(() => { reloadApps(); }, [reloadApps]);

  useEffect(() => {
    if (!selectedSlug) { setDetail(null); return; }
    let cancelled = false;
    radarApi.getApp(selectedSlug).then((d) => { if (!cancelled) setDetail(d); }).catch(console.error);
    radarApi.getChat(selectedSlug)
      .then((m) => { if (!cancelled) setChatCounts((c) => ({ ...c, [selectedSlug]: m.length })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedSlug]);

  useEffect(() => {
    if (apps && apps.length > 0 && !selectedSlug) {
      setSelectedSlug(apps[0].slug);
    }
  }, [apps, selectedSlug]);

  const filter = view === "list-fav" ? "fav" : "all";
  const visibleApps = useMemo(() => {
    if (!apps) return [];
    let list = filter === "fav" ? apps.filter((a) => a.is_favorite) : apps;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((a) => {
        const fm = a.frontmatter;
        const bag = [
          fm.name || "",
          ...(fm.tags || []),
          ...(a.tags_user || []),
          a.note_user || "",
          fm.source || "",
        ].join(" ").toLowerCase();
        return bag.includes(q);
      });
    }
    return list;
  }, [apps, filter, search]);

  async function toggleStar(slug: string) {
    const app = apps?.find((a) => a.slug === slug);
    if (!app) return;
    try {
      await radarApi.setFavorite(slug, { favorited: !app.is_favorite });
      await reloadApps();
      if (detail && detail.slug === slug) {
        const d = await radarApi.getApp(slug);
        setDetail(d);
      }
    } catch (e) {
      console.error("toggle star failed", e);
    }
  }

  async function refreshSelected() {
    if (!selectedSlug) return;
    await reloadApps();
    const d = await radarApi.getApp(selectedSlug);
    setDetail(d);
  }

  function selectApp(slug: string) {
    setSelectedSlug(slug);
    if (view === "list-all" || view === "list-fav") setView("detail");
  }

  useEffect(() => {
    if (view === "list-all" || view === "list-fav") {
      // keep selectedSlug, just don't render detail
    } else if (!selectedSlug && apps && apps.length) {
      setSelectedSlug(apps[0].slug);
    }
  }, [view, apps, selectedSlug]);

  const isList = view === "list-all" || view === "list-fav";
  const isIdeas = view === "ideas";
  const showDrawer = view === "chat";
  const totalCount = apps?.length || 0;

  // Resolve the cid for the current chat target. Runs only when the drawer is
  // about to render and we haven't cached the cid yet — backend dedupes so
  // racing tabs/devices converge on the same UUID.
  useEffect(() => {
    if (!showDrawer || !detail) return;
    if (chatCidBySlug[detail.slug]) return;
    const slug = detail.slug;
    let cancelled = false;
    radarApi.getOrCreateConversation(slug)
      .then((r) => { if (!cancelled) setChatCidBySlug((m) => ({ ...m, [slug]: r.id })); })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [showDrawer, detail, chatCidBySlug]);

  function openAppFromIdea(slug: string) {
    setSelectedSlug(slug);
    setView("detail");
  }

  return (
    <div className="h-screen flex flex-col bg-notion-soft">
      <TopBar view={view} setView={setView} search={search} setSearch={setSearch} />

      {loadErr && (
        <div className="bg-red-50 text-red-800 px-4 py-2 text-[13px] border-b border-red-100">
          后端未连通：{loadErr} ｜ 请确认 <code>python3 web/server.py</code> 已运行。
        </div>
      )}

      <main className="flex-1 flex overflow-hidden min-h-0">
        {apps === null && !loadErr ? (
          <div className="flex-1 grid place-items-center text-notion-text3 text-[13px]">加载中…</div>
        ) : (
          <>
            <Sidebar
              apps={visibleApps}
              selectedSlug={isList || isIdeas ? null : selectedSlug}
              onSelect={selectApp}
              onStar={toggleStar}
              totalCount={totalCount}
            />
            {isIdeas ? (
              <IdeasView onOpenApp={openAppFromIdea} />
            ) : isList || !detail ? (
              <section className="flex-1 min-w-0 overflow-hidden">
                <EmptyState />
              </section>
            ) : (
              <Detail
                key={detail.slug}
                app={detail}
                onBack={() => setView("list-all")}
                onToggleFav={async () => { await toggleStar(detail.slug); }}
                onRefresh={refreshSelected}
                showChat={showDrawer}
                onToggleChat={() => setView(showDrawer ? "detail" : "chat")}
                chatCount={chatCounts[detail.slug] || 0}
              />
            )}
            {showDrawer && detail && chatCidBySlug[detail.slug] && (
              <ChatDrawer
                target={{ kind: "conv", id: chatCidBySlug[detail.slug] }}
                onClose={() => setView("detail")}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
