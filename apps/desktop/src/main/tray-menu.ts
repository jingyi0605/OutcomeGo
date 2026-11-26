import type { LocalServerStatus } from "../renderer/lib/local-deploy-contract";
import { serverStateLabel } from "../renderer/lib/server-location";

export type TrayMenuAction =
  | "open"
  | "status"
  | "manage"
  | "start"
  | "stop"
  | "restart"
  | "autostart"
  | "logs-folder"
  | "quit";

export interface TrayMenuItem {
  action: TrayMenuAction;
  label: string;
  enabled: boolean;
  type?: "normal" | "checkbox";
  checked?: boolean;
  separatorBefore?: boolean;
}

export interface TrayMenuState {
  local: boolean;
  state: LocalServerStatus["stack"]["state"];
  busy: boolean;
  stopServiceOnQuit: boolean;
  engineKind?: "managed-wsl" | "managed-lima" | "external" | null;
  autostartEnabled?: boolean;
  autostartSupported?: boolean;
}

export const buildTrayMenu = (options: TrayMenuState): TrayMenuItem[] => {
  const { local, state, busy, stopServiceOnQuit, engineKind, autostartEnabled } = options;
  const running = state === "running";
  const inTransition = ["not-installed", "starting", "updating", "removing"].includes(state);
  const canToggleRun = !busy && !inTransition;
  const canRestart = !busy && (state === "running" || state === "unhealthy");
  const autostartSupported =
    options.autostartSupported ??
    (engineKind === "managed-wsl" || engineKind === "managed-lima");

  if (!local) {
    return [
      { action: "open", label: "Open OutcomeGo", enabled: true },
      { action: "quit", label: "Quit OutcomeGo", enabled: true },
    ];
  }

  return [
    { action: "open", label: "Open OutcomeGo", enabled: true },
    {
      action: "status",
      label: serverStateLabel(state),
      enabled: false,
      separatorBefore: true,
    },
    { action: "manage", label: "Manage local services…", enabled: true },
    {
      action: running ? "stop" : "start",
      label: running ? "Stop local services" : "Start local services",
      enabled: canToggleRun,
      separatorBefore: true,
    },
    {
      action: "restart",
      label: "Restart local services",
      enabled: canRestart,
    },
    {
      action: "autostart",
      label: "Start local services at login",
      type: "checkbox",
      checked: Boolean(autostartSupported && autostartEnabled),
      enabled: !busy && autostartSupported,
      separatorBefore: true,
    },
    {
      action: "logs-folder",
      label: "Open logs folder",
      enabled: state !== "not-installed",
    },
    {
      action: "quit",
      label: !stopServiceOnQuit
        ? "Quit OutcomeGo (keep local services running)"
        : "Quit OutcomeGo",
      enabled: true,
      separatorBefore: true,
    },
  ];
};
