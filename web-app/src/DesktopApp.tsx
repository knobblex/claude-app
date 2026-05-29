import { useState } from "react";
import { subApps } from "@/sub-apps/registry";

// Desktop shell: thin chrome that mounts one sub-app at a time.
// If only one sub-app is registered, mount it directly (no picker chrome).
// If multiple, show a minimal sidebar to switch — but until that day comes
// the single-sub-app branch is the only realistic path.

export default function DesktopApp() {
  const [activeId, setActiveId] = useState<string>(
    subApps[0]?.manifest.id ?? ""
  );

  if (subApps.length === 0) {
    return (
      <div className="h-screen grid place-items-center text-notion-text3 text-[14px]">
        没有可挂载的 sub-app。把项目放在 hot_app/&lt;id&gt;/ 并提供 manifest.json + ui/index.ts。
      </div>
    );
  }

  const active = subApps.find((s) => s.manifest.id === activeId) ?? subApps[0];

  if (subApps.length === 1) {
    return <active.Desktop />;
  }

  return (
    <div className="h-screen flex bg-notion-soft">
      <aside className="w-44 shrink-0 border-r border-notion-border bg-notion-bg flex flex-col">
        <div className="px-3 py-3 text-[11px] uppercase tracking-wider text-notion-text3 font-semibold">
          项目
        </div>
        {subApps.map((s) => (
          <button
            key={s.manifest.id}
            onClick={() => setActiveId(s.manifest.id)}
            className={
              "text-left px-3 py-2 text-[14px] " +
              (s.manifest.id === active.manifest.id
                ? "bg-notion-active text-notion-text font-medium"
                : "text-notion-text2 hover:bg-notion-hover")
            }
          >
            {s.manifest.frontend.desktop.label}
          </button>
        ))}
      </aside>
      <div className="flex-1 min-w-0">
        <active.Desktop />
      </div>
    </div>
  );
}
