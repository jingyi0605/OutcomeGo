type ScreenBotShortcutView =
  | { kind: "chord"; modifier: "command" | "option" | "shift" | "control" }
  | { kind: "accelerator"; accelerator: string };

interface ScreenBotShortcutStatusView {
  shortcut: ScreenBotShortcutView;
  isDefault: boolean;
  active: boolean;
  mode: "tap" | "poll" | "shortcut" | null;
  error: string | null;
  fn: boolean;
  platform: string;
}

interface KeyboardShortcutsView {
  bindings: Record<"search" | "toggleSidebar" | "settings" | "dictate" | "previousBot" | "nextBot", string>;
  defaults: Record<"search" | "toggleSidebar" | "settings" | "dictate" | "previousBot" | "nextBot", string>;
}

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
    /** Feeds the floating screenbot composer (src/renderer/lib/screenbot-bridge.ts).. */
    shortcuts?: {
      get(): Promise<KeyboardShortcutsView>;
      set(action: string, binding: string | null): Promise<KeyboardShortcutsView>;
      recordFn(recording: boolean): Promise<void>;
      onChange(callback: (view: KeyboardShortcutsView) => void): () => void;
      onShortcut(callback: (action: string) => void): () => void;
    };
    /** Feeds the Bot floating window (src/renderer/hooks/use-bot-dock-sync.ts). */
    botDock?: {
      getEnabled(): Promise<boolean>;
      setEnabled(enabled: boolean): Promise<void>;
      onEnabledChange(callback: (enabled: boolean) => void): () => void;
      notifyDrag(active: boolean): void;
      publish(state: import("./lib/bot-dock-state").BotDockStateView | null): void;
      /** Sends what was typed in the floating composer; reject to report a failure. */
      onDeliver(
        handler: (request: {
          botId: string;
          content: string;
          nonce: string;
          goalMode?: boolean;
          /** Files already written to the send staging area by main. */
          staged: Array<{
          stagingId: string;
          fileName: string;
          mimeType: string;
          byteSize: number;
          width?: number;
          height?: number;
        }>;
        }) => Promise<void>
      ): () => void;
    };
    accessibility?: {
      check(): Promise<boolean>;
      request(): Promise<boolean>;
      openSettings(): Promise<void>;
    };
    screenbot?: {
      publishRoster(roster: {
        accountScope: string | null;
        bots: Array<{ id: string; name: string; title: string; color: string; icon: string; channelId: string; avatarDataUrl?: string }>;
        dictation: boolean;
      }): void;
      onTranscribe(handler: (request: { accountScope: string; audio: Uint8Array; mimeType: string }) => Promise<string>): () => void;
      onDeliver(
        handler: (request: {
          accountScope: string;
          botId: string;
          content: string;
          nonce: string;
          staged: { stagingId: string; fileName: string; mimeType: string; byteSize: number; width: number; height: number };
        }) => Promise<void>
      ): () => void;
      onRosterRequest(callback: () => void): () => void;
      shortcut: {
        get(): Promise<ScreenBotShortcutStatusView>;
        set(shortcut: ScreenBotShortcutView): Promise<ScreenBotShortcutStatusView>;
        reset(): Promise<ScreenBotShortcutStatusView>;
        setRecording(recording: boolean): Promise<void>;
        requestAccess(): Promise<boolean>;
        onChange(callback: (status: ScreenBotShortcutStatusView) => void): () => void;
      };
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
      status(): Promise<import("./lib/local-deploy-contract").LocalServerStatus>;
      start(): Promise<import("./lib/local-deploy-contract").LocalServerStatus>;
      stop(): Promise<import("./lib/local-deploy-contract").LocalServerStatus>;
      remove(input: { purgeData: boolean }): Promise<import("./lib/local-deploy-contract").LocalServerStatus>;
      diagnostics(): Promise<string>;
      resources(input: { computerMemory: string; desktopMemory: string }): Promise<import("./lib/local-deploy-contract").LocalServerStatus>;
    };
    localDeploy?: {
      start(input: import("./lib/local-deploy-contract").LocalDeployRequest): Promise<{ deployId: string }>;
      cancel(deployId: string): Promise<void>;
      enableWsl(confirmed: true): Promise<{ code: import("./lib/local-deploy-contract").Code | null }>;
      onProgress(callback: (event: import("./lib/local-deploy-contract").DeployProgress) => void): () => void;
    };
    backgroundPreferences?: {
      get(): Promise<{ stopServiceOnQuit: boolean }>;
      set(value: boolean): Promise<{ stopServiceOnQuit: boolean }>;
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
      releaseNotes: (version: string) => Promise<OutcomeGoReleaseNotes>;
      installClient: () => Promise<void>;
      onClientProgress: (listener: (status: OutcomeGoUpdateStatus) => void) => () => void;
      getChannel: () => Promise<"stable" | "beta">;
      setChannel: (channel: "stable" | "beta") => Promise<"stable" | "beta">;
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
      read: (state: import("@outcomego/contracts/notification-content").NotificationReadState) => void;
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
    outcomes?: {
      takePendingTarget: () => Promise<import("./lib/outcome-target").DesktopOutcomeTarget | null>;
      onTargetAvailable: (callback: () => void) => () => void;
      syncNotifications: (notifications: unknown[]) => void;
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

interface OutcomeGoReleaseNotes {
  version: string;
  markdown: string | null;
  url: string;
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
  track: "stable" | "beta";
}

type OutcomeGoServerUpdateStatus = import("@outcomego/contracts").ServerUpdateView & {
  serverUrl: string;
  currentVersion: string | null;
  apiProtocolVersion: number | null;
  minimumClientVersion: string | null;
  maximumClientVersionExclusive: string | null;
  recommendedClientVersion: string | null;
  updateChannel: "stable" | "beta" | null;
  manualCommand: string;
};
