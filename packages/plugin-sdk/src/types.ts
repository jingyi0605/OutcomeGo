/** Portable package definitions. These types never depend on a client, database, or runtime. */
export type ConfigValue = string | number | boolean;
export interface PluginField {
  key: string;
  label: string;
  type?: "string" | "number" | "integer" | "boolean";
  /** A remote MCP endpoint: HTTPS, or HTTP on the client's loopback interface. */
  required: boolean;
  secret: boolean;
  default?: ConfigValue;
  enum?: ConfigValue[];
  placeholder?: string;
  helpText?: string | null;
  /** Validate a self-hosted service's HTTPS origin without credentials or a path. */
  format?: "mcp-url" | "https-origin";
  /** Preserve significant whitespace, for example in a vault's master password. */
  preserveWhitespace?: boolean;
  /** Plugin runtime fields: expose the value to Bot computer processes under this name. */
  environment?: string;
  /** Keep the value out of ordinary Shell/process environments; only a host-controlled tool may use it. */
  protected?: boolean;
}
export interface PluginSetup {
  kind: "none" | "token" | "oauth" | "oauth_client";
  connectionKey: string | null;
  title: string;
  description: string;
  documentationUrl: string | null;
  dashboardUrl?: string | null;
  steps: string[];
  fields: PluginField[];
  requiredScopes: string[];
}
/** The main agent or a subagent type that can receive a plugin skill. */
export type PluginSkillAgent =
  | "main"
  | "executor"
  | "videoReview"
  | "watchVideo"
  | "computerUse"
  | "knowledgeWork";
export interface PluginSkillDefinition {
  name: string;
  description: string;
  body: string;
  /** Package-relative directory; files retain their paths within this directory. */
  path?: string;
  /** Agents whose instructions include this skill. Defaults to the main agent only. */
  agents?: PluginSkillAgent[];
}
export interface PluginToolDefinition {
  name: string;
  description: string;
  risk: "read" | "write" | "destructive";
  inputSchema: Readonly<Record<string, unknown>>;
}
/** Automation event sources a packaged connector may produce. Each has a routine trigger. */
export type PluginEventSource = "email";
/** Packaged connectors only. The host calls `pollTool` on a timer with `{ cursor }`
 * and expects `{ events, cursor }` back. The tool stays hidden from Bots. */
export interface PluginEventPolling {
  pollTool: string;
  source: PluginEventSource;
  /** Seconds between polls. Defaults to 60; at least 30 and at most 3600. */
  intervalSeconds?: number;
}
/** Packaged connectors only. A reviewed draft card (DraftExternalMessage) for this
 * platform is verified and, after the user presses Send, sent through this host-only
 * tool: `{ action: "verify" | "send", draft }`. Bots cannot call it themselves. */
export interface PluginDraftSending {
  platform: "email";
  tool: string;
}
/** Large native prerequisites fetched and verified before the computer starts MCP. */
export interface PluginRuntimeAssetSource {
  url: string;
  sha256: string;
  bytes: number;
  maxExtractedBytes: number;
  format: "tar.gz" | "file";
  path: string;
  executable?: boolean;
}
export interface PluginRuntimeAsset {
  /** Exposed to the connector as OPENTEAM_RUNTIME_<name>. */
  name: string;
  /** Optional assets may be absent on platforms that bundle this dependency already. */
  optional?: boolean;
  sources: Record<string, PluginRuntimeAssetSource>;
}
/** User-driven device approval through host-only MCP tools.
 * Start returns sessionId/qrCodeDataUrl/expiresAt. Rotating providers also set
 * sessionExpiresAt/challengeGeneration and return the same sessionId in status,
 * with newer challenge generations (including null images for bootstrap).
 * See docs/development/plugins.md for deadlines and lifecycle fencing.
 */
export interface PluginDeviceLink {
  startTool: string;
  finishTool: string;
  statusTool: string;
  cancelTool: string;
  removeTool: string;
  instructions: string;
}
/** Packaged connectors only. Chat-style messaging: the host polls `inbound.pollTool` for
 * messages from the account owner and sends Bot replies through `outbound.deliverTool`.
 * Both tools stay hidden from Bots. Requires `persistentState`. See specs/009. */
export interface PluginMessaging {
  /** Address prefix and display key, e.g. `wechat`. Matches ^[a-z0-9][a-z0-9_.-]{0,39}$. */
  platform: string;
  inbound: {
    pollTool: string;
    /** Longest time the poll tool may hold a call open, 0 to 25 seconds. Defaults to 20. */
    maxWaitSeconds?: number;
  };
  outbound: {
    deliverTool: string;
    /** Per-delivery text limit; the connector splits longer text itself. */
    maxTextChars: number;
    media?: {
      kinds: Array<"image" | "video" | "audio" | "file">;
      maxBytes: number;
    };
  };
}
export interface PluginConnectorDefinition {
  key: string;
  name: string;
  transport: "http" | "stdio" | "builtin";
  auth: "none" | "oauth" | "token";
  endpoint: string;
  configuration?: Readonly<Record<string, unknown>>;
  tools: PluginToolDefinition[];
  setup?: PluginSetup;
  events?: PluginEventPolling;
  drafts?: PluginDraftSending;
  runtimeAssets?: PluginRuntimeAsset[];
  deviceLink?: PluginDeviceLink;
  messaging?: PluginMessaging;
  persistentState?: boolean;
  oauth?: {
    clientType: "public" | "confidential";
    registration?: "dynamic" | "manual";
    tokenEndpointAuthMethod?: "none" | "client_secret_post" | "client_secret_basic";
    shareClientCredentials?: boolean;
    /** False when this integration requires a server HTTPS callback. */
    supportsLoopbackRedirect?: boolean;
    /** OAuth for packaged MCP servers. The host keeps refresh tokens and client secrets. */
    authorizationServer?: {
      issuer: string;
      authorizationUrl: string;
      tokenUrl: string;
    };
    /** Only the current access token is passed to this environment variable. */
    accessTokenEnv?: string;
  };
}
export interface PluginDefinition {
  schemaVersion?: 1;
  key: string;
  version: string;
  name: string;
  description: string;
  publisher: string;
  category: string;
  featured: boolean;
  components: Array<"skills" | "mcp" | "rules" | "commands" | "agents" | "hooks">;
  connections: PluginConnectorDefinition[];
  skills: PluginSkillDefinition[];
  homepageUrl?: string | null;
  sourceUrl?: string | null;
  sourceRevision?: string | null;
  /** Immutable provider files. Host setup and account configuration stay outside this tree. */
  upstream?: {
    repository: string;
    revision: string;
    directory: string;
    delivery: "bundled" | "install" | "reference";
    license: string | null;
    /** SHA-256 of each original file, relative to the upstream package root. */
    files: Record<string, string>;
  };
  logoUrl?: string | null;
  /** Relative PNG, JPEG or WebP path in binaryFiles; rendered without a network request. */
  icon?: string | null;
  /** Steps to install and validate this package, separate from provider registration. */
  installationSteps?: string[];
  setupFields?: PluginField[];
  setup?: PluginSetup | null;
  /** UTF-8 package files, including skill assets. No installed values belong here. */
  files?: Record<string, string>;
  binaryFiles?: Record<string, string>;
}
export interface PackagePreview {
  definition: PluginDefinition;
  warnings: string[];
  format: "outcomego" | "agent-plugin" | "cursor-plugin";
}
export type SecretEdit =
  | { action: "keep" }
  | { action: "clear" }
  | { action: "replace"; value: string };
