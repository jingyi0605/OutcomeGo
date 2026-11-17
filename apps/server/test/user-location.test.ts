import { expect, test } from "bun:test";
import { Effect } from "effect";
import { GET_USER_LOCATION_TOOL } from "@outcomego/contracts/user-location";
import { InternalToolService } from "../src/services/internal-tool-service";
import { UserLocationService } from "../src/services/user-location";
import { clientRoutes } from "../src/routes/client";
import { conversationRoutes } from "../src/routes/conversation";
import { channelRoutes } from "../src/routes/channel";
import { ChannelService } from "../src/services/channel-service";
import { hashRequest } from "../src/services/service-utils";

test("disabled location APIs and tool never touch the database", () => {
  const service = new UserLocationService({} as never, "required", () => false);
  expect(() => service.read("session")).toThrow("not enabled");
  expect(() => service.write("session", {} as never)).toThrow("not enabled");
  expect(() => service.clear("session")).toThrow("not enabled");
  return expect(service.readForTool()).rejects.toThrow("not enabled");
});

test("the tool reads only the single authenticated deployment owner's namespace", async () => {
  let ownerKey: string | undefined;
  let users = [{ id: "owner-A" }];
  const service = new UserLocationService(
    {
      user: { findMany: async () => users },
      userLocation: {
        findUnique: async (input: { where: { ownerKey: string } }) => {
          ownerKey = input.where.ownerKey;
          return {
            sharingEnabled: true,
            latitude: 1,
            longitude: 2,
            accuracyMeters: null,
            capturedAt: new Date(),
            device: "phone",
          };
        },
      },
    } as never,
    "required",
    () => true
  );
  expect(await service.readForTool()).toMatchObject({ latitude: 1 });
  expect(ownerKey).toBe("user:owner-A");
  ownerKey = undefined;
  users = [{ id: "owner-A" }, { id: "owner-B" }];
  expect(await service.readForTool()).toMatchObject({ available: false });
  expect(ownerKey).toBeUndefined();
});

test("location routes bind authenticated session and prohibit cached read/write responses", async () => {
  const calls: unknown[] = [];
  const state = {
    sharing: { enabled: false, revision: crypto.randomUUID() },
    location: { available: false },
  };
  for (const [method, path, operation, body] of [
    ["GET", "/api/location", "read", undefined],
    ["DELETE", "/api/location", "clear", undefined],
    [
      "PUT",
      "/api/location/sharing",
      "updateSharing",
      { enabled: true, expectedRevision: state.sharing.revision },
    ],
    [
      "PUT",
      "/api/location",
      "write",
      {
        fix: { latitude: 1, longitude: 2, capturedAt: "2026-11-17T00:00:00Z", device: "phone" },
        sharingRevision: state.sharing.revision,
      },
    ],
  ] as const) {
    const userLocations = Object.fromEntries(
      ["read", "write", "clear", "updateSharing"].map((name) => [
        name,
        async (...args: unknown[]) => {
          calls.push([name, ...args]);
          return state;
        },
      ])
    );
    const response = await clientRoutes({
      app: { userLocations } as never,
      path,
      url: new URL(`http://test${path}`),
      authMode: "required",
      authenticatedSessionId: "trusted-session",
      request: new Request(`http://test${path}`, {
        method,
        ...(body
          ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
          : {}),
      }),
    });
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(calls.at(-1)).toEqual(
      body ? [operation, "trusted-session", body] : [operation, "trusted-session"]
    );
  }
});

test("server tool dispatch matches contracts and refuses subagents and supplied owner arguments", async () => {
  for (const mode of ["parent", "child", "bad-arguments"] as const) {
    let reads = 0;
    const service = new InternalToolService(
      {
        run: {
          findUnique: async () => ({
            id: "run",
            botId: "bot",
            conversationId: "dm",
            channelId: "channel",
            deliveryId: null,
            status: "running",
            origin: "user",
            inboxEvents: [],
          }),
        },
        subagent: { findUnique: async () => (mode === "child" ? { id: "child" } : null) },
      } as never,
      {} as never,
      {} as never,
      async () => {},
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        readForTool: async () => {
          reads++;
          return { available: false, reason: "no fix" };
        },
      } as never
    );
    const result = Effect.runPromise(
      service.execute({
        runId: "run",
        botId: "bot",
        conversationId: "dm",
        channelId: "channel",
        deliveryId: null,
        callId: "location-call",
        tool: GET_USER_LOCATION_TOOL.name,
        arguments: mode === "bad-arguments" ? { ownerKey: "user:other" } : {},
      })
    );
    if (mode === "parent") await expect(result).resolves.toMatchObject({ available: false });
    else await expect(result).rejects.toThrow();
    expect(reads).toBe(mode === "parent" ? 1 : 0);
  }
});

test("direct and group message routes pass server session identity separately from message fields", async () => {
  const input = {
    content: "near me",
    clientId: "location-routing-client",
    location: {
      fix: { latitude: 1, longitude: 2, capturedAt: "2026-11-17T01:00:00Z", device: "phone" },
      sharingRevision: crypto.randomUUID(),
    },
  };
  for (const [route, path, operation, expectedOwner] of [
    [conversationRoutes, "/api/conversations/dm/messages", "sendMessage", "trusted-session"],
    [
      channelRoutes,
      "/api/channels/room/messages",
      "sendChannelMessage",
      { locationSessionId: "trusted-session" },
    ],
  ] as const) {
    let args: unknown[];
    const response = await route({
      app: {
        [operation]: (...values: unknown[]) => {
          args = values;
          return Effect.succeed({ message: {} });
        },
      } as never,
      path,
      url: new URL(`http://test${path}`),
      authMode: "required",
      authenticatedSessionId: "trusted-session",
      request: new Request(`http://test${path}`, {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
      }),
    });
    expect(response?.status).toBe(202);
    expect(args![1]).toEqual(input);
    expect(args![2]).toEqual(expectedOwner);
  }
});

test("durable message replay ignores changed fix/revision and never records location twice", async () => {
  const input = { content: "already accepted", clientId: "location-replay-client" };
  const requestHash = hashRequest(input);
  const service = new ChannelService(
    {
      idempotencyRecord: {
        findUnique: async () => ({ requestHash, response: { message: { id: "accepted" } } }),
      },
    } as never,
    {} as never,
    "/workspace",
    async () => new Response(null)
  );
  const retry = {
    ...input,
    location: {
      fix: {
        latitude: 3,
        longitude: 4,
        capturedAt: "2026-11-17T01:00:00Z",
        device: "phone" as const,
      },
      sharingRevision: crypto.randomUUID(),
    },
  };
  await expect(Effect.runPromise(service.sendDirectMessage("dm", retry))).resolves.toEqual({
    message: { id: "accepted" },
  });
  await expect(Effect.runPromise(service.sendGroupMessage("room", retry))).resolves.toEqual({
    message: { id: "accepted" },
  });
});
