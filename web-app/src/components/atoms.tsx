import { cn, pillForScore } from "@/lib/utils";
import type { ReactNode } from "react";

type PillColor = "green" | "blue" | "yellow" | "gray" | "pink" | "orange" | "purple" | "red";

export function Pill({ color = "gray", dot = true, dotColor, size = "md", children }: {
  color?: PillColor;
  dot?: boolean;
  dotColor?: string;
  size?: "sm" | "md" | "lg";
  children?: ReactNode;
}) {
  const pad =
    size === "sm" ? "px-1.5 py-0.5 text-[12px]" :
    size === "lg" ? "px-2.5 py-1 text-[14px]" :
    "px-2 py-0.5 text-[13px]";
  const dc = dotColor || `dot-${color}`;
  const dotSize = size === "lg" ? "w-2 h-2" : "w-1.5 h-1.5";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded font-medium", `pill-${color}`, pad)}>
      {dot && <span className={cn("rounded-full", dotSize, dc)} />}
      {children}
    </span>
  );
}

export function ScorePill({ value, display, size = "md" }: {
  value: number;
  display?: string | number;
  size?: "sm" | "md" | "lg";
}) {
  const c = pillForScore(value);
  const txt = display !== undefined ? display : value;
  return (
    <Pill color={c.pill as PillColor} dotColor={c.dot} size={size}>
      <span className="tabular-nums font-semibold">{txt}</span>
    </Pill>
  );
}

export function Bar({ value, max = 5 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  const c = pillForScore(value);
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="relative inline-block w-[96px] h-2 rounded-full overflow-hidden align-middle" style={{ background: "rgba(55,53,47,0.08)" }}>
        <span className={cn("absolute left-0 top-0 bottom-0 transition-[width] duration-300", c.dot)} style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular-nums font-semibold text-[15px]">{value.toFixed(2)}</span>
    </span>
  );
}

export function TagPill({ children, kind = "system", size = "md" }: { children: ReactNode; kind?: "system" | "user"; size?: "sm" | "md" }) {
  const s = size;
  if (kind === "user") return <Pill color="pink" size={s}>#{children}</Pill>;
  return <Pill color="gray" size={s}>{children}</Pill>;
}

export function SegBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-8 px-3 rounded text-[13.5px] font-medium transition-colors",
        active
          ? "bg-white text-notion-text shadow-[0_1px_2px_rgba(15,15,15,0.06),0_0_0_1px_rgba(15,15,15,0.05)]"
          : "text-notion-text2 hover:text-notion-text"
      )}
    >
      {children}
    </button>
  );
}

// ============================================================================
// Mobile design-spec atoms (mockup-v1.html)
// ============================================================================

/**
 * Primary CTA button. Solid dark on white. 40px high, 11px radius.
 */
export function BtnPrimary({
  onClick, disabled, children, className,
}: {
  onClick?: () => void; disabled?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-10 px-[18px] rounded-[11px] inline-flex items-center justify-center gap-1.5",
        "text-[14.5px] font-semibold text-white bg-[#18181b]",
        "active:opacity-85 disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Secondary CTA. White with subtle border.
 */
export function BtnGhost({
  onClick, disabled, children, className,
}: {
  onClick?: () => void; disabled?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-10 px-[18px] rounded-[11px] inline-flex items-center justify-center gap-1.5",
        "text-[14.5px] font-semibold text-notion-text bg-white border border-notion-border2",
        "active:bg-notion-hover disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * iOS-style toggle, 51×31, 27px white slider with soft shadow.
 * Off: gray rail; on: green rail (#34c759).
 */
export function IOSToggle({
  on, onChange, ariaLabel,
}: {
  on: boolean; onChange: (v: boolean) => void; ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-block w-[51px] h-[31px] rounded-full transition-colors duration-200",
        on ? "bg-[#34c759]" : "bg-[#e9e9e7]",
      )}
    >
      <span
        className="absolute top-[2px] w-[27px] h-[27px] rounded-full bg-white transition-[left] duration-200"
        style={{
          left: on ? "22px" : "2px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.04)",
        }}
      />
    </button>
  );
}
