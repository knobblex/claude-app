import type { ComponentType } from "react";
import type { ChatTarget } from "@/lib/api";

export type Manifest = {
  id: string;
  name: string;
  icon: string;
  version: number;
  backend: {
    module: string;
    prefix: string;
    data_dirs: Record<string, string>;
  };
  frontend: {
    entry: string;
    mobile: { openFrom: "projects"; label: string };
    desktop: { section: "projects"; label: string };
  };
};

export type MobileEntryProps = {
  onBack: () => void;
  // Ask the shell to open the universal chat view targeting this conversation.
  // Sub-apps use this after creating a bare conversation (typically with a
  // `context` binding) so their own data context drives the system prompt
  // while reusing the shell's full chat UI (streaming, voice, live hub, ...).
  onOpenChat: (target: ChatTarget) => void;
};

export type SubApp = {
  manifest: Manifest;
  Mobile: ComponentType<MobileEntryProps>;
  Desktop: ComponentType;
};
