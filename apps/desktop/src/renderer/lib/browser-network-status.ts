import type { BrowserNetworkView } from "@outcomego/contracts/browser-network";
import { translateCurrent } from "./i18n-catalog";

export function browserNetworkLabel(view: BrowserNetworkView) {
  const name =
    view.devices.find(
      (d) => d.machineId === (view.runtime.activeMachineId ?? view.settings.machineId)
    )?.label ?? translateCurrent("selected computer");
  switch (view.runtime.state) {
    case "server":
      if (view.settings.mode !== "ranked") return translateCurrent("Using the server connection");
      return view.settings.sourceOrder[0] === "server"
        ? translateCurrent("Using the server connection · Ranked connections")
        : translateCurrent("Using the server connection · Ranked fallback");
    case "ready":
      return view.settings.mode === "ranked"
        ? translateCurrent("Using {name} · Ranked connections", { name })
        : translateCurrent("Using {name}", { name });
    case "waiting_for_device":
      return translateCurrent("Waiting for {name}; computer networking is paused", { name });
    case "applying":
      return translateCurrent("Changing computer connection…");
    case "update_required":
      return translateCurrent(
        "Computer connection unavailable; update or reconnect the computer runtime"
      );
    default:
      return translateCurrent("Computer network unavailable");
  }
}
