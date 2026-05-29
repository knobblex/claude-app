import { subApps } from "@/sub-apps/registry";
import { IcoChevR } from "../icons";

// "项目" tab: list every registered sub-app. Tapping one opens that sub-app's
// mobile entry (registry-driven; no hardcoded knowledge of any specific app).

const placeholders = [
  { em: "📅", name: "我的 OKR",    desc: "季度目标 + 周回顾，跟 Claude 拆解" },
  { em: "📖", name: "读书笔记",    desc: "书摘 + 联想，按主题串联" },
  { em: "💡", name: "独立项目库",  desc: "idea pipeline + 实验记录" },
];

export function ProjectsScreen({ onOpenSubApp }: { onOpenSubApp: (id: string) => void }) {
  const projectSubApps = subApps.filter(
    (s) => s.manifest.frontend.mobile.openFrom === "projects"
  );

  return (
    <section className="flex-1 min-h-0 overflow-y-auto bg-notion-soft">
      <SectionTitle>已接入</SectionTitle>
      <div className="px-4 flex flex-col gap-2">
        {projectSubApps.map((s) => (
          <button
            key={s.manifest.id}
            onClick={() => onOpenSubApp(s.manifest.id)}
            className="w-full text-left flex items-center gap-3 px-4 py-3.5 bg-notion-bg border border-notion-border rounded-[14px] active:bg-notion-hover"
          >
            <span className="w-[38px] h-[38px] rounded-[10px] bg-notion-soft grid place-items-center text-[20px] shrink-0">
              📡
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold text-notion-text">{s.manifest.name}</div>
              <div className="text-[12.5px] text-notion-text2 mt-0.5 truncate">
                {s.manifest.frontend.mobile.label}
              </div>
            </div>
            <IcoChevR size={18} className="text-notion-text3 shrink-0" />
          </button>
        ))}
      </div>

      <SectionTitle className="mt-5">即将推出</SectionTitle>
      <div className="px-4 pb-6 flex flex-col gap-2">
        {placeholders.map((p) => (
          <div
            key={p.name}
            className="flex items-center gap-3 px-4 py-3.5 bg-notion-bg border border-notion-border rounded-[14px] opacity-60"
          >
            <span className="w-[38px] h-[38px] rounded-[10px] bg-notion-soft grid place-items-center text-[20px] shrink-0">
              {p.em}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold text-notion-text">{p.name}</div>
              <div className="text-[12.5px] text-notion-text2 mt-0.5 truncate">{p.desc}</div>
            </div>
            <span className="text-[10.5px] px-1.5 py-[3px] rounded-md bg-notion-soft text-notion-text3 border border-notion-border shrink-0">
              规划中
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`px-5 pt-4 pb-2 text-[11px] uppercase font-semibold text-notion-text3 ${className}`}
      style={{ letterSpacing: "0.08em" }}
    >
      {children}
    </div>
  );
}
