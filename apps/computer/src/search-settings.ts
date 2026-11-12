import type { FetchConfiguration } from "./fetch-provider";
import { isSearchProvider, isFetchProvider, WEB_TOOL_STRATEGIES } from "@outcomego/contracts/web-search";
import type { SearchConfiguration, SearchFetch } from "./search-provider";

/** Read for each search so saved DB changes take effect without restarting workers. */
function serverWebConfiguration(
  kind: "search" | "fetch",
  serverUrl: string,
  controlToken: string,
  request: SearchFetch = fetch
) {
  return async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    try {
      const timeout = AbortSignal.timeout(10_000);
      const response = await request(
        `${serverUrl.replace(/\/+$/, "")}/api/internal/server-settings/web-${kind}/credentials`,
        {
          headers: { authorization: `Bearer ${controlToken}` },
          redirect: "error",
          cache: "no-store",
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        }
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error("Settings unavailable");
      }
      const value = await response.json();
      if (!value || typeof value !== "object" || Array.isArray(value) || !WEB_TOOL_STRATEGIES.includes(value.strategy) || !Array.isArray(value.providers) || !Number.isSafeInteger(value.cursor) || value.cursor < 0)
        throw new Error("Invalid settings");
      for (const entry of value.providers) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry) || (kind === "fetch" ? !isFetchProvider(entry.provider) : !isSearchProvider(entry.provider)) || (entry.apiKey !== null && (typeof entry.apiKey !== "string" || !entry.apiKey || entry.apiKey.length > 20_000)))
          throw new Error("Invalid settings");
      }
      signal?.throwIfAborted();
      return {
        strategy: value.strategy,
        providers: value.providers.map((entry: { provider: string; apiKey: string | null }) => ({ provider: entry.provider, apiKey: entry.apiKey ?? undefined })),
        cursor: value.cursor,
      };
    } catch {
      signal?.throwIfAborted();
      // Neither upstream errors nor response bodies may expose credentials.
      throw new Error(
        `Web ${kind} settings could not be loaded from the OutcomeGo server, so nothing was ${kind === "search" ? "searched" : "fetched"}. Retry shortly; if it keeps failing, the server may need attention.`
      );
    }
  };
}

export function serverSearchConfiguration(
  serverUrl: string,
  controlToken: string,
  request: SearchFetch = fetch
): (signal?: AbortSignal) => Promise<SearchConfiguration> {
  return serverWebConfiguration("search", serverUrl, controlToken, request);
}
export function serverFetchConfiguration(
  serverUrl: string,
  controlToken: string,
  request: SearchFetch = fetch
): (signal?: AbortSignal) => Promise<FetchConfiguration> {
  return serverWebConfiguration("fetch", serverUrl, controlToken, request);
}
