import { expect, test } from "bun:test";
import { createOutcomeGoClient } from "../src/client";

const fix = {
  latitude: 1,
  longitude: 2,
  capturedAt: "2026-11-17T01:00:00Z",
  device: "phone" as const,
};
const revision = crypto.randomUUID();
const state = {
  sharing: { enabled: true, revision },
  location: { available: false, reason: "No fix" },
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

for (const method of ["sendDirectMessage", "sendChannelMessage"] as const) {
  for (const mode of ["switch", "sign-out", "same-token-new-generation", "cancel"] as const) {
    test(`${method} fences ${mode} during a delayed fix`, async () => {
      let token: string | null = "A";
      let accountKey = "server:A:1";
      const waiting = deferred<typeof fix | undefined>();
      const started = deferred<void>();
      const sent: RequestInit[] = [];
      const client = createOutcomeGoClient({
        baseUrl: "https://instance-a.test",
        locationEnabled: true,
        getAuthToken: () => token,
        getAccountKey: () => accountKey,
        location: () => {
          started.resolve();
          return waiting.promise;
        },
        fetch: async (url, init) => {
          if (String(url).endsWith("/location")) return Response.json(state);
          sent.push(init!);
          return Response.json({ message: {} });
        },
      });
      const send = client[method]("private-A", "A content");
      // Observe rejection immediately so cancellation is not an unhandled promise.
      const outcome = send.then(
        () => null,
        (error: Error) => error
      );
      await started.promise;
      if (mode === "switch") token = "B";
      if (mode === "sign-out") token = null;
      if (mode === "same-token-new-generation") accountKey = "server:A:3";
      if (mode === "cancel") client.cancelPendingLocationRequests();
      waiting.resolve(fix);
      expect(await outcome).toMatchObject({ code: "location_request_cancelled" });
      expect(sent).toHaveLength(0);
    });
  }
}

test("clear cancels an uncooperative lookup immediately and failed clear does not resume local sharing", async () => {
  const started = deferred<void>();
  const sends: Record<string, unknown>[] = [];
  const client = createOutcomeGoClient({
    baseUrl: "https://instance-a.test",
    locationEnabled: true,
    getAuthToken: () => "A",
    getAccountKey: () => "instance-a:A:1",
    location: () => {
      started.resolve();
      return new Promise(() => {});
    },
    fetch: async (_url, init) => {
      if (init?.method === "DELETE")
        return Response.json({ error: { code: "offline" } }, { status: 503 });
      if (init?.method === "POST") {
        sends.push(JSON.parse(String(init.body)));
        return Response.json({ message: {} });
      }
      return Response.json(state);
    },
  });
  const waiting = client.sendDirectMessage("A", "pending").catch((error) => error);
  await started.promise;
  await expect(client.clearUserLocation()).rejects.toThrow();
  expect(await waiting).toMatchObject({ code: "location_request_cancelled" });
  await client.sendDirectMessage("A", "plain", [], undefined, { clientId: "durable-plain-1" });
  expect(sends[0]).not.toHaveProperty("location");
});

test("opted-in sends use original instance, credentials, revision and durable client id", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createOutcomeGoClient({
    baseUrl: "https://instance-a.test/prefix",
    getAuthToken: () => "A",
    locationEnabled: true,
    getAccountKey: () => "instance-a:A:1",
    location: () => fix,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return Response.json(init?.method === "POST" ? { message: {} } : state);
    },
  });
  await client.sendChannelMessage("room", "hello", [], "reply", {
    clientId: "durable-client-1",
    richText: "**hello**",
  });
  const send = calls.at(-1)!;
  expect(send.url).toBe("https://instance-a.test/prefix/api/v0/channels/room/messages");
  expect(new Headers(send.init.headers).get("authorization")).toBe("Bearer A");
  expect(send.init.credentials).toBe("omit");
  expect(JSON.parse(String(send.init.body))).toMatchObject({
    clientId: "durable-client-1",
    replyToMessageId: "reply",
    richText: "**hello**",
    location: { fix, sharingRevision: revision },
  });
});

test("location is unwired by default; lookup failures and timeouts still permit a plain send", async () => {
  for (const mode of ["disabled", "failed", "timeout"] as const) {
    let lookups = 0;
    const urls: string[] = [];
    const client = createOutcomeGoClient({
      baseUrl: "https://instance.test",
      getAccountKey: () => "instance:local:1",
      locationEnabled: mode !== "disabled",
      locationTimeoutMs: 1,
      location: () => {
        lookups++;
        if (mode === "failed") throw new Error("permission denied");
        return new Promise(() => {});
      },
      fetch: async (url, init) => {
        urls.push(String(url));
        if (init?.method === "POST")
          expect(JSON.parse(String(init.body))).not.toHaveProperty("location");
        return Response.json(init?.method === "POST" ? { message: {} } : state);
      },
    });
    await client.sendDirectMessage("dm", "plain");
    expect(urls).toHaveLength(mode === "disabled" ? 1 : 2);
    expect(lookups).toBe(mode === "disabled" ? 0 : 1);
  }
});

test("opt-in requires an ownership generation and fences a switch during initial async credential loading", async () => {
  const missing = createOutcomeGoClient({
    baseUrl: "https://instance.test",
    locationEnabled: true,
  });
  await expect(missing.sendDirectMessage("A", "private")).rejects.toMatchObject({
    code: "location_owner_required",
  });
  const loading = deferred<string>();
  let account = "instance:A:1";
  let calls = 0;
  const client = createOutcomeGoClient({
    baseUrl: "https://instance.test",
    locationEnabled: true,
    getAccountKey: () => account,
    getAuthToken: () => loading.promise,
    fetch: async () => {
      calls++;
      return Response.json({});
    },
  });
  const pending = client.sendDirectMessage("A", "private").catch((error) => error);
  account = "instance:B:2";
  loading.resolve("B");
  expect(await pending).toMatchObject({ code: "location_request_cancelled" });
  expect(calls).toBe(0);
});
