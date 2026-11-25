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

const request = <Args extends unknown[] = [], Result = unknown>(channel: string) =>
  (...args: Args): Promise<Result> => ipcRenderer.invoke(`outcomego:${channel}`, ...args);

const publish = <Args extends unknown[] = []>(channel: string) =>
  (...args: Args): void => ipcRenderer.send(`outcomego:${channel}`, ...args);

const publishOutcomeNotifications = publish<[unknown[]]>("outcomes:notifications");
const publishComputerClipboardActive = publish<[boolean]>("computer-clipboard-active");
const publishNotificationSnapshot = publish<[unknown]>("notifications:sync");
const publishVisibleChannel = publish<[string | null]>("notifications:visible-channel");
const publishBotDockState = publish<[unknown]>("botdock:state");
const publishBotDockDragHint = publish<[boolean]>("botdock:drag-hint");
const publishBotDockDelivery = publish<[{ requestId: string; ok: boolean }]>("botdock:delivered");

const subscribe = (channel: string, callback: (value: unknown) => void) =>
  listen(`outcomego:${channel}`, callback);

const subscribeFlag = (channel: string, callback: (value: boolean) => void) => {
  let active = true;
  let receivedEvent = false;
  const unsubscribe = subscribe(`${channel}-changed`, (value) => {
    if (typeof value !== "boolean") return;
    receivedEvent = true;
    if (active) callback(value);
  });
  void request<[], boolean>(channel)().then((value) => {
    if (active && !receivedEvent && typeof value === "boolean") callback(value);
  }).catch(() => {});
  return () => {
    active = false;
    unsubscribe();
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
    onTargetAvailable: (callback: () => void) => subscribe("outcomes:target-available", callback),
    syncNotifications: (notifications: unknown[]) => {
      if (!Array.isArray(notifications) || notifications.length > 100) throw new Error("Outcome notifications are invalid");
      publishOutcomeNotifications(notifications);
    },
  },
  platform: process.platform,
  clipboard: {
    readText: request<[], string>("computer-clipboard-read"),
    writeText: request<[string], void>("computer-clipboard-write"),
    setComputerActive: (active: boolean) => {
      if (typeof active === "boolean")
        publishComputerClipboardActive(active);
    },
    onComputerAction: (callback: (action: "copy" | "cut" | "paste") => void) =>
      subscribe("computer-clipboard", (action) => {
        if (action === "copy" || action === "cut" || action === "paste") callback(action);
      }),
  },
  onMenuAction: (callback: (action: ApplicationMenuAction) => void) =>
    subscribe("app-menu", (action) => {
      if (action === "about" || action === "updates" || action === "settings") callback(action);
    }),
  setApplicationMenuLocale: request<["en-US" | "zh-CN"]>("application-menu-locale"),
  visibility: {
    subscribeActivity: (callback: (active: boolean) => void) =>
      subscribeFlag("window-activity", callback),
    subscribe: (callback: (visible: boolean) => void) =>
      subscribeFlag("window-visibility", callback),
  },
  auth: {
    connectMachine: request<[serverUrl: string]>("machine:connect"),
    machineStatus: request("machine:status"),
    signIn: request<[serverUrl: string, username: string, password: string]>("auth:sign-in"),
    signOut: request<[serverUrl: string, token: string]>("auth:sign-out"),
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
    cancel: request<[connectionId: string, state: string]>("plugin-oauth:cancel"),
    close: request("plugin-oauth:close"),
    onResult: (
      callback: (result: {
        connectionId: string;
        status: "ready" | "cancelled" | "error";
        message?: string;
      }) => void
    ) => subscribe("plugin-oauth:result", (result) => callback(result as Parameters<typeof callback>[0])),
  },
  localServer: {
    detect: request("local-server:detect"),
    status: request("local-server:status"),
    start: request("local-server:start"),
    stop: request("local-server:stop"),
    remove: request<[{ purgeData: boolean }]>("local-server:remove"),
    diagnostics: request("local-server:diagnostics"),
    resources: request<[{ computerMemory: string; desktopMemory: string }]>("local-server:resources"),
  },
  localDeploy: {
    start: request<[unknown]>("local-deploy:start"),
    cancel: request<[string]>("local-deploy:cancel"),
    engines: request("local-deploy:engines"),
    enableWsl: request<[true]>("local-deploy:enable-wsl"),
    onProgress: (callback: (value: unknown) => void) => subscribe("local-deploy:progress", callback),
  },
  backgroundPreferences: {
    get: request("background:get"),
    set: request<[boolean]>("background:set"),
  },
  providerSignIn: {
    capture: request<[authorizationUrl: string, redirectUri: string]>("provider-sign-in:capture"),
    cancel: request("provider-sign-in:cancel"),
  },
  computer: {
    network: request("network:get"),
    shareNetwork: request<[boolean]>("network:share"),
    get: request("computer:get"),
    update: request<[{ machineLabel?: string; messagesEnabled?: boolean }]>("computer:update"),
    messagesPermissions: (request?: "fullDiskAccess" | "automation" | "contacts") =>
      ipcRenderer.invoke("outcomego:computer:messages-permissions", request ?? null),
    messagesIcon: request<[], string | null>("computer:messages-icon"),
    onMessagesGrantsNeeded: (listener: () => void) => subscribe("messages-grants-needed", listener),
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
    status: request("updates:status"),
    check: request("updates:check"),
    openDownload: request("updates:open-download"),
    releaseNotes: request<[version: string]>("updates:release-notes"),
    installClient: request("updates:install-client"),
    getChannel: request("updates:get-channel"),
    setChannel: (channel: string) => {
      if (channel !== "stable" && channel !== "beta")
        throw new Error("Invalid update channel");
      return ipcRenderer.invoke("outcomego:updates:set-channel", channel);
    },
    onClientProgress: (listener: (status: unknown) => void) =>
      subscribe("desktop-update-progress", listener),
  },
  microphone: {
    status: request("microphone:status"),
    requestPermission: request("microphone:request-permission"),
    openSettings: request("microphone:open-settings"),
  },
  notifications: {
    clear: publish("notifications:clear"),
    read: publish<[unknown]>("notifications:read"),
    activity: request("notifications:activity"),
    onActivityChange: (callback: () => void) => subscribe("notifications:activity-changed", () => callback()),
    sync: (snapshot: unknown) =>
      publishNotificationSnapshot(notificationSnapshot(snapshot)),
    setVisibleChannel: (channelId: string | null) => {
      if (
        channelId !== null &&
        (typeof channelId !== "string" || !channelId.trim() || channelId.length > 512)
      ) {
        throw new Error("Visible notification channel is invalid");
      }
      publishVisibleChannel(channelId);
    },
    status: request("notifications:status"),
    openSettings: request("notifications:open-settings"),
  },
  /** Rebindable app shortcuts (Settings › Keyboard), and the ones only main sees (Fn). */
  shortcuts: {
    get: request("shortcuts:get"),
    set: request<[action: string, binding: string | null]>("shortcuts:set"),
    recordFn: (recording: boolean) =>
      ipcRenderer.invoke("outcomego:shortcuts:record-fn", recording === true),
    onChange: (callback: (view: unknown) => void) =>
      subscribe("shortcuts-changed", callback),
    onShortcut: (callback: (action: string) => void) =>
      subscribe("shortcut", (action) => {
        if (typeof action === "string") callback(action);
      }),
  },
  botDock: {
    getEnabled: request("botdock:get-enabled"),
    setEnabled: request<[boolean]>("botdock:set-enabled"),
    onEnabledChange: (callback: (enabled: boolean) => void) =>
      subscribe("botdock:enabled-changed", (value) => {
        if (typeof value === "boolean") callback(value);
      }),
    /** What the Bot floating window shows (Bots with unread messages or goals waiting), or
     * null when there is nothing to show (signed out). */
    publish: (state: unknown) =>
      publishBotDockState(state === null ? null : record(state, "Bot dock state")),
    /** Notify dock that a file drag started or ended in the main window. */
    notifyDrag: (active: boolean) =>
      publishBotDockDragHint(active === true),
    /** A message typed into the floating window's composer, to be sent as this account. */
    onDeliver: (
      handler: (request: {
        botId: string;
        content: string;
        nonce: string;
        goalMode?: boolean;
        staged: Array<{
          stagingId: string;
          fileName: string;
          mimeType: string;
          byteSize: number;
          width?: number;
          height?: number;
        }>;
      }) => Promise<void>
    ) => subscribe("botdock:deliver", (value) => {
        const request = record(value, "Bot dock delivery");
        const { requestId, botId, content, nonce, goalMode, staged } = request;
        if (
          typeof requestId !== "string" ||
          typeof botId !== "string" ||
          typeof content !== "string" ||
          typeof nonce !== "string" ||
          (goalMode !== undefined && typeof goalMode !== "boolean") ||
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
          publishBotDockDelivery({ requestId, ok });
        handler({
          botId,
          content,
          nonce,
          ...(goalMode === true ? { goalMode: true } : {}),
          staged: files as unknown as Parameters<typeof handler>[0]["staged"],
        }).then(
          () => reply(true),
          () => reply(false)
        );
    }),
  },
  screenbot: {
    /** Bots the floating screenbot composer can send to, most recent first. */
    publishRoster: (roster: unknown) =>
      ipcRenderer.send("openteam:screenbot:roster", record(roster, "ScreenBot roster")),
    /** Delivers a ScreenBot already staged on disk by main (which validated it): only a
     * reference crosses IPC. */
    onDeliver: (handler: (request: ScreenBotDelivery) => Promise<void>) =>
      listen("openteam:screenbot:deliver", (value) => {
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
      }),
    /** Dictation in the screenbot composer: transcribe a recording made by the overlay. */
    onTranscribe: (
      handler: (request: {
        accountScope: string;
        audio: Uint8Array;
        mimeType: string;
      }) => Promise<string>
    ) => listen("openteam:screenbot:transcribe", (value) => {
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
    }),
    /** The screenbot trigger: both ⌘ keys by default, or a shortcut of the person's choosing. */
    shortcut: {
      get: request("screenbot:shortcut:get"),
      set: request<[unknown]>("screenbot:shortcut:set"),
      reset: () => ipcRenderer.invoke("outcomego:screenbot:shortcut:set", null),
      setRecording: (recording: boolean) =>
        ipcRenderer.invoke("outcomego:screenbot:shortcut:recording", recording === true),
      requestAccess: request("screenbot:shortcut:request-access"),
      onChange: (callback: (status: unknown) => void) =>
        subscribe("screenbot:shortcut-changed", callback),
    },
    /** Main asks for a fresh Bot list each time a ScreenBot is taken. */
    onRosterRequest: (callback: () => void) =>
      subscribe("screenbot:roster-request", () => callback()),
  },
  getProcessMetrics: request("performance-snapshot"),
  onNotificationClick: (listener: (target: DesktopNotificationTarget) => void) =>
    subscribe("notification-click", (target) => {
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
