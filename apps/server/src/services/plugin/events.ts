import { PLUGIN_EVENT_POLL_DEFAULT_SECONDS } from "@outcomego/plugin-sdk";
import { Prisma, type PrismaClient } from "@outcomego/db";
import { parseAutomationEvent, type AutomationEvent } from "@outcomego/messaging";
import { toJson } from "../service-utils";
import { definitionFromManifest, jsonObject } from "./values";

/** The fields a connector call needs; see PluginTransport.callHostTool. A remote MCP
 * connection also names its transport, connector, endpoint and authentication. */
export type PollableConnection = {
  id: string;
  configuration: Prisma.JsonValue;
  credentials: Prisma.JsonValue;
  runtimeGeneration: number;
  transport?: string;
  connectorKey?: string;
  endpoint?: string | null;
  authType?: string;
};
type CallHostTool = (
  connection: PollableConnection,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
) => Promise<unknown>;
type DispatchEvent = (event: AutomationEvent) => Promise<unknown>;

const MAX_EVENTS_PER_POLL = 50;
/** A remote server that stops answering must not hold up the other accounts' polls. */
const REMOTE_POLL_TIMEOUT_MS = 30_000;
/** The namespaced ID `plugin:<plugin>:<connection>:<id>` must fit the 256 characters an event ID allows. */
const MAX_PLUGIN_EVENT_ID_LENGTH = 150;
/** A `plugin` source whose server does not publish the poll tool yet is asked again this rarely. */
const UNSUPPORTED_RETRY_MS = 15 * 60_000;
const TICK_MS = 15_000;
const FAILURE_LOG_INTERVAL_MS = 10 * 60_000;

/**
 * The server answered that it has no such tool, as a server does before the version that adds
 * it is deployed. JSON-RPC `-32601`, or the same wording in a tool error.
 */
export const isUnsupportedPollTool = (error: unknown): boolean => {
  if ((error as { code?: unknown } | null)?.code === -32601) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b(unknown tool|tool not found|no such tool|method not found)\b/i.test(message);
};

/** A connector tool result is MCP content: JSON text, or structuredContent. */
export const parsePollResult = (raw: unknown): { events: unknown[]; cursor: unknown } => {
  const result = jsonObject(raw);
  const text = Array.isArray(result.content)
    ? result.content
        .map((part) => jsonObject(part))
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => String(part.text))
        .join("\n")
    : "";
  if (result.isError === true) throw new Error(text.slice(0, 500) || "The event poll failed");
  let value: unknown = result.structuredContent;
  if (value === undefined) {
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("The event poll returned unreadable output");
    }
  }
  const body = jsonObject(value);
  if (!Array.isArray(body.events)) throw new Error("The event poll returned no events list");
  return { events: body.events, cursor: body.cursor ?? null };
};

/**
 * The manifest, not the connector's output, decides which trigger type an event can fire.
 * A generic `plugin` event is also stamped with the plugin and account it came from, and its
 * ID is namespaced, so one plugin can neither impersonate another nor collide with it.
 */
export const hostFields = (
  raw: Record<string, unknown>,
  source: string,
  connectionId: string,
  identity: { pluginKey: string; alias: string }
): Record<string, unknown> => {
  if (source !== "plugin") return { ...raw, source };
  if (typeof raw.id !== "string" || !raw.id.trim() || raw.id.length > MAX_PLUGIN_EVENT_ID_LENGTH)
    throw new Error(`A plugin event needs an ID of 1 to ${MAX_PLUGIN_EVENT_ID_LENGTH} characters`);
  return {
    ...raw,
    id: `plugin:${identity.pluginKey}:${connectionId}:${raw.id}`,
    source,
    plugin: identity.pluginKey,
    account: identity.alias,
  };
};

/**
 * Deployment-wide plugin event sources. A packaged connector that declares
 * `events.pollTool` is called on its interval with the last cursor it returned.
 * Each returned event runs every matching routine once (delivery IDs dedupe
 * repeats), and only then is the new cursor saved.
 */
