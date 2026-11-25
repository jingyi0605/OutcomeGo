import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  FetchFunction,
  Model,
  Provider,
  StreamOptions,
  Tool,
  ToolCall,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

/** Anonymous key OpenCode CLI sends when signed out; Zen's free models accept it. */
export const OPENCODE_ANONYMOUS_KEY = "public";
export const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";
export const OPENCODE_MIN_VERSION = "2.2.5";
const OPENCODE_UPDATER_URL = "https://opencode.ai/update/api/latest/cli/npm";
const OPENCODE_VERSION_TTL_MS = 6 * 60 * 60 * 1000;
const OPENCODE_SESSION_KEEP = 1000;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const OPENCODE_FREE_IDS = new Set(["big-pickle", "grok-code"]);
export const OPENCODE_TOOLS = ["edit", "glob", "grep", "read", "shell"] as const;
export const OPENCODE_STUB_DESCRIPTION = "Not available in this session. Never call this tool.";
export const ZEN_STUB_NOTE = "(The model asked for a tool this session doesn't have.)";

/** OpenCode 2.2.5 core tool JSON schemas required by Zen's free tier. */
export const OPENCODE_TOOL_SCHEMAS: Readonly<Record<(typeof OPENCODE_TOOLS)[number], Record<string, unknown>>> = {
  edit: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to edit" },
      oldString: { type: "string", description: "Exact text to find and replace" },
      newString: {
        type: "string",
        description: "Text to replace oldString with (must differ from oldString)",
      },
      replaceAll: {
        type: "boolean",
        description:
          "Whether to replace every occurrence of oldString. When false, oldString must match exactly once. Defaults to false.",
      },
    },
    required: ["path", "oldString", "newString"],
    additionalProperties: false,
  },
  glob: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern to match files against" },
      path: {
        type: "string",
        description: "Directory to search. Defaults to the current working directory.",
      },
      hidden: { type: "boolean", description: "Include hidden files and directories (default: false)." },
      limit: {
        type: "integer",
        exclusiveMinimum: 0,
        description: "Maximum number of matching files to return (default: 100)",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  grep: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        minLength: 1,
        description: "Regular expression or literal text to match in file contents.",
      },
      path: {
        type: "string",
        description: "File or directory to search. Defaults to the current working directory.",
      },
      include: {
        type: "string",
        description: 'Glob pattern to filter files (for example, "*.js" or "*.{ts,tsx}")',
      },
      literal: {
        type: "boolean",
        description: "Treat `pattern` as exact text instead of a regular expression (default: false).",
      },
      caseSensitive: { type: "boolean", description: "Use case-sensitive matching (default: true)." },
      limit: {
        type: "integer",
        exclusiveMinimum: 0,
        description: "Maximum number of matching lines to return (default: 100)",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  read: {
    type: "object",
    properties: {
      path: { type: "string", description: "File or directory to read" },
      offset: {
        type: "integer",
        minimum: 0,
        description: "The line or directory entry to start reading from (1-based)",
      },
      limit: {
        type: "integer",
        minimum: 0,
        description: "The maximum number of lines or directory entries to read (defaults to and capped at 2000)",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  shell: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command string to execute" },
      workdir: {
        type: "string",
        description:
          "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.",
      },
      timeout: {
        type: "integer",
        minimum: 0,
        description:
          "Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default.",
      },
      background: {
        type: "boolean",
        description:
          "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
};

export interface OpenCodeRequestOptions {
  opencodeCwd?: string;
}

const isOpenCodeHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  return host === "opencode.ai" || host.endsWith(".opencode.ai");
};

/** Whether the URL points to OpenCode's gateway (Zen, Go, or inference). */
export const isOpenCodeUrl = (rawUrl: string): boolean => {
  try {
    return isOpenCodeHost(new URL(rawUrl.trim()).hostname);
  } catch {
    return false;
  }
};

/** Whether the URL points to OpenCode Zen (excluding OpenCode Go). */
export const isOpenCodeZenUrl = (rawUrl: string): boolean => {
  try {
    const parsed = new URL(rawUrl.trim());
    if (!isOpenCodeHost(parsed.hostname)) return false;
    return !/^\/zen\/go(?:\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
};

/** Non-chat entries listed by Zen's /models endpoint that should stay hidden. */
export const isOpenCodeExcludedModel = (modelId: string): boolean =>
  modelId === "test" || modelId.startsWith("jev-");

/** Whether `modelId` is a Zen free model served only to OpenCode-shaped requests. */
export const isOpenCodeFreeModel = (
  modelId: string,
  model?: Pick<Model<string>, "provider" | "baseUrl" | "cost">
): boolean => {
  if (model && model.provider !== "opencode" && !isOpenCodeZenUrl(model.baseUrl)) {
    return false;
  }
  if (isOpenCodeExcludedModel(modelId)) return false;
  if (modelId.endsWith("-free") || OPENCODE_FREE_IDS.has(modelId)) return true;
  return Boolean(model?.cost && model.cost.input === 0 && model.cost.output === 0);
};

/** Rewrites Zen's base URL to OpenCode 2's /inference/{openai,anthropic} paths for free models. */
export const openCodeFreeUrl = (rawUrl: string, api: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return rawUrl;
  }
  if (!parsed.protocol || !isOpenCodeHost(parsed.hostname)) return rawUrl;
  let rest: string | null = null;
  if (parsed.pathname.startsWith("/zen")) rest = parsed.pathname.slice(4);
  else if (parsed.pathname.startsWith("/inference")) rest = parsed.pathname.slice(10);
  if (rest === null || (rest !== "" && !rest.startsWith("/"))) return rawUrl;
  const under = (dir: string) => rest === dir || rest.startsWith(`${dir}/`);
  if (under("/go") || under("/openai") || under("/anthropic") || under("/google") || under("/systemone")) {
    return rawUrl;
  }
  if (api === "openai-completions" || api === "openai-responses") {
    parsed.pathname = `/inference/openai${rest}`;
  } else if (api === "anthropic-messages") {
    parsed.pathname = `/inference/anthropic${rest}`;
  } else {
    parsed.pathname = `/inference${rest}`;
  }
  return parsed.toString().replace(/\/+$/, "");
};

// Version updater state (checked at most once every 6 hours, skipped under test runners).
let versionState = {
  version: "",
  checkedAt: 0,
  asking: false,
};

const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;

const versionAtLeast = (a: string, b: string): boolean => {
  const x = a.split(".").map((n) => Number.parseInt(n, 10));
  const y = b.split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return true;
};

const isTestEnvironment = (): boolean =>
  process.env.NODE_ENV === "test" ||
  process.env.BUN_ENV === "test" ||
  process.env.PI_OFFLINE === "1" ||
  Boolean(process.env.BUN_TEST);

/** Queries OpenCode's npm updater endpoint; returns "" on any failure or older version. */
export const fetchLatestOpenCodeVersion = async (
  updaterUrl = OPENCODE_UPDATER_URL,
  current = OPENCODE_MIN_VERSION,
  fetchImpl: FetchFunction = fetch
): Promise<string> => {
  try {
    const response = await fetchImpl(`${updaterUrl}?current=${encodeURIComponent(current)}`, {
      signal: AbortSignal.timeout(3_000),
      redirect: "error",
    });
    if (!response.ok) return "";
    const body = (await response.json()) as { version?: unknown };
    const candidate = typeof body?.version === "string" ? body.version : "";
    if (!VERSION_RE.test(candidate) || !versionAtLeast(candidate, OPENCODE_MIN_VERSION)) return "";
    return candidate;
  } catch {
    return "";
  }
};

/** Returns the OpenCode CLI User-Agent string, refreshing the latest version in the background. */
export const openCodeUserAgent = (updaterUrl = OPENCODE_UPDATER_URL): string => {
  const current = versionState.version || OPENCODE_MIN_VERSION;
  const now = Date.now();
  const stale = now - versionState.checkedAt >= OPENCODE_VERSION_TTL_MS;
  const skipNetwork = isTestEnvironment() && updaterUrl === OPENCODE_UPDATER_URL;
  if (!versionState.asking && stale && !skipNetwork) {
    versionState.asking = true;
    void fetchLatestOpenCodeVersion(updaterUrl, current)
      .then((found) => {
        if (found) versionState.version = found;
      })
      .finally(() => {
        versionState.checkedAt = Date.now();
        versionState.asking = false;
      });
  }
  return `opencode/latest/${current}/cli`;
};

export const resetOpenCodeVersionForTests = (): void => {
  versionState = { version: "", checkedAt: 0, asking: false };
};

// Session ID and trace caches (LRU up to OPENCODE_SESSION_KEEP entries).
let lastIdMs = -1;
let idCounter = 0;
const sessionCache = new Map<string, string>();
const traceCache = new Map<string, string>();

const lruGet = (cache: Map<string, string>, key: string): string | undefined => {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
};

const lruSet = (cache: Map<string, string>, key: string, value: string): void => {
  if (cache.has(key)) cache.delete(key);
  else if (cache.size >= OPENCODE_SESSION_KEEP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
};

const OPENCODE_ID_RE = /^[a-z]{3}_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

/** Generates an OpenCode identifier matching `packages/schema/src/identifier.ts`. */
export const openCodeNewId = (prefix = "ses", descending = true, nowMs = Date.now()): string => {
  if (nowMs !== lastIdMs) {
    lastIdMs = nowMs;
    idCounter = 0;
  }
  idCounter += 1;
  let current = BigInt(nowMs) * 0x1000n + BigInt(idCounter);
  if (descending) current = ~current;
  const hexTime = (current & 0xffffffffffffn).toString(16).padStart(12, "0");
  const bytes = randomBytes(14);
  let suffix = "";
  for (const byte of bytes) suffix += BASE62[byte % BASE62.length];
  return `${prefix}_${hexTime}${suffix}`;
};

/** Whether `id` matches OpenCode's descending `ses_` identifier shape. */
export const openCodeRealSession = (id: string): boolean => {
  if (!id.startsWith("ses_") || !OPENCODE_ID_RE.test(id)) return false;
  const low = Number.parseInt(id.slice(13, 16), 16);
  return Number.isFinite(low) && 0xfff - low < 16;
};

/** Returns a stable `ses_` id for `seed`, or a fresh one when `seed` is empty. */
export const openCodeSession = (seed: string): string => {
  if (openCodeRealSession(seed)) return seed;
  if (!seed) return openCodeNewId("ses", true);
  const existing = lruGet(sessionCache, seed);
  if (existing) return existing;
  const id = openCodeNewId("ses", true);
  lruSet(sessionCache, seed, id);
  return id;
};

/** Generates OpenCode's `b3` and `traceparent` headers: one trace per session, new span per request. */
export const openCodeTrace = (sessionId: string): { b3: string; traceparent: string } => {
  let trace = lruGet(traceCache, sessionId);
  if (!trace) {
    trace = randomBytes(16).toString("hex");
    lruSet(traceCache, sessionId, trace);
  }
  const span = randomBytes(8).toString("hex");
  const parent = randomBytes(8).toString("hex");
  return {
    b3: `${trace}-${span}-1-${parent}`,
    traceparent: `00-${trace}-${span}-01`,
  };
};

const openCodeLocalDir = (dir: string): string => {
  let resolved = dir;
  if (resolved === "~" || resolved.startsWith("~/")) {
    resolved = join(homedir(), resolved.slice(1));
  }
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
};

const remotePath = (rawValue: string): string => {
  const input = rawValue.trim();
  if (!input) return "";
  const format = (host: string, pathname: string): string => {
    const cleaned = pathname.replace(/^\/+/, "").replace(/\.git\/?$/, "").replace(/\/+$/, "");
    return host && cleaned ? `${host.toLowerCase()}/${cleaned}` : "";
  };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    try {
      const parsed = new URL(input);
      if (parsed.protocol.toLowerCase() === "file:") return "";
      return format(parsed.hostname, parsed.pathname);
    } catch {
      return "";
    }
  }
  const scp = input.match(/^([^@/:]+@)?([^/:]+):(.+)$/);
  return scp ? format(scp[2]!, scp[3]!) : "";
};

const openCodeRepository = (
  dir: string
): { root: string; remote: string; isRepo: boolean } => {
  let current = dir;
  for (;;) {
    const dotGit = join(current, ".git");
    if (existsSync(dotGit)) {
      let common = dotGit;
      try {
        if (!statSync(dotGit).isDirectory()) {
          const content = readFileSync(dotGit, "utf8");
          const match = content.match(/^gitdir:\s*(.+)$/m);
          if (!match?.[1]?.trim()) return { root: "", remote: "", isRepo: false };
          const own = isAbsolute(match[1].trim())
            ? match[1].trim()
            : resolve(current, match[1].trim());
          common = own;
          const commondirPath = join(own, "commondir");
          if (existsSync(commondirPath)) {
            const shared = readFileSync(commondirPath, "utf8").trim();
            common = isAbsolute(shared) ? shared : resolve(own, shared);
          }
        }
        const config = readFileSync(join(common, "config"), "utf8");
        const remoteRe = /^\s*\[remote\s+"([^"]+)"\]([^\[]*)/gm;
        let first = "";
        let origin = "";
        let sawOrigin = false;
        for (const match of config.matchAll(remoteRe)) {
          const urlMatch = match[2]?.match(/^\s*url\s*=\s*(.+)$/m);
          const urlValue = urlMatch?.[1] ?? "";
          if (!first) first = urlValue;
          if (match[1] === "origin") {
            origin = urlValue;
            sawOrigin = true;
            break;
          }
        }
        const chosen = sawOrigin ? origin : first;
        return { root: current, remote: remotePath(chosen), isRepo: true };
      } catch {
        return { root: current, remote: "", isRepo: true };
      }
    }
    const parent = dirname(current);
    if (parent === current) return { root: "", remote: "", isRepo: false };
    current = parent;
  }
};

/** Computes OpenCode's `x-opencode-project` SHA-1 project ID for `dir`. */
export const openCodeProject = (dir = ""): string => {
  const target = dir || homedir();
  const local = openCodeLocalDir(target);
  const { root, remote, isRepo } = openCodeRepository(local);
  const key = remote
    ? `git-remote:${remote}`
    : isRepo
      ? `directory:${root}`
      : `directory:${local}`;
  return createHash("sha1").update(key).digest("hex");
};

const ENVIRONMENT_RE = /<env>[\s\S]*Working directory:[\s\S]*<\/env>/;

/** Whether `systemPrompt` already includes OpenCode's `<env>` block. */
export const openCodeHasEnvironment = (systemPrompt: string): boolean =>
  ENVIRONMENT_RE.test(systemPrompt);

/** Builds OpenCode 2.2.5's environment block for `dir` (home folder when empty). */
export const openCodeEnvironment = (dir = ""): string => {
  const effectiveDir = dir || homedir();
  const local = openCodeLocalDir(effectiveDir);
  const { root, isRepo } = openCodeRepository(local);
  const workspace = isRepo && root !== local ? root : effectiveDir;
  let tempDir = tmpdir();
  try {
    tempDir = realpathSync(tempDir);
  } catch {
    // Keep tmpdir() as-is when symlink resolution is unavailable.
  }
  return [
    "Here is some useful information about the environment you are running in:",
    "<env>",
    `  Working directory: ${effectiveDir}`,
    `  Workspace root folder: ${workspace}`,
    `  Is directory a git repo: ${isRepo ? "yes" : "no"}`,
    `  Platform: ${process.platform}`,
    `  Prefer ${join(tempDir, "opencode")} over generic system temporary directories such as /tmp; it is pre-created and approved for external access.`,
    "</env>",
  ].join("\n");
};

const normalizeOpenCodeDir = (dir: string): string => {
  if (!dir || dir === "/" || dir === "~/") return "";
  if (
    dir.startsWith("/") ||
    dir.startsWith("~/") ||
    dir.startsWith("\\\\") ||
    (dir.length >= 3 && dir[1] === ":" && (dir[2] === "\\" || dir[2] === "/"))
  ) {
    return dir;
  }
  return "";
};

/** Applies OpenCode 2.2.5 client headers onto `headers` for a conversation turn. */
export const applyOpenCodeClientHeaders = (
  headers: Headers,
  sessionSeed: string,
  dir = "",
  userAgent = openCodeUserAgent()
): void => {
  const id = openCodeSession(sessionSeed);
  const { b3, traceparent } = openCodeTrace(id);
  headers.set("User-Agent", userAgent);
  headers.set("b3", b3);
  headers.set("traceparent", traceparent);
  headers.set("x-opencode-client", "cli");
  headers.set("x-opencode-project", openCodeProject(normalizeOpenCodeDir(dir)));
  for (const key of ["x-opencode-session", "x-opencode-session-id", "x-session-affinity", "x-session-id"]) {
    headers.set(key, id);
  }
  headers.delete("x-opencode-request");
  headers.set("Accept", "*/*");
};

/** Ensures stateless requests to OpenCode's gateway (such as /v1/models) carry session headers. */
export const applyOpenCodeSessionHeaders = (headers: Headers, url: string): void => {
  if (!isOpenCodeUrl(url)) return;
  if (!headers.get("x-opencode-session")) {
    const id = openCodeSession("");
    headers.set("x-opencode-session", id);
    headers.set("x-opencode-session-id", id);
  }
  if (!headers.get("User-Agent")) headers.set("User-Agent", openCodeUserAgent());
  if (!headers.get("x-opencode-client")) headers.set("x-opencode-client", "cli");
};

export interface ZenToolsMapping {
  /** Upstream OpenCode tool name -> caller's original tool name. */
  back: Map<string, string>;
  /** Caller's original tool name -> upstream OpenCode tool name. */
  to: Map<string, string>;
  /** Core OpenCode tool names added only as stubs. */
  stubs: Set<string>;
}

/**
 * Adapts `context` for Zen's free tier: renames matching core tools to lowercase
 * (`Read` -> `read`, `Shell` -> `shell`), adds stubs for missing core tools, updates
 * historical tool calls, and appends OpenCode's `<env>` block to `systemPrompt`.
 */
export const prepareZenFreeContext = (
  context: Context,
  dir = ""
): { context: Context; mapping: ZenToolsMapping } => {
  const back = new Map<string, string>();
  const to = new Map<string, string>();
  const stubs = new Set<string>();
  const tools: Tool[] = (context.tools ?? []).map((tool) => ({ ...tool }));

  for (const need of OPENCODE_TOOLS) {
    let idx = tools.findIndex((tool) => tool.name === need);
    if (idx < 0) {
      idx = tools.findIndex((tool) => tool.name.toLowerCase() === need);
    }
    if (idx >= 0) {
      const existing = tools[idx]!;
      if (existing.name !== need) {
        back.set(need, existing.name);
        to.set(existing.name, need);
        tools[idx] = { ...existing, name: need };
      }
      continue;
    }
    stubs.add(need);
    tools.push({
      name: need,
      description: OPENCODE_STUB_DESCRIPTION,
      parameters: OPENCODE_TOOL_SCHEMAS[need] as unknown as Tool["parameters"],
    });
  }

  let systemPrompt = context.systemPrompt ?? "";
  if (!openCodeHasEnvironment(systemPrompt)) {
    const env = openCodeEnvironment(normalizeOpenCodeDir(dir));
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${env}` : env;
  }

  const messages =
    to.size === 0
      ? context.messages
      : context.messages.map((message) => {
          if (message.role === "assistant" && Array.isArray(message.content)) {
            let changed = false;
            const nextContent = message.content.map((part) => {
              if (part.type === "toolCall" && to.has(part.name)) {
                changed = true;
                return { ...part, name: to.get(part.name)! };
              }
              return part;
            });
            return changed ? { ...message, content: nextContent } : message;
          }
          if (message.role === "toolResult" && to.has(message.toolName)) {
            return { ...message, toolName: to.get(message.toolName)! };
          }
          return message;
        });

  return {
    context: { ...context, systemPrompt, messages, tools },
    mapping: { back, to, stubs },
  };
};

/** Ensures streamed request shape, renamed `tool_choice`, and `strict: false` on Chat tools. */
export const transformZenFreePayload = (
  payload: unknown,
  api: string,
  to: ReadonlyMap<string, string>
): unknown => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const body: Record<string, unknown> = { ...(payload as Record<string, unknown>), stream: true };

  if (api === "openai-completions" && Array.isArray(body.tools)) {
    body.tools = body.tools.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      const item = entry as Record<string, unknown>;
      if (item.type !== "function" || !item.function || typeof item.function !== "object") return entry;
      const fn = item.function as Record<string, unknown>;
      if (fn.strict !== undefined) return entry;
      return { ...item, function: { ...fn, strict: false } };
    });
  }

  if (to.size > 0 && body.tool_choice && typeof body.tool_choice === "object") {
    const tc = body.tool_choice as Record<string, unknown>;
    if (
      api === "openai-completions" &&
      tc.type === "function" &&
      tc.function &&
      typeof tc.function === "object"
    ) {
      const fn = tc.function as Record<string, unknown>;
      if (typeof fn.name === "string" && to.has(fn.name)) {
        body.tool_choice = { ...tc, function: { ...fn, name: to.get(fn.name)! } };
      }
    } else if (
      (api === "openai-responses" && tc.type === "function" && typeof tc.name === "string" && to.has(tc.name)) ||
      (api === "anthropic-messages" && tc.type === "tool" && typeof tc.name === "string" && to.has(tc.name))
    ) {
      body.tool_choice = { ...tc, name: to.get(tc.name as string)! };
    }
  }

  return body;
};

const ERROR_KEYS = new Set([
  "error",
  "message",
  "msg",
  "code",
  "type",
  "param",
  "detail",
  "reason",
  "description",
]);

/**
 * Rewrites OpenCode's bare 400 (e.g. `{"model":"..."}` with no error field) to 502
 * so pi-ai's transient retry recovers from it instead of failing the turn immediately.
 */
const handleOpenCodeBareRefusal = async (url: string, response: Response): Promise<Response> => {
  if (response.status !== 400 || !isOpenCodeUrl(url) || !response.body) return response;
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw.trim()) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed);
      if (!keys.some((key) => ERROR_KEYS.has(key))) {
        const snippet = raw.trim().slice(0, 200);
        return new Response(
          JSON.stringify({
            error: {
              message: `OpenCode answered 400 with ${snippet}, which is no error, not an API reply`,
            },
          }),
          { status: 502, headers: { "content-type": "application/json" } }
        );
      }
    }
  } catch {
    // Non-JSON 400 responses pass through untouched.
  }
  return new Response(raw, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

const ZEN_KEPT_HEADERS = new Set([
  "content-type",
  "authorization",
  "x-api-key",
  "anthropic-version",
  "anthropic-beta",
]);

/** Creates a fetch wrapper that sets OpenCode headers and strips SDK fingerprints on Zen Free. */
export const createOpenCodeFetch = (
  baseFetch: FetchFunction,
  opts: { zenFree: boolean; sessionSeed: string; dir: string; userAgent?: string }
): FetchFunction => {
  return (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const incoming = new Headers(
      init?.headers ?? (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined)
    );
    const headers = opts.zenFree ? new Headers() : incoming;
    if (opts.zenFree) {
      for (const [key, value] of incoming.entries()) {
        if (ZEN_KEPT_HEADERS.has(key.toLowerCase())) headers.set(key, value);
      }
    }
    if (isOpenCodeUrl(url)) {
      applyOpenCodeClientHeaders(headers, opts.sessionSeed, opts.dir, opts.userAgent);
    }
    const response = await baseFetch(input, { ...init, headers });
    return handleOpenCodeBareRefusal(url, response);
  }) as FetchFunction;
};

const rewriteMessageContent = (
  message: AssistantMessage,
  mapping: ZenToolsMapping
): { message: AssistantMessage; indexMap: Map<number, number> } => {
  const indexMap = new Map<number, number>();
  const nextContent: AssistantMessage["content"] = [];
  for (let i = 0; i < message.content.length; i++) {
    const part = message.content[i]!;
    if (part.type === "toolCall") {
      if (mapping.stubs.has(part.name)) continue;
      const mappedName = mapping.back.get(part.name) ?? part.name;
      indexMap.set(i, nextContent.length);
      nextContent.push(mappedName === part.name ? part : { ...part, name: mappedName });
    } else {
      indexMap.set(i, nextContent.length);
      nextContent.push(part);
    }
  }
  return { message: { ...message, content: nextContent }, indexMap };
};

/**
 * Translates an upstream AssistantMessageEventStream back to the caller's tool names
 * and drops calls to stub tools that OpenTeam does not provide.
 */
export const transformZenFreeStream = (
  inner: AssistantMessageEventStream | Promise<AssistantMessageEventStream>,
  mapping: ZenToolsMapping
): AssistantMessageEventStream => {
  const out = createAssistantMessageEventStream();
  void (async () => {
    const dropped = new Set<number>();
    let stubbed = false;
    let realCalls = 0;
    let saidText = false;
    try {
      for await (const event of await inner) {
        if (event.type === "start") {
          const { message } = rewriteMessageContent(event.partial, mapping);
          out.push({ type: "start", partial: message });
          continue;
        }
        if (event.type === "toolcall_start") {
          const rawPart = event.partial.content[event.contentIndex] as ToolCall | undefined;
          if (rawPart?.type === "toolCall" && mapping.stubs.has(rawPart.name)) {
            dropped.add(event.contentIndex);
            stubbed = true;
            continue;
          }
          const { message, indexMap } = rewriteMessageContent(event.partial, mapping);
          out.push({
            type: "toolcall_start",
            contentIndex: indexMap.get(event.contentIndex) ?? event.contentIndex,
            partial: message,
          });
          continue;
        }
        if (event.type === "toolcall_delta") {
          if (dropped.has(event.contentIndex)) continue;
          const { message, indexMap } = rewriteMessageContent(event.partial, mapping);
          out.push({
            type: "toolcall_delta",
            contentIndex: indexMap.get(event.contentIndex) ?? event.contentIndex,
            delta: event.delta,
            partial: message,
          });
          continue;
        }
        if (event.type === "toolcall_end") {
          if (dropped.has(event.contentIndex) || mapping.stubs.has(event.toolCall.name)) {
            dropped.add(event.contentIndex);
            stubbed = true;
            continue;
          }
          realCalls += 1;
          const mappedName = mapping.back.get(event.toolCall.name) ?? event.toolCall.name;
          const { message, indexMap } = rewriteMessageContent(event.partial, mapping);
          out.push({
            type: "toolcall_end",
            contentIndex: indexMap.get(event.contentIndex) ?? event.contentIndex,
            toolCall: mappedName === event.toolCall.name ? event.toolCall : { ...event.toolCall, name: mappedName },
            partial: message,
          });
          continue;
        }
        if (event.type === "text_delta" || event.type === "text_start" || event.type === "text_end") {
          if (event.type === "text_delta" && event.delta) saidText = true;
          const { message, indexMap } = rewriteMessageContent(event.partial, mapping);
          out.push({
            ...event,
            contentIndex: indexMap.get(event.contentIndex) ?? event.contentIndex,
            partial: message,
          } as AssistantMessageEvent);
          continue;
        }
        if (event.type === "thinking_start" || event.type === "thinking_delta" || event.type === "thinking_end") {
          const { message, indexMap } = rewriteMessageContent(event.partial, mapping);
          out.push({
            ...event,
            contentIndex: indexMap.get(event.contentIndex) ?? event.contentIndex,
            partial: message,
          } as AssistantMessageEvent);
          continue;
        }
        if (event.type === "done") {
          const { message } = rewriteMessageContent(event.message, mapping);
          let finalReason = event.reason;
          if (stubbed && realCalls === 0) {
            if (!saidText) {
              const notePart = { type: "text" as const, text: ZEN_STUB_NOTE };
              const partialWithNote: AssistantMessage = {
                ...message,
                content: [...message.content, notePart],
              };
              const contentIndex = message.content.length;
              out.push({ type: "text_start", contentIndex, partial: partialWithNote });
              out.push({ type: "text_delta", contentIndex, delta: ZEN_STUB_NOTE, partial: partialWithNote });
              out.push({ type: "text_end", contentIndex, content: ZEN_STUB_NOTE, partial: partialWithNote });
              message.content = partialWithNote.content;
            }
            if (message.stopReason === "toolUse") {
              message.stopReason = "stop";
              finalReason = "stop";
            }
          }
          out.push({ type: "done", reason: finalReason, message });
          out.end(message);
          return;
        }
        if (event.type === "error") {
          const { message } = rewriteMessageContent(event.error, mapping);
          out.push({ type: "error", reason: event.reason, error: message });
          out.end(message);
          return;
        }
      }
      out.end();
    } catch (error) {
      const fallback: AssistantMessage = {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "opencode",
        model: "",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
      out.push({ type: "error", reason: "error", error: fallback });
      out.end(fallback);
    }
  })();
  return out;
};

/** Runs an OpenCode Zen (or Go) provider stream call with Zen Free adaptation when applicable. */
export const runOpenCodeStream = <
  TModel extends Model<Api>,
  TOptions extends StreamOptions | undefined,
>(
  invoke: (
    model: TModel,
    context: Context,
    options?: TOptions
  ) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>,
  model: TModel,
  context: Context,
  options?: TOptions
): AssistantMessageEventStream => {
  const dir = (options as OpenCodeRequestOptions | undefined)?.opencodeCwd ?? "";
  const sessionSeed = (options as { sessionId?: string } | undefined)?.sessionId ?? "";
  const zenFree = isOpenCodeFreeModel(model.id, model);
  const baseFetch = options?.fetch ?? globalThis.fetch;
  const wrappedFetch = createOpenCodeFetch(baseFetch, { zenFree, sessionSeed, dir });

  if (!zenFree) {
    const result = invoke(model, context, { ...options, fetch: wrappedFetch } as TOptions);
    if (result instanceof Promise) {
      return transformZenFreeStream(result, { back: new Map(), to: new Map(), stubs: new Set() });
    }
    return result;
  }

  const adaptedModel: TModel = {
    ...model,
    baseUrl: openCodeFreeUrl(model.baseUrl, model.api),
  };
  const { context: adaptedContext, mapping } = prepareZenFreeContext(context, dir);
  const upstreamOnPayload = options?.onPayload;
  const adaptedOptions = {
    ...options,
    fetch: wrappedFetch,
    onPayload: async (payload: unknown, currentModel: Model<Api>) => {
      const next = upstreamOnPayload ? await upstreamOnPayload(payload, currentModel) : payload;
      return transformZenFreePayload(next ?? payload, adaptedModel.api, mapping.to);
    },
  } as TOptions;

  return transformZenFreeStream(invoke(adaptedModel, adaptedContext, adaptedOptions), mapping);
};

/** Wraps pi-ai's built-in `opencodeProvider` for Zen Free (`public` key) and discovery support. */
export const wrapOpenCodeProvider = (provider: Provider): Provider => ({
  ...provider,
  baseUrl: provider.baseUrl ?? OPENCODE_ZEN_BASE_URL,
  auth: {
    ...provider.auth,
    ...(provider.auth.apiKey
      ? {
          apiKey: {
            ...provider.auth.apiKey,
            login: async (interaction) => {
              interaction.signal.throwIfAborted();
              const key = (
                await interaction.prompt({
                  type: "secret",
                  message: "Enter public for free models, or paste your OpenCode API key",
                  placeholder: OPENCODE_ANONYMOUS_KEY,
                })
              ).trim();
              interaction.signal.throwIfAborted();
              if (!key) throw new Error("An OpenCode API key (or public) is required");
              return { type: "api_key", key };
            },
          },
        }
      : {}),
  },
  stream: (model, context, options) =>
    runOpenCodeStream(provider.stream.bind(provider), model, context, options),
  streamSimple: (model, context, options) =>
    runOpenCodeStream(provider.streamSimple.bind(provider), model, context, options),
});
