import type { SubApp } from "./types";

// Vite scans this glob at build time. `@sub-apps` resolves to hot_app/ (see
// vite.config.ts), and sub-apps live under hot_app/app/<id>/. Each sub-app's
// default export must satisfy { manifest, Mobile, Desktop }.
const modules = import.meta.glob<{ default: SubApp }>(
  "@sub-apps/app/*/ui/index.ts",
  { eager: true }
);

export const subApps: SubApp[] = Object.values(modules).map((m) => m.default);

export const subAppById: Record<string, SubApp> = Object.fromEntries(
  subApps.map((s) => [s.manifest.id, s])
);
