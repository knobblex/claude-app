import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const sourceShort: Record<string, "PH" | "AS-US" | "AS-CN" | "AS-JP"> = {
  producthunt: "PH",
  "appstore-us": "AS-US",
  "appstore-cn": "AS-CN",
  "appstore-jp": "AS-JP",
};
export const sourceLabel: Record<string, string> = {
  producthunt: "Product Hunt",
  "appstore-us": "App Store · 美",
  "appstore-cn": "App Store · 中",
  "appstore-jp": "App Store · 日",
};
export const sourceDot: Record<string, string> = {
  producthunt: "dot-orange",
  "appstore-us": "dot-blue",
  "appstore-cn": "dot-red",
  "appstore-jp": "dot-pink",
};
export function shortSource(src?: string) {
  return src ? sourceShort[src] ?? "?" : "?";
}
export function fullSource(src?: string) {
  return src ? sourceLabel[src] ?? src : "?";
}

export function num(x: unknown, fallback = 0): number {
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const n = parseFloat(x);
    return isNaN(n) ? fallback : n;
  }
  return fallback;
}

export function pillForScore(score: number): { pill: string; dot: string } {
  if (score >= 5) return { pill: "green", dot: "dot-green" };
  if (score >= 4) return { pill: "blue", dot: "dot-blue" };
  if (score >= 3) return { pill: "yellow", dot: "dot-yellow" };
  return { pill: "gray", dot: "dot-gray" };
}

const EMOJI_BY_TAG: Record<string, string> = {
  AI: "🤖", "Developer Tools": "🛠", Productivity: "📋", Video: "🎬",
  Social: "💬", "神经多样性": "🧠", 摄影: "📷", KOL: "📷",
  直播电商: "📺", 会议: "🎙️", 硬件: "⌨️", 生活游戏化: "🎲",
  健康: "❤️", "Idea 验证": "💡", 社交: "📍", 线下: "📍",
  理财: "💴", 订阅: "💴", 音乐: "🎵", 体育: "🏃", 出行: "🛂",
  预测市场: "📈", 旅行: "🗺", 游戏化: "🎲", 创作者工具: "✍️",
  家庭: "🏠", "Apple Watch": "⌚", 工具党: "⚙️", 实体: "🏪",
};
const EMOJI_BY_SLUG_PREFIX: Record<string, string> = {
  "us-": "🇺🇸", "cn-": "🇨🇳", "jp-": "🇯🇵",
};

export function deriveEmoji(slug: string, tags: string[] = [], name = ""): string {
  // Special case slugs
  const slugLower = slug.toLowerCase();
  if (slugLower.includes("plurai")) return "📡";
  if (slugLower.includes("fog")) return "🗺";
  if (slugLower.includes("sanpogami")) return "🚶";
  if (slugLower.includes("skylight")) return "📅";
  if (slugLower.includes("kalshi")) return "📈";
  if (slugLower.includes("chocozap")) return "🏋️";
  if (slugLower.includes("workoutdoors")) return "⌚";
  if (slugLower.includes("genko") || slugLower.includes("planner")) return "✍️";

  for (const t of tags) {
    if (EMOJI_BY_TAG[t]) return EMOJI_BY_TAG[t];
  }
  for (const [prefix, emoji] of Object.entries(EMOJI_BY_SLUG_PREFIX)) {
    if (slugLower.startsWith(prefix)) return emoji;
  }
  if (name && /[一-龥]/.test(name)) return "📱";
  return "📦";
}

export function relativeDate(dateStr?: string): string {
  if (!dateStr) return "";
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - then.getTime()) / 86400000);
  if (days < 0) return dateStr.slice(0, 10);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  if (days < 365) return `${Math.floor(days / 30)} 月前`;
  return dateStr.slice(0, 10);
}

export function extractTagline(body: string): string {
  // First blockquote after title (matches `> ...` or `> ...\n> ...`)
  const m = body.match(/^>\s*(.+?)(?=\n\n|\n##|$)/sm);
  if (!m) return "";
  return m[1].replace(/\n>\s*/g, " ").trim();
}
