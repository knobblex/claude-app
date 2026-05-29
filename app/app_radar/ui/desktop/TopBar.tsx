import { SegBtn } from "@/components/atoms";
import { IcoSearch } from "@/components/icons";

export type View = "list-all" | "list-fav" | "detail" | "chat" | "ideas";

export function TopBar({
  view,
  setView,
  search,
  setSearch,
}: {
  view: View;
  setView: (v: View) => void;
  search: string;
  setSearch: (s: string) => void;
}) {
  return (
    <header className="h-12 bg-notion-bg border-b border-notion-border flex items-center px-4 gap-3 shrink-0">
      <div className="flex items-center gap-2 min-w-0 pl-1">
        <span className="text-[18px]">📡</span>
        <span className="text-[15.5px] font-semibold tracking-tight text-notion-text truncate">
          Hot App Radar
        </span>
        <span className="text-[13px] text-notion-text3 hidden md:inline ml-1">/ 个人点子库</span>
      </div>

      <div className="flex-1 flex items-center justify-center max-w-[520px] mx-auto">
        <div className="relative w-full max-w-[400px]">
          <IcoSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-notion-text3" />
          <input
            type="search"
            placeholder="按名称 / 标签搜索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-8 pr-14 pl-9 text-[14px] bg-[rgba(55,53,47,0.04)] hover:bg-[rgba(55,53,47,0.06)] border border-transparent rounded-md text-notion-text placeholder:text-notion-text3 focus:bg-white focus:border-notion-border"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
            <kbd className="notion-kbd">⌘</kbd>
            <kbd className="notion-kbd">K</kbd>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <div className="flex items-center gap-0.5 p-0.5 bg-[rgba(55,53,47,0.06)] rounded-md">
          <SegBtn active={view === "list-all"} onClick={() => setView("list-all")}>列表</SegBtn>
          <SegBtn active={view === "list-fav"} onClick={() => setView("list-fav")}>收藏</SegBtn>
          <SegBtn active={view === "ideas"} onClick={() => setView("ideas")}>💡 点子</SegBtn>
          <SegBtn active={view === "detail"} onClick={() => setView("detail")}>详情</SegBtn>
          <SegBtn active={view === "chat"} onClick={() => setView("chat")}>聊天</SegBtn>
        </div>
        <div className="w-8 h-8 rounded-full bg-orange-200 text-orange-800 grid place-items-center text-[13px] font-semibold">
          T
        </div>
      </div>
    </header>
  );
}
