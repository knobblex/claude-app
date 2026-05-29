import type { ReactNode } from "react";
import { IcoArrowL } from "../icons";

/**
 * Mobile top bar (mockup-v1.html screens 3, 4, 12 etc.).
 * - 48px tall (h-12)
 * - With back: title 15.5px, centered, right-padded 28px
 * - Without back: title 17px / weight 700 / -0.01em (screens 1, 2, 6)
 */
export function MobileHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <header
      className="shrink-0 bg-notion-bg border-b border-notion-border"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="h-12 flex items-center pl-4 pr-3">
        {onBack ? (
          <>
            <button
              onClick={onBack}
              aria-label="返回"
              className="-ml-2 h-9 w-9 grid place-items-center rounded text-notion-text2 active:bg-notion-active"
            >
              <IcoArrowL size={18} />
            </button>
            <h1
              className="flex-1 text-center text-[15.5px] font-semibold text-notion-text truncate pr-7"
              style={{ letterSpacing: "-0.01em" }}
            >
              {title}
            </h1>
            {right}
          </>
        ) : (
          <>
            <h1
              className="flex-1 text-[17px] font-bold text-notion-text truncate"
              style={{ letterSpacing: "-0.01em" }}
            >
              {title}
            </h1>
            {right}
          </>
        )}
      </div>
    </header>
  );
}
