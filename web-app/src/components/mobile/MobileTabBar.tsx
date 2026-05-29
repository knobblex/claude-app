import { cn } from "@/lib/utils";
import { IcoMessage, IcoFolder, IcoUser } from "../icons";

export type MobileTab = "chats" | "projects" | "me";

const TABS: { key: MobileTab; label: string; icon: typeof IcoMessage }[] = [
  { key: "chats", label: "对话", icon: IcoMessage },
  { key: "projects", label: "项目", icon: IcoFolder },
  { key: "me", label: "我", icon: IcoUser },
];

/**
 * Bottom tab bar (mockup-v1.html screens 1, 2, 6).
 * Spec: 64px tall total (incl. 8px bottom safe-area padding); icon 22px;
 * label 11px; active = text1 + weight 600, idle = text3.
 */
export function MobileTabBar({
  active,
  onChange,
}: {
  active: MobileTab;
  onChange: (t: MobileTab) => void;
}) {
  return (
    <nav
      className="shrink-0 border-t border-notion-divider bg-notion-bg"
      style={{ paddingBottom: "calc(8px + env(safe-area-inset-bottom))" }}
    >
      <div className="h-14 flex items-stretch">
        {TABS.map(({ key, label, icon: Icon }) => {
          const isActive = active === key;
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-[3px] text-[11px]",
                "active:bg-notion-active transition-colors",
                isActive ? "text-notion-text font-semibold" : "text-notion-text3",
              )}
            >
              <Icon size={22} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
