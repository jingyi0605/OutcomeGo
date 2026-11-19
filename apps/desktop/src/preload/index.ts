import { contextBridge, ipcRenderer } from "electron";
import { parseNotificationTarget } from "../main/notifications";
import type { DesktopNotificationTarget } from "@outcomego/contracts/notification-content";
import type { ApplicationMenuAction } from "../main/application-menu";
import { parseDesktopOutcomeTarget } from "../renderer/lib/outcome-target";

const appVersionArgument = process.argv.find((argument) =>
  argument.startsWith("--outcomego-app-version=")
);
const appVersion = (() => {
  if (!appVersionArgument) return "0.0.0";
  try {
    return decodeURIComponent(appVersionArgument.slice("--outcomego-app-version=".length));
  } catch {
    return "0.0.0";
  }
})();

type AuthTokenStorageResult = {
  token: string | null;
  persistence: "disk";
  backend: string;
};

const authTokenStorageResult = (value: unknown): AuthTokenStorageResult => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Authentication storage returned an invalid response");
  }
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.token !== null && typeof candidate.token !== "string") ||
    candidate.persistence !== "disk" ||
    typeof candidate.backend !== "string"
  ) {
    throw new Error("Authentication storage returned an invalid response");
  }
  return candidate as AuthTokenStorageResult;
};

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const downloadRequests = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) {
    throw new Error("Download request is invalid");
  }
  for (const candidate of value) {
    const input = record(candidate, "Download item");
    if (
      typeof input.fileName !== "string" ||
      !input.fileName.trim() ||
      input.fileName.length > 512 ||
      typeof input.url !== "string" ||
      input.url.length > 2_000
    ) {
      throw new Error("Download item is invalid");
    }
  }
  return value;
};

const stagingId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9-]{8,120}$/.test(value)) {
    throw new Error("Delivery staging ID is invalid");
  }
  return value;
};

const deliveryStageRequest = (value: { stagingId: string; bytes: ArrayBuffer }) => {
  stagingId(value.stagingId);
  if (!(value.bytes instanceof ArrayBuffer) || value.bytes.byteLength === 0) {
    throw new Error("Delivery staging bytes are invalid");
  }
  return value;
};

const deliveryStageIds = (value: string[]) => {
  if (value.length > 24) throw new Error("Too many delivery staging IDs");
  return value.map(stagingId);
};

const deliveryJournalScope = (value: string): string => {
  if (typeof value !== "string" || !value || value.length > 2_048) {
    throw new Error("Delivery journal scope is invalid");
  }
  return value;
};

const deliveryJournal = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Delivery journal is invalid");
  }
  return value;
};

const notificationSnapshot = (value: unknown) => {
  const input = record(value, "Notification snapshot");
  if (!Array.isArray(input.channels) || input.channels.length > 10_000) {
    throw new Error("Notification snapshot is invalid");
  }
  return value;
};

/** Subscribes to a channel's values; returns the unsubscribe. */
const listen = (channel: string, callback: (value: unknown) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

/** What the floating composer shows when the chat window couldn't do what it asked. Network
 * failures surface from fetch as a bare "Failed to fetch"; say what that means instead. */
const screenBotError = (error: unknown, fallback: string) => {
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return "Couldn’t reach OutcomeGo. Check your connection and try again.";
  }
  return error instanceof Error && error.message ? error.message : fallback;
};

interface ScreenBotDelivery {
  accountScope: string;
  botId: string;
  content: string;
  nonce: string;
  staged: {
    stagingId: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    width: number;
    height: number;
  };
}

