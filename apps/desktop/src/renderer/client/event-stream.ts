import {
  createLiveSyncController,
  type LiveSyncControllerOptions,
  shouldRefreshForEvent,
} from "@outcomego/client-core";
import { outcomeGoClient } from "./outcomego-api";
import { refreshMemoryViews } from "../lib/memory-events";

export { shouldRefreshForEvent };

export const createDesktopLiveSyncController = (
  options: Omit<LiveSyncControllerOptions, "listen">
) =>
  createLiveSyncController({
    ...options,
    listen: (cursor, eventHandlers, signal) =>
      outcomeGoClient.listenForEvents(cursor, {
        ...eventHandlers,
        onOpen: () => { eventHandlers.onOpen?.(); refreshMemoryViews(); },
        onEvent: (event) => {
          if (event.topic === "notification.presence.changed") window.dispatchEvent(new Event("outcomego:notification-preferences-changed"));
          eventHandlers.onEvent(event); refreshMemoryViews(event);
        },
      }, signal),
  });
