interface Window {
  outcomego?: {
    platform: string;
    clipboard?: {
      readText(): Promise<string>;
      writeText(text: string): Promise<void>;
      setComputerActive(active: boolean): void;
      onComputerAction(callback: (action: "copy" | "cut" | "paste") => void): () => void;
    };
    onMenuAction?: (listener: (action: "about" | "updates" | "settings") => void) => () => void;
    setApplicationMenuLocale?: (locale: "en-US" | "zh-CN") => Promise<void>;
    visibility?: {
      subscribe: (callback: (visible: boolean) => void) => () => void;
      subscribeActivity?: (callback: (active: boolean) => void) => () => void;
    };
    auth: {
      connectMachine: (serverUrl: string) => Promise<{ machineId: string }>;
      machineStatus: () => Promise<{
        machineId: string;
        connected: boolean;
        configured: boolean;
        error: string | null;
      }>;
      signIn: (
        serverUrl: string,
        username: string,
        password: string
      ) => Promise<import("@outcomego/client-core").OutcomeGoSignInResult>;
      signOut: (serverUrl: string, token: string) => Promise<void>;
      readToken: () => Promise<OutcomeGoAuthTokenStorageResult>;
      writeToken: (token: string) => Promise<OutcomeGoAuthTokenStorageResult>;
      clearToken: () => Promise<OutcomeGoAuthTokenStorageResult>;
    };
    pluginOAuth?: {
      start(
        connectionId: string,
        force?: boolean
      ): Promise<{ authorizationUrl: string; status: string }>;
      cancel(connectionId: string, state: string): Promise<boolean>;
      close(): Promise<void>;
      onResult(
        callback: (result: {
          connectionId: string;
          status: "ready" | "cancelled" | "error";
          message?: string;
        }) => void
      ): () => void;
    };
    /** An OutcomeGo server installed on this computer by the CLI, if any. */
    localServer?: {
      detect(): Promise<{ url: string; username?: string } | null>;
    };
    /** Catches a model provider's localhost sign-in redirect on this computer. */
    providerSignIn?: {
      capture(
        authorizationUrl: string,
        redirectUri: string
      ): Promise<
        | { status: "captured"; callbackUrl: string }
        | { status: "unavailable"; message: string }
        | { status: "cancelled" }
      >;
      cancel(): Promise<void>;
    };
    computer: {
      network: () => Promise<
        import("@outcomego/contracts/browser-network").NetworkSharingStatus | null
      >;
      shareNetwork: (
        enabled: boolean
      ) => Promise<import("@outcomego/contracts/browser-network").NetworkSharingStatus>;
      get: () => Promise<OutcomeGoComputerSettings>;
      update: (request: {
        machineLabel?: string;
        messagesEnabled?: boolean;
      }) => Promise<OutcomeGoComputerSettings>;
      messagesPermissions: (
        request?: "fullDiskAccess" | "automation" | "contacts"
      ) => Promise<OutcomeGoMessagesPermissions | null>;
      messagesIcon?: () => Promise<string | null>;
      onMessagesGrantsNeeded?: (listener: () => void) => () => void;
    };
    files: {
      downloadAll: (
        files: Array<{ fileName: string; url: string }>
      ) => Promise<{ canceled: boolean; saved: number; directory: string | null }>;
      stageDelivery: (request: { stagingId: string; bytes: ArrayBuffer }) => Promise<void>;
      readDeliveryStage: (stagingId: string) => Promise<Uint8Array>;
      discardDeliveryStages: (stagingIds: string[]) => Promise<void>;
    };
    deliveryJournal: {
      read: (scope: string) => Promise<unknown>;
      write: (scope: string, journal: unknown) => Promise<void>;
    };
    tailscale: {
      request: (request: {
        serverUrl: string;
        action: "status" | "enable" | "disable";
        httpsPort?: string;
      }) => Promise<import("@outcomego/contracts/tailscale").DesktopTailscaleStatus>;
    };
    updates: {
      status: () => Promise<OutcomeGoUpdateStatus>;
      check: () => Promise<OutcomeGoUpdateStatus>;
      openDownload: () => Promise<void>;
      installClient: () => Promise<void>;
      onClientProgress: (listener: (status: OutcomeGoUpdateStatus) => void) => () => void;
    };
    microphone: {
      status: () => Promise<{
        permission: "not-determined" | "granted" | "denied" | "restricted" | "unknown";
        canOpenSettings: boolean;
        canRequestPermission: boolean;
      }>;
      requestPermission: () => Promise<boolean>;
      openSettings: () => Promise<void>;
    };
    notifications: {
      clear: () => void;
      activity: () => Promise<{ active: boolean; idleSeconds: number }>;
      onActivityChange: (callback: () => void) => () => void;
      sync: (snapshot: {
        cursor?: string;
        channels: Array<
          import("@outcomego/contracts/notification-content").ChannelNotificationState & {
            unreadCount: number;
          }
        >;
      }) => void;
      setVisibleChannel: (channelId: string | null) => void;
      status: () => Promise<{
        supported: boolean;
        platform: string;
        delivered: Array<{ id: string; title: string; body: string }>;
      }>;
      openSettings: () => Promise<void>;
    };
    getProcessMetrics: () => Promise<{
      at: number;
      app: Electron.ProcessMetric[];
      main: Electron.ProcessMemoryInfo;
      gpu: Electron.GPUFeatureStatus;
    }>;
    onNotificationClick: (
      listener: (
        target: import("@outcomego/contracts/notification-content").DesktopNotificationTarget
      ) => void
    ) => () => void;
    versions: Readonly<{ app: string; electron: string; chrome: string }>;
  };
}

interface OutcomeGoAuthTokenStorageResult {
  token: string | null;
  persistence: "disk";
  backend: string;
}

interface OutcomeGoComputerSettings {
  version: 1;
  machine: {
    machineId: string;
    label: string;
  };
  messagesEnabled: boolean;
  messagesSupported: boolean;
}

interface OutcomeGoMessagesPermissions {
  fullDiskAccess: boolean;
  automation: "granted" | "denied" | "notAsked" | "unknown";
  contacts: "granted" | "denied" | "notAsked" | "unknown";
}

interface OutcomeGoUpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  downloadUrl: string;
  status:
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "backing-up"
    | "downloaded"
    | "installing"
    | "error";
  progress: number | null;
  message: string | null;
  failureKind:
    | "service-unavailable"
    | "feed-http-status"
    | "feed-malformed"
    | "signature-invalid"
    | "download-failed"
    | "apply-unsupported"
    | "unknown"
    | null;
  track: "stable";
}

type OutcomeGoServerUpdateStatus = import("@outcomego/contracts").ServerUpdateView & {
  serverUrl: string;
  currentVersion: string | null;
  apiProtocolVersion: number | null;
  minimumClientVersion: string | null;
  maximumClientVersionExclusive: string | null;
  recommendedClientVersion: string | null;
  manualCommand: string;
};