contextBridge.exposeInMainWorld("outcomego", {
  outcomes: {
    takePendingTarget: async () => {
      const value = await ipcRenderer.invoke("outcomego:outcomes:take-pending");
      return value === null ? null : parseDesktopOutcomeTarget(value);
    },
    onTargetAvailable: (callback: () => void) => listen("outcomego:outcomes:target-available", () => callback()),
    syncNotifications: (notifications: unknown[]) => {
      if (!Array.isArray(notifications) || notifications.length > 100) throw new Error("Outcome notifications are invalid");
      ipcRenderer.send("outcomego:outcomes:notifications", notifications);
    },
  },
  platform: process.platform,
  clipboard: {
    readText: (): Promise<string> => ipcRenderer.invoke("outcomego:computer-clipboard-read"),
    writeText: (text: string): Promise<void> =>
      ipcRenderer.invoke("outcomego:computer-clipboard-write", text),
    setComputerActive: (active: boolean) => {
      if (typeof active === "boolean")
        ipcRenderer.send("outcomego:computer-clipboard-active", active);
    },
    onComputerAction: (callback: (action: "copy" | "cut" | "paste") => void) => {
      const listener = (_event: Electron.IpcRendererEvent, action: unknown) => {
        if (action === "copy" || action === "cut" || action === "paste") callback(action);
      };
      ipcRenderer.on("outcomego:computer-clipboard", listener);
      return () => ipcRenderer.removeListener("outcomego:computer-clipboard", listener);
    },
  },
  onMenuAction: (callback: (action: ApplicationMenuAction) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (action === "about" || action === "updates" || action === "settings") callback(action);
    };
    ipcRenderer.on("outcomego:app-menu", listener);
    return () => ipcRenderer.removeListener("outcomego:app-menu", listener);
  },
  setApplicationMenuLocale: (locale: "en-US" | "zh-CN") =>
    ipcRenderer.invoke("outcomego:application-menu-locale", locale),
  visibility: {
    subscribeActivity: (callback: (active: boolean) => void) => {
      let subscribed = true;
      let receivedEvent = false;
      const listener = (_event: Electron.IpcRendererEvent, active: unknown) => {
        if (typeof active !== "boolean") return;
        receivedEvent = true;
        if (subscribed) callback(active);
      };
      ipcRenderer.on("outcomego:window-activity-changed", listener);
      void ipcRenderer
        .invoke("outcomego:window-activity")
        .then((active) => {
          if (subscribed && !receivedEvent && typeof active === "boolean") callback(active);
        })
        .catch(() => {
          /* Browser focus remains the fallback during shutdown. */
        });
      return () => {
        subscribed = false;
        ipcRenderer.removeListener("outcomego:window-activity-changed", listener);
      };
    },
    subscribe: (callback: (visible: boolean) => void) => {
      let active = true;
      let receivedEvent = false;
      const listener = (_event: Electron.IpcRendererEvent, visible: unknown) => {
        if (typeof visible !== "boolean") return;
        receivedEvent = true;
        if (active) callback(visible);
      };
      ipcRenderer.on("outcomego:window-visibility-changed", listener);
      void ipcRenderer
        .invoke("outcomego:window-visibility")
        .then((visible) => {
          if (active && !receivedEvent && typeof visible === "boolean") callback(visible);
        })
        .catch(() => {
          /* Browser visibility remains the fallback during shutdown. */
        });
      return () => {
        active = false;
        ipcRenderer.removeListener("outcomego:window-visibility-changed", listener);
      };
    },
  },
  auth: {
    connectMachine: (serverUrl: string) =>
      ipcRenderer.invoke("outcomego:machine:connect", serverUrl),
    machineStatus: () => ipcRenderer.invoke("outcomego:machine:status"),
    signIn: (serverUrl: string, username: string, password: string) =>
      ipcRenderer.invoke("outcomego:auth:sign-in", serverUrl, username, password),
    signOut: (serverUrl: string, token: string) =>
      ipcRenderer.invoke("outcomego:auth:sign-out", serverUrl, token),
    readToken: async () =>
      authTokenStorageResult(await ipcRenderer.invoke("outcomego:auth-token:read")),
    writeToken: async (token: string) => {
      if (typeof token !== "string" || !token.trim() || token.length > 16 * 1024) {
        throw new Error("Authentication token is invalid");
      }
      return authTokenStorageResult(await ipcRenderer.invoke("outcomego:auth-token:write", token));
    },
    clearToken: async () =>
      authTokenStorageResult(await ipcRenderer.invoke("outcomego:auth-token:clear")),
  },
  pluginOAuth: {
    start: (connectionId: string, force = false) =>
      ipcRenderer.invoke("outcomego:plugin-oauth:start", connectionId, force),
    cancel: (connectionId: string, state: string) =>
      ipcRenderer.invoke("outcomego:plugin-oauth:cancel", connectionId, state),
    close: () => ipcRenderer.invoke("outcomego:plugin-oauth:close"),
    onResult: (
      callback: (result: {
        connectionId: string;
        status: "ready" | "cancelled" | "error";
        message?: string;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        result: Parameters<typeof callback>[0]
      ) => callback(result);
      ipcRenderer.on("outcomego:plugin-oauth:result", listener);
      return () => ipcRenderer.removeListener("outcomego:plugin-oauth:result", listener);
    },
  },
  localServer: {
    detect: () => ipcRenderer.invoke("outcomego:local-server:detect"),
  },
  providerSignIn: {
    capture: (authorizationUrl: string, redirectUri: string) =>
      ipcRenderer.invoke("outcomego:provider-sign-in:capture", authorizationUrl, redirectUri),
    cancel: () => ipcRenderer.invoke("outcomego:provider-sign-in:cancel"),
  },
  computer: {
    network: () => ipcRenderer.invoke("outcomego:network:get"),
    shareNetwork: (enabled: boolean) => ipcRenderer.invoke("outcomego:network:share", enabled),
    get: () => ipcRenderer.invoke("outcomego:computer:get"),
    update: (request: { machineLabel?: string; messagesEnabled?: boolean }) =>
      ipcRenderer.invoke("outcomego:computer:update", request),
    messagesPermissions: (request?: "fullDiskAccess" | "automation" | "contacts") =>
      ipcRenderer.invoke("outcomego:computer:messages-permissions", request ?? null),
    messagesIcon: (): Promise<string | null> =>
      ipcRenderer.invoke("outcomego:computer:messages-icon"),
    onMessagesGrantsNeeded: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("outcomego:messages-grants-needed", handler);
      return () => {
        ipcRenderer.removeListener("outcomego:messages-grants-needed", handler);
      };
    },
  },
  files: {
    downloadAll: (files: Array<{ fileName: string; url: string }>) =>
      ipcRenderer.invoke("outcomego:files:download-all", downloadRequests(files)),
    stageDelivery: (request: { stagingId: string; bytes: ArrayBuffer }) =>
      ipcRenderer.invoke("outcomego:files:stage-delivery", deliveryStageRequest(request)),
    readDeliveryStage: (id: string) =>
      ipcRenderer.invoke(
        "outcomego:files:read-delivery-stage",
        stagingId(id)
      ) as Promise<Uint8Array>,
    discardDeliveryStages: (ids: string[]) =>
      ipcRenderer.invoke("outcomego:files:discard-delivery-stages", deliveryStageIds(ids)),
  },
  deliveryJournal: {
    read: (scope: string) =>
      ipcRenderer.invoke("outcomego:delivery-journal:read", deliveryJournalScope(scope)),
    write: (scope: string, journal: unknown) =>
      ipcRenderer.invoke("outcomego:delivery-journal:write", {
        scope: deliveryJournalScope(scope),
        journal: deliveryJournal(journal),
      }),
  },
  tailscale: {
    request: (request: {
      serverUrl: string;
      action: "status" | "enable" | "disable";
      httpsPort?: string;
    }) => ipcRenderer.invoke("outcomego:tailscale", request),
  },
  updates: {
    status: () => ipcRenderer.invoke("outcomego:updates:status"),
    check: () => ipcRenderer.invoke("outcomego:updates:check"),
    openDownload: () => ipcRenderer.invoke("outcomego:updates:open-download"),
    installClient: () => ipcRenderer.invoke("outcomego:updates:install-client"),
    getChannel: () => ipcRenderer.invoke("outcomego:updates:get-channel"),
    setChannel: (channel: string) => {
      if (channel !== "stable" && channel !== "beta")
        throw new Error("Invalid update channel");
      return ipcRenderer.invoke("outcomego:updates:set-channel", channel);
    },
    onClientProgress: (listener: (status: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) => listener(status);
      ipcRenderer.on("outcomego:desktop-update-progress", handler);
      return () => ipcRenderer.removeListener("outcomego:desktop-update-progress", handler);
    },
  },
  microphone: {
    status: () => ipcRenderer.invoke("outcomego:microphone:status"),
    requestPermission: () => ipcRenderer.invoke("outcomego:microphone:request-permission"),
    openSettings: () => ipcRenderer.invoke("outcomego:microphone:open-settings"),
  },
  notifications: {
    clear: () => ipcRenderer.send("outcomego:notifications:clear"),
    read: (state: unknown) => ipcRenderer.send("outcomego:notifications:read", state),
    activity: () => ipcRenderer.invoke("outcomego:notifications:activity"),
    onActivityChange: (callback: () => void) => {
      ipcRenderer.on("outcomego:notifications:activity-changed", callback);
      return () => ipcRenderer.removeListener("outcomego:notifications:activity-changed", callback);
    },
    sync: (snapshot: unknown) =>
      ipcRenderer.send("outcomego:notifications:sync", notificationSnapshot(snapshot)),
    setVisibleChannel: (channelId: string | null) => {
      if (
        channelId !== null &&
        (typeof channelId !== "string" || !channelId.trim() || channelId.length > 512)
      ) {
        throw new Error("Visible notification channel is invalid");
      }
      ipcRenderer.send("outcomego:notifications:visible-channel", channelId);
    },
    status: () => ipcRenderer.invoke("outcomego:notifications:status"),
    openSettings: () => ipcRenderer.invoke("outcomego:notifications:open-settings"),
  },
  /** Rebindable app shortcuts (Settings › Keyboard), and the ones only main sees (Fn). */
  shortcuts: {
    get: () => ipcRenderer.invoke("outcomego:shortcuts:get"),
    set: (action: string, binding: string | null) =>
      ipcRenderer.invoke("outcomego:shortcuts:set", action, binding),
    recordFn: (recording: boolean) =>
      ipcRenderer.invoke("outcomego:shortcuts:record-fn", recording === true),
    onChange: (callback: (view: unknown) => void) =>
      listen("outcomego:shortcuts-changed", callback),
    onShortcut: (callback: (action: string) => void) =>
      listen("outcomego:shortcut", (action) => {
        if (typeof action === "string") callback(action);
      }),
  },
  botDock: {
    getEnabled: () => ipcRenderer.invoke("outcomego:botdock:get-enabled"),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke("outcomego:botdock:set-enabled", enabled),
    onEnabledChange: (callback: (enabled: boolean) => void) =>
      listen("outcomego:botdock:enabled-changed", (value) => {
        if (typeof value === "boolean") callback(value);
      }),
    /** What the Bot floating window shows (Bots with unread messages or goals waiting), or
     * null when there is nothing to show (signed out). */
    publish: (state: unknown) =>
      ipcRenderer.send(
        "outcomego:botdock:state",
        state === null ? null : record(state, "Bot dock state")
      ),
    /** Notify dock that a file drag started or ended in the main window. */
    notifyDrag: (active: boolean) =>
      ipcRenderer.send("outcomego:botdock:drag-hint", active === true),
    /** A message typed into the floating window's composer, to be sent as this account. */
    onDeliver: (
      handler: (request: {
        botId: string;
        content: string;
        nonce: string;
        staged: Array<{
          stagingId: string;
          fileName: string;
          mimeType: string;
          byteSize: number;
          width?: number;
          height?: number;
        }>;
      }) => Promise<void>
    ) => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const request = record(value, "Bot dock delivery");
        const { requestId, botId, content, nonce, staged } = request;
        if (
          typeof requestId !== "string" ||
          typeof botId !== "string" ||
          typeof content !== "string" ||
          typeof nonce !== "string" ||
          !Array.isArray(staged) ||
          staged.length > 16
        )
          return;
        const files = staged.map((entry) => record(entry, "Bot dock attachment"));
        const optionalNumber = (value: unknown) => value === undefined || typeof value === "number";
        if (
          !files.every(
            (file) =>
              typeof file.stagingId === "string" &&
              typeof file.fileName === "string" &&
              typeof file.mimeType === "string" &&
              typeof file.byteSize === "number" &&
              optionalNumber(file.width) &&
              optionalNumber(file.height)
          )
        )
          return;
        const reply = (ok: boolean) =>
          ipcRenderer.send("outcomego:botdock:delivered", { requestId, ok });
        handler({
          botId,
          content,
          nonce,
          staged: files as unknown as Parameters<typeof handler>[0]["staged"],
        }).then(
          () => reply(true),
          () => reply(false)
        );
      };
      ipcRenderer.on("outcomego:botdock:deliver", listener);
      return () => ipcRenderer.removeListener("outcomego:botdock:deliver", listener);
    },
  },
  screenbot: {
    /** Bots the floating screenbot composer can send to, most recent first. */
    publishRoster: (roster: unknown) =>
      ipcRenderer.send("openteam:screenbot:roster", record(roster, "ScreenBot roster")),
    /** Delivers a ScreenBot already staged on disk by main (which validated it): only a
     * reference crosses IPC. */
    onDeliver: (handler: (request: ScreenBotDelivery) => Promise<void>) => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const request = record(value, "ScreenBot delivery") as unknown as ScreenBotDelivery & {
          requestId: string;
        };
        const reply = (result: object) =>
          ipcRenderer.send("openteam:screenbot:delivered", {
            requestId: request.requestId,
            ...result,
          });
        stagingId(request.staged?.stagingId);
        handler(request).then(
          () => reply({ ok: true }),
          (error: unknown) =>
            reply({
              ok: false,
              error: screenBotError(error, "This screenshot couldn’t be sent."),
            })
        );
      };
      ipcRenderer.on("openteam:screenbot:deliver", listener);
      return () => ipcRenderer.removeListener("openteam:screenbot:deliver", listener);
    },
    /** Dictation in the screenbot composer: transcribe a recording made by the overlay. */
    onTranscribe: (
      handler: (request: {
        accountScope: string;
        audio: Uint8Array;
        mimeType: string;
      }) => Promise<string>
    ) => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const { requestId, accountScope, audio, mimeType } = record(
          value,
          "ScreenBot transcription"
        );
        const reply = (result: object) =>
          ipcRenderer.send("openteam:screenbot:delivered", { requestId, ...result });
        if (
          typeof accountScope !== "string" ||
          !(audio instanceof Uint8Array) ||
          typeof mimeType !== "string"
        )
          return reply({ ok: false, error: "That recording couldn’t be used." });
        handler({ accountScope, audio, mimeType }).then(
          (text) => reply({ ok: true, text }),
          (error: unknown) =>
            reply({
              ok: false,
              error: screenBotError(error, "Transcription failed. Try again."),
            })
        );
      };
      ipcRenderer.on("openteam:screenbot:transcribe", listener);
      return () => ipcRenderer.removeListener("openteam:screenbot:transcribe", listener);
    },
    /** The screenbot trigger: both ⌘ keys by default, or a shortcut of the person's choosing. */
    shortcut: {
      get: () => ipcRenderer.invoke("outcomego:screenbot:shortcut:get"),
      set: (shortcut: unknown) =>
        ipcRenderer.invoke("outcomego:screenbot:shortcut:set", shortcut),
      reset: () => ipcRenderer.invoke("outcomego:screenbot:shortcut:set", null),
      setRecording: (recording: boolean) =>
        ipcRenderer.invoke("outcomego:screenbot:shortcut:recording", recording === true),
      requestAccess: () => ipcRenderer.invoke("outcomego:screenbot:shortcut:request-access"),
      onChange: (callback: (status: unknown) => void) =>
        listen("outcomego:screenbot:shortcut-changed", callback),
    },
    /** Main asks for a fresh Bot list each time a ScreenBot is taken. */
    onRosterRequest: (callback: () => void) =>
      listen("outcomego:screenbot:roster-request", () => callback()),
  },
  getProcessMetrics: () => ipcRenderer.invoke("outcomego:performance-snapshot"),
  onNotificationClick: (listener: (target: DesktopNotificationTarget) => void) =>
    listen("outcomego:notification-click", (target) => {
      const parsed = parseNotificationTarget(target);
      if (parsed) listener(parsed);
    }),
  versions: Object.freeze({
    app: appVersion,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }),
  accessibility: {
    check: () => ipcRenderer.invoke("outcomego:accessibility:check"),
    request: () => ipcRenderer.invoke("outcomego:accessibility:request"),
    openSettings: () => ipcRenderer.invoke("outcomego:accessibility:open-settings"),
  },
});
