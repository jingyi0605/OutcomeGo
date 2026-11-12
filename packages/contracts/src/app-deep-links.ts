/** Settings rows the apps open from an outcomego://app/v1/settings?id=<anchor> link. */
export const APP_SETTINGS_ANCHORS = [
  "language",
  "theme",
  "microphone",
  "computers",
  "browser-network",
  "inference-provider",
  "inference-model",
  "inference-reasoning",
  "update-status",
  "server-update",
  "tailscale-https",
  "automatic-updates",
  "web-search-provider",
  "web-fetch-provider",
] as const;
