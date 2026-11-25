import type { LocalServerStatus } from "../renderer/lib/local-deploy-contract";
import { serverStateLabel } from "../renderer/lib/server-location";

export const buildTrayMenu = (options: {
  local: boolean;
  state: LocalServerStatus["stack"]["state"];
  busy: boolean;
  stopServiceOnQuit: boolean;
}): { action: "open" | "status" | "start" | "stop" | "quit"; label: string; enabled: boolean }[] => {
  const { local, state, busy, stopServiceOnQuit } = options;
  const running = state === "running";
  const enabled = !busy && !["not-installed", "starting", "updating", "removing"].includes(state);
  return [
    { action: "open", label: "Open OutcomeGo", enabled: true },
    ...(local ? [
      { action: "status" as const, label: serverStateLabel(state), enabled: false },
      { action: running ? "stop" as const : "start" as const, label: running ? "Stop local services" : "Start local services", enabled },
    ] : []),
    { action: "quit", label: local && !stopServiceOnQuit ? "Quit OutcomeGo (keep local services running)" : "Quit OutcomeGo", enabled: true },
  ];
};
