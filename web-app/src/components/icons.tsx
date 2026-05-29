import type { SVGProps, ReactNode } from "react";

interface IcoProps extends Omit<SVGProps<SVGSVGElement>, "children" | "d" | "stroke"> {
  size?: number;
  stroke?: number;
  d: ReactNode;
  fill?: string;
}

const Ico = ({ d, size = 16, stroke = 1.7, fill = "none", className = "", ...rest }: IcoProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} stroke="currentColor"
       strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden {...rest}>{d}</svg>
);

export const IcoSearch    = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>} />;
export const IcoStar      = ({ filled = false, ...p }: Omit<IcoProps, "d"> & { filled?: boolean }) =>
  <Ico {...p} fill={filled ? "currentColor" : "none"} d={<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>} />;
export const IcoPin       = ({ filled = false, ...p }: Omit<IcoProps, "d"> & { filled?: boolean }) =>
  <Ico {...p} fill={filled ? "currentColor" : "none"} d={<><path d="M12 17v5"/><path d="M9 10.76V6h6v4.76a2 2 0 0 0 .59 1.41L18 14.59V17H6v-2.41l2.41-2.42A2 2 0 0 0 9 10.76z"/></>} />;
export const IcoMessage   = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>} />;
export const IcoSparkles  = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<path d="M12 3l1.9 4.6L18 9.5l-4.1 1.9L12 16l-1.9-4.6L6 9.5l4.1-1.9L12 3z"/>} />;
export const IcoExternal  = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></>} />;
export const IcoSend      = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>} />;
export const IcoArrowL    = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>} />;
export const IcoMore      = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="6" cy="12" r="1.4" fill="currentColor"/><circle cx="18" cy="12" r="1.4" fill="currentColor"/></>} />;
export const IcoChevDown  = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<polyline points="6 9 12 15 18 9"/>} />;
export const IcoX         = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} />;
export const IcoLink      = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 1 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 1 0 7 7l1.5-1.5"/></>} />;
export const IcoCal       = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>} />;
export const IcoBolt      = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>} />;
export const IcoSwap      = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>} />;
export const IcoCoin      = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><circle cx="12" cy="12" r="9"/><path d="M9 11h4a2 2 0 0 0 0-4h-2v10h2.5a2.5 2.5 0 0 0 0-5"/></>} />;
export const IcoChart     = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><line x1="3" y1="20" x2="21" y2="20"/><line x1="3" y1="20" x2="3" y2="4"/><polyline points="6 16 10 12 13 15 21 7"/></>} />;
export const IcoTag       = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><path d="M20.59 13.41l-7.18 7.17a2 2 0 0 1-2.83 0l-7.17-7.17V5h8.41l8.77 8.41z"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor"/></>} />;
export const IcoNote      = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></>} />;
export const IcoSort      = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><line x1="3" y1="6" x2="13" y2="6"/><line x1="3" y1="12" x2="11" y2="12"/><line x1="3" y1="18" x2="9" y2="18"/><polyline points="15 9 18 6 21 9"/><line x1="18" y1="6" x2="18" y2="20"/></>} />;
export const IcoLayers    = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>} />;
export const IcoMic       = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></>} />;
export const IcoStopSquare = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>} />;
export const IcoSettings  = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>} />;
export const IcoCheck     = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<polyline points="20 6 9 17 4 12"/>} />;
export const IcoUndo      = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></>} />;
export const IcoFolder    = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>} />;
export const IcoUser      = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>} />;
export const IcoChevR     = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<polyline points="9 18 15 12 9 6"/>} />;
export const IcoPlus      = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>} />;
export const IcoAlert     = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>} />;
export const IcoTrash     = (p: Omit<IcoProps, "d">) => <Ico {...p} d={<><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></>} />;
