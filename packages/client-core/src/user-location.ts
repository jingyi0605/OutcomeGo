import type {
  DeviceLocation,
  LocationSubmission,
  SendMessageInput,
  UpdateLocationSharingInput,
  UserLocationState,
  UserLocationView,
} from "@outcomego/contracts";
import { createJsonTransport, OutcomeGoClientError, type OutcomeGoTransportOptions } from "./http";

export interface UserLocationClientOptions extends OutcomeGoTransportOptions {
  /** Foundation opt-in; no existing desktop/iOS adapter sets this flag. */
  locationEnabled?: boolean;
  location?: (
    signal: AbortSignal
  ) => DeviceLocation | undefined | Promise<DeviceLocation | undefined>;
  locationTimeoutMs?: number;
  /** Required for opt-in: include server, account and adapter generation (including switch-away/back). */
  getAccountKey?: () => string;
}

export const createUserLocationClient = (options: UserLocationClientOptions) => {
  const transport = createJsonTransport(options);
  let generation = 0;
  let sharingAllowed = true;
  const pending = new Set<AbortController>();
  const cancelled = () =>
    new OutcomeGoClientError(
      "Location sharing or the account changed while preparing this request.",
      "location_request_cancelled"
    );
  const requireEnabled = () => {
    if (options.locationEnabled !== true)
      throw new OutcomeGoClientError(
        "Location sharing is disabled in this client.",
        "location_disabled"
      );
  };
  const cancelPendingLocationRequests = () => {
    generation++;
    for (const controller of pending) controller.abort(cancelled());
    pending.clear();
  };

  const owned = async <T>(
    operation: (context: {
      transport: ReturnType<typeof createJsonTransport>;
      signal: AbortSignal;
      ensureCurrent: () => Promise<void>;
    }) => Promise<T>
  ): Promise<T> => {
    if (!options.getAccountKey)
      throw new OutcomeGoClientError(
        "Location requests require an account generation key.",
        "location_owner_required"
      );
    const epoch = generation;
    const account = options.getAccountKey?.();
    const token = (await options.getAuthToken?.()) ?? null;
    const controller = new AbortController();
    const ensureCurrent = async () => {
      const currentToken = (await options.getAuthToken?.()) ?? null;
      if (
        epoch !== generation ||
        account !== options.getAccountKey?.() ||
        token !== currentToken ||
        controller.signal.aborted
      )
        throw cancelled();
    };
    await ensureCurrent();
    pending.add(controller);
    // Never let a mutable cookie jar switch a pending send to another account.
    const pinned = createJsonTransport({
      ...options,
      baseUrl: transport.baseUrl,
      getAuthToken: () => token,
      fetch: (input, init) =>
        (options.fetch ?? globalThis.fetch)(input, { ...init, credentials: "omit" }),
    });
    try {
      const result = await operation({
        transport: pinned,
        signal: controller.signal,
        ensureCurrent,
      });
      await ensureCurrent();
      return result;
    } finally {
      pending.delete(controller);
    }
  };

  const deviceFix = async (signal: AbortSignal): Promise<DeviceLocation | undefined> => {
    let timer: ReturnType<typeof setTimeout>;
    let abort!: () => void;
    const stopped = new Promise<never>((_, reject) => {
      abort = () => reject(cancelled());
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    try {
      return await Promise.race([
        Promise.resolve()
          .then(() => options.location?.(signal))
          .catch(() => undefined),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), options.locationTimeoutMs ?? 3_000);
        }),
        stopped,
      ]);
    } finally {
      clearTimeout(timer!);
      signal.removeEventListener("abort", abort);
    }
  };

  const request = <T>(path: string, init?: RequestInit) => {
    requireEnabled();
    return owned(({ transport, signal }) => transport.request<T>(path, { ...init, signal }));
  };

  return {
    cancelPendingLocationRequests,
    userLocation: () => request<UserLocationState>("/api/v0/location"),
    writeUserLocation: (input: LocationSubmission) =>
      request<UserLocationView>("/api/v0/location", { method: "PUT", body: JSON.stringify(input) }),
    updateLocationSharing: (input: UpdateLocationSharingInput) => {
      cancelPendingLocationRequests();
      sharingAllowed = false;
      return request<UserLocationState>("/api/v0/location/sharing", {
        method: "PUT",
        body: JSON.stringify(input),
      }).then((state) => {
        sharingAllowed = state.sharing.enabled;
        return state;
      });
    },
    clearUserLocation: () => {
      cancelPendingLocationRequests();
      sharingAllowed = false;
      return request<UserLocationState>("/api/v0/location", { method: "DELETE" });
    },
    sendMessage: <T>(path: string, input: SendMessageInput): Promise<T> => {
      if (options.locationEnabled !== true)
        return transport.request<T>(path, { method: "POST", body: JSON.stringify(input) });
      return owned(async ({ transport, signal, ensureCurrent }) => {
        let location: LocationSubmission | undefined;
        if (sharingAllowed && options.location) {
          const state = await transport.request<UserLocationState>("/api/v0/location", { signal });
          await ensureCurrent();
          if (state.sharing.enabled) {
            const fix = await deviceFix(signal);
            await ensureCurrent();
            if (fix) location = { fix, sharingRevision: state.sharing.revision };
          }
        }
        await ensureCurrent();
        return transport.request<T>(path, {
          method: "POST",
          signal,
          body: JSON.stringify({ ...input, ...(location ? { location } : {}) }),
        });
      });
    },
  };
};
