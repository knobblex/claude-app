type FeatureItem = {
  emoji: string;
  title: string;
  desc: string;
  onClick?: () => void;
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] tracking-[0.08em] uppercase text-notion-text3 font-semibold px-2 pt-3 pb-2">
      {children}
    </div>
  );
}

function Card({ item, badge }: { item: FeatureItem; badge?: string }) {
  const clickable = !!item.onClick;
  return (
    <button
      onClick={item.onClick}
      disabled={!clickable}
      className="w-full text-left bg-notion-bg border border-notion-border rounded-[14px] p-4 flex gap-3 items-center mb-2 active:bg-notion-hover disabled:opacity-60 disabled:active:bg-notion-bg"
    >
      <div className="w-[38px] h-[38px] rounded-[10px] bg-notion-soft grid place-items-center text-[20px] shrink-0">
        {item.emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold text-notion-text">{item.title}</div>
        <div className="text-[12.5px] text-notion-text3 mt-0.5">{item.desc}</div>
      </div>
      {badge ? (
        <span className="text-[10.5px] text-notion-text3 bg-notion-soft px-2 py-1 rounded shrink-0">{badge}</span>
      ) : clickable ? (
        <span className="text-notion-text3 text-[18px] shrink-0">›</span>
      ) : null}
    </button>
  );
}

export function MoreScreen({
  onOpenRadar,
  onOpenSettings,
}: {
  onOpenRadar: () => void;
  onOpenSettings: () => void;
}) {
  const ready: FeatureItem[] = [
    {
      emoji: "📡",
      title: "Hot App Radar",
      desc: "浏览每日扫描的 app/game 卷宗",
      onClick: onOpenRadar,
    },
    {
      emoji: "⚙️",
      title: "设置",
      desc: "语音整理、主题、账号",
      onClick: onOpenSettings,
    },
  ];
  const planned: FeatureItem[] = [
    { emoji: "📊", title: "每日报告", desc: "扫描摘要 / 趋势分析" },
    { emoji: "💡", title: "我的点子", desc: "distill 出的笔记汇总" },
    { emoji: "🎮", title: "Games 频道", desc: "游戏雷达专属视图" },
  ];

  return (
    <section className="flex-1 min-h-0 overflow-y-auto bg-notion-soft px-3 pb-6">
      <SectionTitle>已接入</SectionTitle>
      {ready.map((item) => (
        <Card key={item.title} item={item} />
      ))}
      <SectionTitle>即将推出</SectionTitle>
      {planned.map((item) => (
        <Card key={item.title} item={item} badge="规划中" />
      ))}
    </section>
  );
}
