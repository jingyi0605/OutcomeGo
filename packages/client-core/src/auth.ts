import {
  createJsonTransport,
  normalizeBaseUrl,
  AiTeamOSClientError,
  type AiTeamOSFetch,
} from "./http";

export type AiTeamOSAuthMode = "required" | "disabled";
export type AiTeamOSAuthStatus = "checking" | "authenticated" | "signed-out";
export type AiTeamOSAuthConnection = "unknown" | "online" | "offline";

export interface AiTeamOSAuthUser {
  id: string;
  name: string;
  email: string;
  username: string | null;
  image: string | null;
}

export interface AiTeamOSAuthSnapshot {
  status: AiTeamOSAuthStatus;
  mode: AiTeamOSAuthMode;
  connection: AiTeamOSAuthConnection;
  error: string | null;
  user: AiTeamOSAuthUser | null;
}

export interface AiTeamOSAuthSession {
  session: unknown;
  user: AiTeamOSAuthUser;
}

export interface AiTeamOSSignInResult {
  token: string;
  user: AiTeamOSAuthUser | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const parseAuthUser = (value: unknown): AiTeamOSAuthUser | null => {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const email = typeof value.email === "string" ? value.email.trim() : "";
  const username = typeof value.username === "string" ? value.username.trim() : "";
  if (!id || (!name && !email && !username)) return null;
  return {
    id,
    name: name || username || email,
    email,
    username: username || null,
    image: typeof value.image === "string" && value.image.trim() ? value.image.trim() : null,
  };
};

const responseBody = async (response: Response): Promise<Record<string, unknown> | null> => {
  const value = (await response.json().catch(() => null)) as unknown;
  return isRecord(value) ? value : null;
};

export const authResponseError = async (response: Response): Promise<string> => {
  const body = await responseBody(response);
  const nested = isRecord(body?.error) ? body.error : null;
  return (
    (typeof nested?.message === "string" && nested.message) ||
    (typeof body?.message === "string" && body.message) ||
    (response.status === 401
      ? "The username or password is incorrect. Check your details and try again."
      : response.status === 403
        ? "This account cannot sign in to this server. Contact your server administrator."
        : response.status === 429
          ? "Too many sign-in attempts. Wait a moment and try again."
          : response.status >= 500
            ? "The server could not complete sign-in. Please try again shortly."
            : "Could not sign in. Please try again.")
  );
};

export interface AiTeamOSAuthClientOptions {
  baseUrl: string;
  fetch?: AiTeamOSFetch;
  /** Includes receiving and parsing the response body, not just connecting. */
  timeoutMs?: number;
}

const invalidAiTeamOSServer = (status: number): AiTeamOSClientError =>
  new AiTeamOSClientError(
    "This endpoint is reachable, but it is not a compatible aiTeamOS server.",
    "invalid_server",
    status
  );

const unavailableAiTeamOSServer = (status: number): AiTeamOSClientError =>
  new AiTeamOSClientError("The aiTeamOS server is temporarily unavailable.", "offline", status);

const interruptedAiTeamOSServer = (status: number): AiTeamOSClientError =>
  new AiTeamOSClientError(
    "The connection dropped while checking this server. Try again.",
    "offline",
    status
  );

/**
 * Reads a JSON object body. Unlike responseBody, a body that can't be read (the connection
 * dropped partway through the answer) throws, so it isn't mistaken for a body without
 * aiTeamOS's fields.
 */
const readResponseBody = async (response: Response): Promise<Record<string, unknown> | null> => {
  const text = await response.text();
  try {
    const value = JSON.parse(text) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
};

/**
 * Platform-neutral authentication protocol. Persistence and lifecycle policy stay
 * in the desktop/mobile adapters so secrets never cross into an unsafe storage API.
 */
export const createAiTeamOSAuthClient = (options: AiTeamOSAuthClientOptions) => {
  const transport = createJsonTransport(options);

  // A silent server (or stalled response body) must not leave onboarding permanently busy.
  const withDeadline = async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new AiTeamOSClientError(
            "The server took too long to respond. Please try again.",
            "timeout"
          )
        );
        controller.abort();
      }, options.timeoutMs ?? 15_000);
    });
    try {
      return await Promise.race([operation(controller.signal), deadline]);
    } finally {
      clearTimeout(timer!);
    }
  };

  const requestMode = (strict: boolean): Promise<AiTeamOSAuthMode> =>
    withDeadline(async (signal) => {
      const response = await transport.open("/api/auth/config", { signal });
      if (!response.ok) {
        if (strict) {
          throw response.status >= 500
            ? unavailableAiTeamOSServer(response.status)
            : invalidAiTeamOSServer(response.status);
        }
        return "required";
      }
      let body: Record<string, unknown> | null;
      try {
        body = await readResponseBody(response);
      } catch (cause) {
        // The deadline cut it off and has already answered.
        if (signal.aborted) throw cause;
        // A cut-off answer is a connection problem, not proof of a different server.
        if (strict) throw interruptedAiTeamOSServer(response.status);
        body = null;
      }
      if (body?.mode === "required" || body?.mode === "disabled") return body.mode;
      if (strict) throw invalidAiTeamOSServer(response.status);
      return "required";
    });

  const discoverMode = (): Promise<AiTeamOSAuthMode> => requestMode(false);
  const validateServer = (): Promise<AiTeamOSAuthMode> => requestMode(true);

  const signIn = (username: string, password: string): Promise<AiTeamOSSignInResult> =>
    withDeadline(async (signal) => {
      const response = await transport.open("/api/auth/login", {
        method: "POST",
        signal,
        body: JSON.stringify({ username: username.trim(), password, rememberMe: true }),
      });
      if (!response.ok) throw new Error(await authResponseError(response));
      const token = response.headers.get("set-auth-token")?.trim() ?? "";
      if (!token) throw new Error("The server did not return an aiTeamOS session token");
      const body = await responseBody(response);
      return { token, user: parseAuthUser(body?.user) };
    });

  const getSession = (token: string): Promise<AiTeamOSAuthSession | null> =>
    withDeadline(async (signal) => {
      const response = await transport.open("/api/auth/get-session", {
        signal,
        headers: { authorization: `Bearer ${token}` },
      });
      // A proxy or server error (e.g. while aiTeamOS restarts for an update)
      // says nothing about the credential. Report it as unavailable so callers
      // keep the session instead of signing the device out.
      if (response.status >= 500 || response.status === 408 || response.status === 429) {
        throw unavailableAiTeamOSServer(response.status);
      }
      if (!response.ok) return null;
      const body = await responseBody(response);
      const user = parseAuthUser(body?.user);
      return body?.session && user ? { session: body.session, user } : null;
    });

  const signOut = (token: string): Promise<void> =>
    withDeadline(async (signal) => {
      const response = await transport.open("/api/auth/sign-out", {
        method: "POST",
        signal,
        // Native fetch otherwise includes saved login cookies without an Origin,
        // which correctly fails the server's cookie-based CSRF protection.
        credentials: "omit",
        headers: { authorization: `Bearer ${token}` },
        // Better Auth requires JSON on POST even when the endpoint has no fields.
        body: "{}",
      });
      if (!response.ok)
        throw new AiTeamOSClientError(
          "The server could not complete sign-out. Please try again.",
          "sign_out_failed",
          response.status
        );
    });

  return { baseUrl: transport.baseUrl, discoverMode, getSession, signIn, signOut, validateServer };
};

