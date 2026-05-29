import { IcoChevR } from "../icons";
import { useUserName } from "@/lib/config";

type Item = {
  emoji: string;
  title: string;
  desc: string;
  onClick?: () => void;
  badge?: string;
};

/**
 * "我" tab + feature card list. Spec: feature card 14×16 padding, rounded-14,
 * bg-white, 38×38 rounded-10 ico bg-soft, title 15/600, desc 12.5/text2.
 * Section title 11/uppercase/0.08em tracking/text3.
 */
export function MeScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const userName = useUserName();
  const accessible: Item[] = [
    {
      emoji: "⚙️",
      title: "设置",
      desc: "语音整理、主题、账号",
      onClick: onOpenSettings,
    },
  ];

  const planned: Item[] = [
    { emoji: "⭐", title: "收藏", desc: "你标过星的卷宗", badge: "规划中" },
    { emoji: "💡", title: "我的点子", desc: "所有项目里 distill 出的笔记汇总", badge: "规划中" },
    { emoji: "👤", title: "账号", desc: "用户信息与同步", badge: "规划中" },
  ];

  return (
    <section className="flex-1 min-h-0 overflow-y-auto bg-notion-soft">
      {/* Profile header */}
      <div className="px-5 pt-4 pb-5 flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-user-soft text-user-deep grid place-items-center text-[18px] font-semibold">
          {userName.slice(0, 1)}
        </div>
        <div>
          <div className="text-[17px] font-bold text-notion-text" style={{ letterSpacing: "-0.01em" }}>{userName}</div>
          <div className="text-[12.5px] text-notion-text3 mt-0.5">本地 · 单用户</div>
        </div>
      </div>

      <SectionTitle>已接入</SectionTitle>
      <div className="px-4 flex flex-col gap-2">
        {accessible.map((it) => (
          <FeatureCard key={it.title} item={it} />
        ))}
      </div>

      <SectionTitle className="mt-5">即将推出</SectionTitle>
      <div className="px-4 pb-6 flex flex-col gap-2">
        {planned.map((it) => (
          <FeatureCard key={it.title} item={it} disabled />
        ))}
      </div>
    </section>
  );
}

function SectionTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`px-5 pt-2 pb-2 text-[11px] uppercase font-semibold text-notion-text3 ${className}`}
      style={{ letterSpacing: "0.08em" }}
    >
      {children}
    </div>
  );
}

function FeatureCard({ item, disabled = false }: { item: Item; disabled?: boolean }) {
  const Wrapper: React.ElementType = item.onClick && !disabled ? "button" : "div";
  return (
    <Wrapper
      onClick={item.onClick}
      className={
        "w-full text-left flex items-center gap-3 px-4 py-3.5 bg-notion-bg border border-notion-border rounded-[14px] " +
        (disabled ? "opacity-60" : "active:bg-notion-hover")
      }
    >
      <span className="w-[38px] h-[38px] rounded-[10px] bg-notion-soft grid place-items-center text-[20px] shrink-0">
        {item.emoji}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold text-notion-text">{item.title}</div>
        <div className="text-[12.5px] text-notion-text2 mt-0.5">{item.desc}</div>
      </div>
      {item.badge ? (
        <span className="text-[10.5px] px-1.5 py-[3px] rounded-md bg-notion-soft text-notion-text3 border border-notion-border shrink-0">
          {item.badge}
        </span>
      ) : (
        <IcoChevR size={18} className="text-notion-text3 shrink-0" />
      )}
    </Wrapper>
  );
}
