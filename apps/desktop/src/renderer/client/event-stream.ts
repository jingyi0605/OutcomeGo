import {
  createLiveSyncController,
  type LiveSyncControllerOptions,
  shouldRefreshForEvent,
} from "@aiteamos/client-core";
import { aiTeamOSClient } from "./aiteamos-api";
import { refreshMemoryViews } from "../lib/memory-events";

export { shouldRefreshForEvent };

export const createDesktopLiveSyncController = (
  options: Omit<LiveSyncControllerOptions, "listen">
) =>
  createLiveSyncController({
    ...options,
    listen: (cursor, eventHandlers, signal) =>
      aiTeamOSClient.listenForEvents(cursor, {
        ...eventHandlers,
        onOpen: () => { eventHandlers.onOpen?.(); refreshMemoryViews(); },
        onEvent: (event) => {
          if (event.topic === "notification.presence.changed") window.dispatchEvent(new Event("aiteamos:notification-preferences-changed"));
          eventHandlers.onEvent(event); refreshMemoryViews(event);
        },
      }, signal),
  });
