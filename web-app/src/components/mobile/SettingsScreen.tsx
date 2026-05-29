import { useAutoPolish } from "@/lib/settings";
import { getAuthUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { MobileHeader } from "./MobileHeader";
import { IOSToggle } from "../atoms";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5">
      <div
        className="text-[11px] uppercase text-notion-text3 font-semibold px-1 pt-2 pb-2"
        style={{ letterSpacing: "0.08em" }}
      >
        {title}
      </div>
      <div className="bg-notion-bg border border-notion-border rounded-[14px] overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function Row({
  label,
  desc,
  right,
  onClick,
  destructive,
}: {
  label: string;
  desc?: string;
  right?: React.ReactNode;
  onClick?: () => void;
  destructive?: boolean;
}) {
  const Tag: "button" | "div" = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "w-full text-left flex items-center gap-3 px-4 py-3.5 border-b border-notion-divider last:border-b-0",
        onClick && "active:bg-notion-active",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className={cn("text-[14.5px] leading-[1.3]", destructive ? "text-red-600" : "text-notion-text")}>{label}</div>
        {desc && <div className="text-[12.5px] text-notion-text2 mt-[3px] leading-snug">{desc}</div>}
      </div>
      {right}
    </Tag>
  );
}

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [autoPolish, setAutoPolish] = useAutoPolish();

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-notion-soft">
      <MobileHeader title="设置" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-3.5 pt-3.5 pb-6">
        <Section title="语音输入">
          <Row
            label="录音转写后自动整理"
            desc="用 Claude 把口语顺成更通顺的书面语，多 2-4 秒"
            right={<IOSToggle on={autoPolish} onChange={setAutoPolish} ariaLabel="录音转写后自动整理" />}
          />
          <Row
            label="默认语言"
            right={
              <>
                <span className="text-[13.5px] text-notion-text2">中文（普通话）</span>
                <span className="text-notion-text3 text-[18px] ml-1">›</span>
              </>
            }
          />
        </Section>

        <Section title="外观">
          <Row
            label="主题"
            right={
              <>
                <span className="text-[13.5px] text-notion-text2">跟随系统</span>
                <span className="text-notion-text3 text-[18px] ml-1">›</span>
              </>
            }
          />
          <Row
            label="字号"
            right={
              <>
                <span className="text-[13.5px] text-notion-text2">中</span>
                <span className="text-notion-text3 text-[18px] ml-1">›</span>
              </>
            }
          />
        </Section>

        <Section title="账号">
          <Row label="登录账号" right={<span className="text-[13.5px] text-notion-text2">{getAuthUser() ?? "—"}</span>} />
          <Row label="退出登录" destructive />
        </Section>
      </div>
    </div>
  );
}
