import { ApiError } from "@outcomego/contracts";
import {
  DEFAULT_FETCH_PROVIDER,
  WEB_PROVIDER_LISTS,
  WEB_TOOL_STRATEGIES,
  WEB_TOOLS,
  type WebProviderCheckRequest,
  type WebProviderCheckResult,
  type WebProviderFieldsInput,
  type WebProviderInfo,
  type WebProviderState,
  type WebProvidersInput,
  type WebProvidersView,
  type WebTool,
  type WebToolCredentials,
  type WebToolInput,
  type WebToolSchedule,
  type WebToolStrategy,
  webProviderInfo,
} from "@outcomego/contracts/web-search";
import type { PrismaClient } from "@outcomego/db";

const invalid = (message: string) => new ApiError(400, "invalid_web_provider_settings", message);
const ID = "global";
type Client = Pick<PrismaClient, "webSearchSettings" | "webFetchSettings" | "webToolProvider">;
type Row = { secret: string | null; check: WebProviderState["check"] };
type ToolState = {
  selected: string | null;
  schedule: WebToolSchedule;
  rows: Map<string, Row>;
};
type State = Record<WebTool, ToolState>;
export type WebProviderChecker = (request: WebProviderCheckRequest) => Promise<WebProviderCheckResult>;

export function validateWebApiKey(value: unknown): void {
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== "string" ||
      !value.trim() ||
      value.length > 20_000 ||
      /[\x00-\x1f\x7f]/.test(value) ||
      /\s/.test(value.trim()))
  )
    throw invalid("The API key is invalid.");
}

const isStrategy = (value: unknown): value is WebToolStrategy =>
  typeof value === "string" && WEB_TOOL_STRATEGIES.includes(value as WebToolStrategy);

function parseTool(tool: WebTool, input: unknown): WebToolInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid(`${tool} settings must be an object.`);
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["selected", "schedule", "providers"].includes(key)))
    throw invalid(`Unknown ${tool} setting.`);
  const parsed: WebToolInput = {};
  if (value.selected !== undefined) {
    if (value.selected !== null && !webProviderInfo(tool, value.selected))
      throw invalid(`Choose a ${tool} provider from the list.`);
    parsed.selected = value.selected as string | null;
  }
  if (value.schedule !== undefined) {
    if (!value.schedule || typeof value.schedule !== "object" || Array.isArray(value.schedule))
      throw invalid("schedule must be an object.");
    const schedule = value.schedule as Record<string, unknown>;
    if (Object.keys(schedule).some((key) => !["strategy", "providers"].includes(key)))
      throw invalid("Unknown schedule setting.");
    const next: NonNullable<WebToolInput["schedule"]> = {};
    if (schedule.strategy !== undefined) {
      if (!isStrategy(schedule.strategy)) throw invalid("Choose a valid provider usage strategy.");
      next.strategy = schedule.strategy;
    }
    if (schedule.providers !== undefined) {
      if (!Array.isArray(schedule.providers) || schedule.providers.some((id) => typeof id !== "string"))
        throw invalid("schedule.providers must be a list of provider names.");
      const ids = schedule.providers as string[];
      if (new Set(ids).size !== ids.length) throw invalid("A provider can only appear once in a schedule.");
      for (const id of ids) if (!webProviderInfo(tool, id)) throw invalid(`Unknown ${tool} provider.`);
      next.providers = ids;
    }
    parsed.schedule = next;
  }
  if (parsed.selected !== undefined && parsed.schedule?.providers !== undefined) {
    const first = parsed.schedule.providers[0] ?? null;
    if (parsed.selected !== first) throw invalid("selected must match the first provider in schedule.");
  }
  if (value.providers !== undefined) {
    if (!value.providers || typeof value.providers !== "object" || Array.isArray(value.providers))
      throw invalid("providers must map provider names to fields.");
    parsed.providers = {};
    for (const [id, fields] of Object.entries(value.providers)) {
      const info = webProviderInfo(tool, id);
      if (!info) throw invalid(`Unknown ${tool} provider.`);
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw invalid("Provider fields must be an object.");
      const entry: WebProviderFieldsInput = {};
      for (const [field, fieldValue] of Object.entries(fields)) {
        if (!info.fields.some((known) => known.id === field)) throw invalid(`${info.name} has no ${field} field.`);
        validateWebApiKey(fieldValue);
        if (fieldValue !== undefined) entry.apiKey = typeof fieldValue === "string" ? fieldValue.trim() : null;
      }
      parsed.providers[id] = entry;
    }
  }
  return parsed;
}

