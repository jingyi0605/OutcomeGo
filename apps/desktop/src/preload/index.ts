import { contextBridge, ipcRenderer } from "electron";
import { parseNotificationTarget } from "../main/notifications";
import type { DesktopNotificationTarget } from "@aiteamos/contracts/notification-content";
import type { ApplicationMenuAction } from "../main/application-menu";

const appVersionArgument = process.argv.find((argument) =>
  argument.startsWith("--aiteamos-app-version=")
);
const appVersion = (() => {
  if (!appVersionArgument) return "0.0.0";
  try {
    return decodeURIComponent(appVersionArgument.slice("--aiteamos-app-version=".length));
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

contextBridge.exposeInMainWorld("aiteamos", {
  platform: process.platform,
  clipboard: {
    readText: (): Promise<string> => ipcRenderer.invoke("aiteamos:computer-clipboard-read"),
    writeText: (text: string): Promise<void> => ipcRenderer.invoke("aiteamos:computer-clipboard-write", text),
    setComputerActive: (active: boolean) => {
      if (typeof active === "boolean") ipcRenderer.send("aiteamos:computer-clipboard-active", active);
    },
    onComputerAction: (callback: (action: "copy" | "cut" | "paste") => void) => {
      const listener = (_event: Electron.IpcRendererEvent, action: unknown) => {
        if (action === "copy" || action === "cut" || action === "paste") callback(action);
      };
      ipcRenderer.on("aiteamos:computer-clipboard", listener);
      return () => ipcRenderer.removeListener("aiteamos:computer-clipboard", listener);
    },
  },
  onMenuAction: (callback: (action: ApplicationMenuAction) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (action === "about" || action === "updates" || action === "settings") callback(action);
    };
    ipcRenderer.on("aiteamos:app-menu", listener);
    return () => ipcRenderer.removeListener("aiteamos:app-menu", listener);
  },
  visibility: {
    subscribeActivity: (callback: (active: boolean) => void) => {
      let subscribed = true;
      let receivedEvent = false;
      const listener = (_event: Electron.IpcRendererEvent, active: unknown) => {
        if (typeof active !== "boolean") return;
        receivedEvent = true;
        if (subscribed) callback(active);
      };
      ipcRenderer.on("aiteamos:window-activity-changed", listener);
      void ipcRenderer.invoke("aiteamos:window-activity").then((active) => {
        if (subscribed && !receivedEvent && typeof active === "boolean") callback(active);
      }).catch(() => { /* Browser focus remains the fallback during shutdown. */ });
      return () => { subscribed = false; ipcRenderer.removeListener("aiteamos:window-activity-changed", listener); };
    },
    subscribe: (callback: (visible: boolean) => void) => {
      let active = true;
      let receivedEvent = false;
      const listener = (_event: Electron.IpcRendererEvent, visible: unknown) => {
        if (typeof visible !== "boolean") return;
        receivedEvent = true;
        if (active) callback(visible);
      };
      ipcRenderer.on("aiteamos:window-visibility-changed", listener);
      void ipcRenderer.invoke("aiteamos:window-visibility").then((visible) => {
        if (active && !receivedEvent && typeof visible === "boolean") callback(visible);
      }).catch(() => { /* Browser visibility remains the fallback during shutdown. */ });
      return () => { active = false; ipcRenderer.removeListener("aiteamos:window-visibility-changed", listener); };
    },
  },
  auth: {
    connectMachine: (serverUrl: string) => ipcRenderer.invoke("aiteamos:machine:connect", serverUrl),
    machineStatus: () => ipcRenderer.invoke("aiteamos:machine:status"),
    signIn: (serverUrl: string, username: string, password: string) =>
      ipcRenderer.invoke("aiteamos:auth:sign-in", serverUrl, username, password),
    signOut: (serverUrl: string, token: string) =>
      ipcRenderer.invoke("aiteamos:auth:sign-out", serverUrl, token),
    readToken: async () =>
      authTokenStorageResult(await ipcRenderer.invoke("aiteamos:auth-token:read")),
    writeToken: async (token: string) => {
      if (typeof token !== "string" || !token.trim() || token.length > 16 * 1024) {
        throw new Error("Authentication token is invalid");
      }
      return authTokenStorageResult(await ipcRenderer.invoke("aiteamos:auth-token:write", token));
    },
    clearToken: async () =>
      authTokenStorageResult(await ipcRenderer.invoke("aiteamos:auth-token:clear")),
  },
  pluginOAuth: {
    start: (connectionId: string, force = false) => ipcRenderer.invoke("aiteamos:plugin-oauth:start", connectionId, force),
    cancel: (connectionId: string, state: string) => ipcRenderer.invoke("aiteamos:plugin-oauth:cancel", connectionId, state),
    close: () => ipcRenderer.invoke("aiteamos:plugin-oauth:close"),
    onResult: (callback: (result: { connectionId: string; status: "ready" | "cancelled" | "error"; message?: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, result: Parameters<typeof callback>[0]) => callback(result);
      ipcRenderer.on("aiteamos:plugin-oauth:result", listener);
      return () => ipcRenderer.removeListener("aiteamos:plugin-oauth:result", listener);
    },
  },
  localServer: {
    detect: () => ipcRenderer.invoke("aiteamos:local-server:detect"),
  },
  providerSignIn: {
    capture: (authorizationUrl: string, redirectUri: string) =>
      ipcRenderer.invoke("aiteamos:provider-sign-in:capture", authorizationUrl, redirectUri),
    cancel: () => ipcRenderer.invoke("aiteamos:provider-sign-in:cancel"),
  },
  computer: {
    network: () => ipcRenderer.invoke("aiteamos:network:get"),
    shareNetwork: (enabled: boolean) => ipcRenderer.invoke("aiteamos:network:share", enabled),
    get: () => ipcRenderer.invoke("aiteamos:computer:get"),
    update: (request: { machineLabel?: string; messagesEnabled?: boolean }) => ipcRenderer.invoke("aiteamos:computer:update", request),
    messagesPermissions: (request?: "fullDiskAccess" | "automation" | "contacts") => ipcRenderer.invoke("aiteamos:computer:messages-permissions", request ?? null),
    messagesIcon: (): Promise<string | null> => ipcRenderer.invoke("aiteamos:computer:messages-icon"),
    onMessagesGrantsNeeded: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("aiteamos:messages-grants-needed", handler);
      return () => { ipcRenderer.removeListener("aiteamos:messages-grants-needed", handler); };
    },
  },
  files: {
    downloadAll: (files: Array<{ fileName: string; url: string }>) =>
      ipcRenderer.invoke("aiteamos:files:download-all", downloadRequests(files)),
    stageDelivery: (request: { stagingId: string; bytes: ArrayBuffer }) =>
      ipcRenderer.invoke("aiteamos:files:stage-delivery", deliveryStageRequest(request)),
    readDeliveryStage: (id: string) =>
      ipcRenderer.invoke(
        "aiteamos:files:read-delivery-stage",
        stagingId(id)
      ) as Promise<Uint8Array>,
    discardDeliveryStages: (ids: string[]) =>
      ipcRenderer.invoke("aiteamos:files:discard-delivery-stages", deliveryStageIds(ids)),
  },
  deliveryJournal: {
    read: (scope: string) =>
      ipcRenderer.invoke("aiteamos:delivery-journal:read", deliveryJournalScope(scope)),
    write: (scope: string, journal: unknown) =>
      ipcRenderer.invoke("aiteamos:delivery-journal:write", {
        scope: deliveryJournalScope(scope),
        journal: deliveryJournal(journal),
      }),
  },
  tailscale: {
    request: (request: { serverUrl: string; action: "status" | "enable" | "disable"; httpsPort?: string }) => ipcRenderer.invoke("aiteamos:tailscale", request),
  },
  updates: {
    status: () => ipcRenderer.invoke("aiteamos:updates:status"),
    check: () => ipcRenderer.invoke("aiteamos:updates:check"),
    openDownload: () => ipcRenderer.invoke("aiteamos:updates:open-download"),
    installClient: () => ipcRenderer.invoke("aiteamos:updates:install-client"),
    onClientProgress: (listener: (status: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) => listener(status);
      ipcRenderer.on("aiteamos:desktop-update-progress", handler);
      return () => ipcRenderer.removeListener("aiteamos:desktop-update-progress", handler);
    },

  },
  microphone: {
    status: () => ipcRenderer.invoke("aiteamos:microphone:status"),
    requestPermission: () => ipcRenderer.invoke("aiteamos:microphone:request-permission"),
    openSettings: () => ipcRenderer.invoke("aiteamos:microphone:open-settings"),
  },
  notifications: {
    clear: () => ipcRenderer.send("aiteamos:notifications:clear"),
    activity: () => ipcRenderer.invoke("aiteamos:notifications:activity"),
    onActivityChange: (callback: () => void) => {
      ipcRenderer.on("aiteamos:notifications:activity-changed", callback);
      return () => ipcRenderer.removeListener("aiteamos:notifications:activity-changed", callback);
    },
    sync: (snapshot: unknown) =>
      ipcRenderer.send("aiteamos:notifications:sync", notificationSnapshot(snapshot)),
    setVisibleChannel: (channelId: string | null) => {
      if (
        channelId !== null &&
        (typeof channelId !== "string" || !channelId.trim() || channelId.length > 512)
      ) {
        throw new Error("Visible notification channel is invalid");
      }
      ipcRenderer.send("aiteamos:notifications:visible-channel", channelId);
    },
    status: () => ipcRenderer.invoke("aiteamos:notifications:status"),
    openSettings: () => ipcRenderer.invoke("aiteamos:notifications:open-settings"),
  },
  getProcessMetrics: () => ipcRenderer.invoke("aiteamos:performance-snapshot"),
  onNotificationClick: (
    listener: (target: DesktopNotificationTarget) => void
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, target: unknown) => {
      const parsed = parseNotificationTarget(target);
      if (parsed) listener(parsed);
    };
    ipcRenderer.on("aiteamos:notification-click", handler);
    return () => ipcRenderer.removeListener("aiteamos:notification-click", handler);
  },
  versions: Object.freeze({
    app: appVersion,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }),
});