export class PluginEventPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private readonly failureLoggedAt = new Map<string, number>();
  private readonly unsupportedLogged = new Set<string>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly callHostTool: CallHostTool,
    private readonly dispatch: DispatchEvent,
    private readonly now: () => Date = () => new Date(),
    private readonly remoteTimeoutMs = REMOTE_POLL_TIMEOUT_MS
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pollDue(), TICK_MS);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  pollDue(): Promise<void> {
    // One pass at a time in this process; the claim below covers other processes.
    // A database outage skips this pass; the next tick retries.
    this.running ??= this.pollAll()
      .catch((error) => {
        console.warn(`Plugin event poll failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async pollAll() {
    const connections = await this.prisma.pluginConnection.findMany({
      where: { status: "ready", transport: { in: ["stdio", "http"] }, installation: { status: "installed" } },
      select: {
        id: true,
        alias: true,
        transport: true,
        endpoint: true,
        authType: true,
        connectorKey: true,
        configuration: true,
        credentials: true,
        runtimeGeneration: true,
        eventCursor: true,
        installation: { select: { pluginKey: true, manifest: true } },
      },
    });
    for (const connection of connections) {
      const events = definitionFromManifest(connection.installation.manifest)?.connections.find(
        (connector) => connector.key === connection.connectorKey
      )?.events;
      if (!events) continue;
      const label = `${connection.installation.pluginKey}/${connection.alias}`;
      try {
        await this.pollConnection(connection, events, label, {
          pluginKey: connection.installation.pluginKey,
          alias: connection.alias,
        });
        this.failureLoggedAt.delete(connection.id);
      } catch (error) {
        const last = this.failureLoggedAt.get(connection.id) ?? 0;
        if (this.now().getTime() - last >= FAILURE_LOG_INTERVAL_MS) {
          this.failureLoggedAt.set(connection.id, this.now().getTime());
          console.warn(
            `Plugin event poll failed for ${label}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  }

  private async pollConnection(
    connection: PollableConnection & { eventCursor: Prisma.JsonValue | null },
    events: { pollTool: string; source: string; intervalSeconds?: number },
    label: string,
    identity: { pluginKey: string; alias: string }
  ) {
    const now = this.now();
    const interval = (events.intervalSeconds ?? PLUGIN_EVENT_POLL_DEFAULT_SECONDS) * 1000;
    // A conditional claim keeps concurrent server processes from polling one account twice.
    const claimed = await this.prisma.pluginConnection.updateMany({
      where: {
        id: connection.id,
        OR: [
          { eventsPolledAt: null },
          { eventsPolledAt: { lte: new Date(now.getTime() - interval + TICK_MS / 2) } },
        ],
      },
      data: { eventsPolledAt: now },
    });
    if (!claimed.count) return;
    let result: ReturnType<typeof parsePollResult>;
    try {
      result = parsePollResult(
        await this.callHostTool(
          connection,
          events.pollTool,
          { cursor: connection.eventCursor ?? null },
          connection.transport === "http" ? AbortSignal.timeout(this.remoteTimeoutMs) : undefined
        )
      );
    } catch (error) {
      // Only the generic source can outrun its server: an older DSH-WEB has no poll tool yet.
      // That is not a failure. Wait quietly, then ask again, so it works once the server is upgraded.
      if (events.source !== "plugin" || !isUnsupportedPollTool(error)) throw error;
      await this.prisma.pluginConnection.updateMany({
        where: { id: connection.id },
        data: { eventsPolledAt: new Date(now.getTime() + UNSUPPORTED_RETRY_MS - interval) },
      });
      if (!this.unsupportedLogged.has(connection.id)) {
        this.unsupportedLogged.add(connection.id);
        console.warn(
          `Plugin ${label} does not publish its event tool "${events.pollTool}" yet; checking again every ${UNSUPPORTED_RETRY_MS / 60_000} minutes`
        );
      }
      return;
    }
    this.unsupportedLogged.delete(connection.id);
    if (result.events.length > MAX_EVENTS_PER_POLL)
      console.warn(
        `Plugin event poll for ${label} returned ${result.events.length} events; only the first ${MAX_EVENTS_PER_POLL} run`
      );
    for (const raw of result.events.slice(0, MAX_EVENTS_PER_POLL)) {
      let event: AutomationEvent;
      try {
        event = parseAutomationEvent(hostFields(jsonObject(raw), events.source, connection.id, identity));
      } catch (error) {
        console.warn(
          `Plugin event from ${label} was rejected: ${error instanceof Error ? error.message : String(error)}`
        );
        continue;
      }
      // A dispatch failure leaves the cursor in place, so the poll is retried.
      await this.dispatch(event);
    }
    await this.prisma.pluginConnection.updateMany({
      where: { id: connection.id, runtimeGeneration: connection.runtimeGeneration },
      data: { eventCursor: result.cursor === null ? Prisma.DbNull : toJson(result.cursor) },
    });
  }
}