export type AiTeamOSAuthClient = ReturnType<typeof createAiTeamOSAuthClient>;

export interface AiTeamOSAuthAssessment {
  status: Exclude<AiTeamOSAuthStatus, "checking">;
  mode: AiTeamOSAuthMode;
  connection: Exclude<AiTeamOSAuthConnection, "unknown">;
  user: AiTeamOSAuthUser | null;
  /** The server explicitly reported this mode, so a platform may cache it for offline starts. */
  observedMode: AiTeamOSAuthMode | null;
  /** Invalid and auth-disabled sessions must be removed from platform-secure storage. */
  clearCredentials: boolean;
}

export interface AssessAiTeamOSAuthSessionOptions {
  client: AiTeamOSAuthClient;
  loadToken: () => Promise<string | null>;
  loadCachedMode?: () => Promise<AiTeamOSAuthMode | null>;
  isCurrent?: () => boolean;
}

export class AuthSessionSupersededError extends Error {
  constructor() {
    super("The aiTeamOS server changed while authentication was in progress.");
    this.name = "AuthSessionSupersededError";
  }
}

/** Shared fail-closed session policy; platforms retain ownership of secure persistence. */
export const assessAiTeamOSAuthSession = async ({
  client,
  loadToken,
  loadCachedMode = async () => null,
  isCurrent = () => true,
}: AssessAiTeamOSAuthSessionOptions): Promise<AiTeamOSAuthAssessment> => {
  const ensureCurrent = () => {
    if (!isCurrent()) throw new AuthSessionSupersededError();
  };

  let mode: AiTeamOSAuthMode = "required";
  let connection: Exclude<AiTeamOSAuthConnection, "unknown"> = "online";
  let observedMode: AiTeamOSAuthMode | null = null;
  try {
    mode = await client.discoverMode();
    ensureCurrent();
    observedMode = mode;
  } catch (cause) {
    if (cause instanceof AuthSessionSupersededError) throw cause;
    ensureCurrent();
    connection = "offline";
    mode = (await loadCachedMode()) ?? "required";
    ensureCurrent();
  }

  if (mode === "disabled") {
    return {
      status: "authenticated",
      mode,
      connection,
      user: null,
      observedMode,
      clearCredentials: true,
    };
  }

  const token = await loadToken();
  ensureCurrent();
  if (!token) {
    return {
      status: "signed-out",
      mode,
      connection,
      user: null,
      observedMode,
      clearCredentials: false,
    };
  }

  try {
    const session = await client.getSession(token);
    ensureCurrent();
    if (session) {
      return {
        status: "authenticated",
        mode,
        connection: "online",
        user: session.user,
        observedMode,
        clearCredentials: false,
      };
    }
    return {
      status: "signed-out",
      mode,
      connection: "online",
      user: null,
      observedMode,
      clearCredentials: true,
    };
  } catch (cause) {
    if (cause instanceof AuthSessionSupersededError) throw cause;
    ensureCurrent();
    // A previously established credential remains usable during a temporary outage.
    return {
      status: "authenticated",
      mode,
      connection: "offline",
      user: null,
      observedMode,
      clearCredentials: false,
    };
  }
};

export const createAuthSnapshotStore = (initial: AiTeamOSAuthSnapshot) => {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: (): AiTeamOSAuthSnapshot => snapshot,
    publish: (next: AiTeamOSAuthSnapshot): AiTeamOSAuthSnapshot => {
      snapshot = next;
      for (const listener of listeners) listener();
      return snapshot;
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export const authHeadersForUrl = (
  baseUrl: string | null,
  token: string | null,
  url: string
): Record<string, string> | undefined => {
  if (!baseUrl || !token) return undefined;
  try {
    const server = new URL(normalizeBaseUrl(baseUrl));
    const target = new URL(url, server);
    if (target.origin !== server.origin || !target.pathname.startsWith("/api/")) return undefined;
    return { authorization: `Bearer ${token}` };
  } catch {
    return undefined;
  }
};
