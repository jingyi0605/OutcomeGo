import { APP_SETTINGS_ANCHORS } from "@outcomego/contracts/app-deep-links";

export const SETTINGS_ANCHORS = APP_SETTINGS_ANCHORS;

export type SettingsAnchor = (typeof SETTINGS_ANCHORS)[number];
export type SettingsView =
  | "general"
  | "computer"
  | "model"
  | "voice"
  | "realtime-voice"
  | "server"
  | "providers"
  | "updates";
export const OUTCOMEGO_DEEP_LINK_EVENT = "outcomego:deep-link";

const settingsAnchorSet = new Set<string>(SETTINGS_ANCHORS);

const viewByAnchor: Record<SettingsAnchor, SettingsView> = {
  language: "general",
  theme: "general",
  microphone: "general",
  computers: "computer",
  "browser-network": "server",
  "inference-provider": "model",
  "inference-model": "model",
  "inference-reasoning": "model",
  "update-status": "updates",
  "server-update": "updates",
  "tailscale-https": "server",
  "automatic-updates": "updates",
  "web-search-provider": "providers",
  "web-fetch-provider": "providers",
};

export type OutcomeGoDeepLink =
  | { kind: "settings"; anchor: SettingsAnchor }
  | { kind: "plugin"; pluginId: string };

export const settingsViewForAnchor = (anchor: SettingsAnchor): SettingsView => viewByAnchor[anchor];

export const parseOutcomeGoDeepLink = (value: string): OutcomeGoDeepLink | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "outcomego:" || url.hostname !== "app") return null;

  const id = url.searchParams.get("id")?.trim() ?? "";
  if (url.pathname === "/v1/settings") {
    return settingsAnchorSet.has(id) ? { kind: "settings", anchor: id as SettingsAnchor } : null;
  }
  if (
    url.pathname === "/v1/plugin/add" &&
    id.length > 0 &&
    id.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9._:@/+-]*$/.test(id)
  ) {
    return { kind: "plugin", pluginId: id };
  }
  return null;
};