export function parseWebProviderSettings(input: unknown): WebProvidersInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("Web provider settings are required.");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !WEB_TOOLS.includes(key as WebTool))) throw invalid("Unknown web provider setting.");
  const parsed: WebProvidersInput = {};
  for (const tool of WEB_TOOLS) if (value[tool] !== undefined) parsed[tool] = parseTool(tool, value[tool]);
  return parsed;
}

const missingKey = (info: WebProviderInfo, row: Row | undefined) => info.fields.some((field) => field.required) && !row?.secret;
const sameKey = (a: Row | undefined, b: Row | undefined) => (a?.secret ?? null) === (b?.secret ?? null);
const validProviderIds = (tool: WebTool) => new Set(WEB_PROVIDER_LISTS[tool].map((info) => info.id));

function providerIds(tool: WebTool, raw: unknown): string[] | null {
  const allowed = validProviderIds(tool);
  if (Array.isArray(raw) && raw.every((id) => typeof id === "string") && new Set(raw).size === raw.length && raw.every((id) => allowed.has(id)))
    return raw as string[];
  return null;
}

function normalizeCursor(cursor: number, count: number): number {
  if (!count) return 0;
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor % count : 0;
}

/** Deployment-wide web search and fetch configuration; secrets never enter agent data or events. */
export class WebProviderSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly checker?: WebProviderChecker
  ) {}

  private async state(client: Client): Promise<State> {
    const [search, fetch, rows] = await Promise.all([
      client.webSearchSettings.findUnique({ where: { id: ID } }),
      client.webFetchSettings.findUnique({ where: { id: ID } }),
      client.webToolProvider.findMany(),
    ]);
    const searchProviders = search ? providerIds("search", search.providers) : [];
    const fetchProviders = fetch ? providerIds("fetch", fetch.providers) : [DEFAULT_FETCH_PROVIDER];
    if (
      !searchProviders ||
      !fetchProviders ||
      searchProviders.some((id) => !webProviderInfo("search", id)) ||
      fetchProviders.some((id) => !webProviderInfo("fetch", id)) ||
      (search?.strategy && !isStrategy(search.strategy)) ||
      (fetch?.strategy && !isStrategy(fetch.strategy))
    )
      throw new ApiError(503, "web_provider_settings_invalid", "Choose web providers again in Settings → Providers.");
    const state: State = {
      search: {
        selected: searchProviders[0] ?? null,
        schedule: { strategy: isStrategy(search?.strategy) ? search.strategy : "failover", providers: searchProviders, cursor: normalizeCursor(search?.cursor ?? 0, searchProviders.length) },
        rows: new Map(),
      },
      fetch: {
        selected: fetchProviders[0] ?? null,
        schedule: { strategy: isStrategy(fetch?.strategy) ? fetch.strategy : "failover", providers: fetchProviders, cursor: normalizeCursor(fetch?.cursor ?? 0, fetchProviders.length) },
        rows: new Map(),
      },
    };
    for (const row of rows) {
      if (!WEB_TOOLS.includes(row.tool as WebTool)) continue;
      state[row.tool as WebTool].rows.set(row.provider, {
        secret: row.secret,
        check:
          row.checkStatus && row.checkedAt
            ? { status: row.checkStatus as "passed" | "failed", message: row.checkMessage ?? "", checkedAt: row.checkedAt.toISOString() }
            : null,
      });
    }
    return state;
  }

  private viewOf(state: State): WebProvidersView {
    const tool = (name: WebTool) => ({
      selected: state[name].selected,
      schedule: state[name].schedule,
      providers: Object.fromEntries(
        WEB_PROVIDER_LISTS[name].map((info) => {
          const row = state[name].rows.get(info.id);
          return [info.id, { secretSaved: Boolean(row?.secret), ready: !missingKey(info, row), check: row?.check ?? null } satisfies WebProviderState];
        })
      ),
    });
    return { search: tool("search"), fetch: tool("fetch") } as WebProvidersView;
  }

  async view(): Promise<WebProvidersView> {
    return this.viewOf(await this.state(this.prisma));
  }

  /** Internal server → computer payload. Secrets never enter public settings responses. */
  async credentials(tool: WebTool): Promise<WebToolCredentials> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(742310, 1)::text`;
      const state = (await this.state(tx))[tool];
      const providers = state.schedule.providers;
      if (!providers.length) return { strategy: state.schedule.strategy, providers: [], cursor: 0 };
      const cursor = normalizeCursor(state.schedule.cursor, providers.length);
      const ordered = state.schedule.strategy === "round_robin" ? [...providers.slice(cursor), ...providers.slice(0, cursor)] : providers;
      const nextCursor = state.schedule.strategy === "round_robin" ? (cursor + 1) % providers.length : cursor;
      const table = tool === "search" ? tx.webSearchSettings : tx.webFetchSettings;
      await (table as typeof tx.webSearchSettings).upsert({
        where: { id: ID },
        create: { id: ID, providers, strategy: state.schedule.strategy, cursor: nextCursor },
        update: { cursor: nextCursor },
      });
      return {
        strategy: state.schedule.strategy,
        providers: ordered.map((provider) => ({ provider, apiKey: state.rows.get(provider)?.secret ?? null })),
        cursor,
      };
    });
  }

  async save(input: unknown): Promise<WebProvidersView> {
    const parsed = parseWebProviderSettings(input);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(742310, 1)::text`;
        const state = await this.state(tx);
        for (const tool of WEB_TOOLS) {
          const change = parsed[tool];
          if (!change) continue;
          const current = state[tool];
          const changed = new Set<string>();
          for (const [id, fields] of Object.entries(change.providers ?? {})) {
            const existing = current.rows.get(id) ?? { secret: null, check: null };
            if (fields.apiKey === undefined || fields.apiKey === existing.secret) continue;
            current.rows.set(id, { secret: fields.apiKey, check: null });
            changed.add(id);
          }
          let providers = current.schedule.providers;
          if (change.schedule?.providers !== undefined) providers = [...change.schedule.providers];
          else if (change.selected !== undefined) providers = change.selected ? [change.selected] : [];
          const strategy = change.schedule?.strategy ?? current.schedule.strategy;
          if (!isStrategy(strategy)) throw invalid("Choose a valid provider usage strategy.");
          for (const provider of providers) {
            const info = webProviderInfo(tool, provider)!;
            if (missingKey(info, current.rows.get(provider))) {
              throw invalid(
                change.providers?.[provider]?.apiKey === null
                  ? `${info.name} is used for ${tool}. Remove it from the provider schedule before removing its API key.`
                  : `Add the ${info.name} API key to use it for ${tool}.`
              );
            }
          }
          const cursor = providers.join("\u0000") === current.schedule.providers.join("\u0000") && strategy === current.schedule.strategy
            ? normalizeCursor(current.schedule.cursor, providers.length)
            : 0;
          current.schedule = { strategy, providers, cursor };
          current.selected = providers[0] ?? null;
          for (const id of changed) {
            const row = current.rows.get(id)!;
            await tx.webToolProvider.upsert({
              where: { tool_provider: { tool, provider: id } },
              create: { tool, provider: id, secret: row.secret },
              update: { secret: row.secret, checkStatus: null, checkMessage: null, checkedAt: null },
            });
          }
          const table = tool === "search" ? tx.webSearchSettings : tx.webFetchSettings;
          await (table as typeof tx.webSearchSettings).upsert({
            where: { id: ID },
            create: { id: ID, providers: current.schedule.providers, strategy: current.schedule.strategy, cursor: current.schedule.cursor },
            update: { providers: current.schedule.providers, strategy: current.schedule.strategy, cursor: current.schedule.cursor },
          });
        }
        return this.viewOf(state);
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "web_provider_settings_save_failed", "Could not save web provider settings. Check the database connection and retry.");
    }
  }

  /** Runs a real search or fetch with the saved configuration and stores the outcome. */
  async check(input: unknown): Promise<WebProvidersView> {
    const { tool, provider } = (input ?? {}) as Record<string, unknown>;
    if (!WEB_TOOLS.includes(tool as WebTool)) throw invalid("Choose search or fetch.");
    const info = webProviderInfo(tool as WebTool, provider);
    if (!info) throw invalid(`Unknown ${tool} provider.`);
    const before = (await this.state(this.prisma))[tool as WebTool].rows.get(info.id);
    if (missingKey(info, before)) throw invalid(`Add the ${info.name} API key before checking it.`);
    if (!this.checker) throw new ApiError(503, "web_provider_check_unavailable", "Connection checks are unavailable.");
    let result: WebProviderCheckResult;
    try {
      result = await this.checker({ tool: tool as WebTool, provider: info.id, apiKey: before?.secret ?? null });
    } catch {
      throw new ApiError(503, "web_provider_check_unavailable", "Couldn't reach the OutcomeGo computer to run the check. Try again shortly.");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(742310, 1)::text`;
      const current = (await this.state(tx))[tool as WebTool].rows.get(info.id);
      if (!sameKey(before, current)) return;
      const check = { checkStatus: result.ok ? "passed" : "failed", checkMessage: result.message.slice(0, 500), checkedAt: new Date() };
      await tx.webToolProvider.upsert({
        where: { tool_provider: { tool: tool as WebTool, provider: info.id } },
        create: { tool: tool as WebTool, provider: info.id, secret: null, ...check },
        update: check,
      });
    });
    return this.view();
  }
}
