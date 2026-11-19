import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrismaClient } from "@outcomego/db";
import { AgentDataStore, AgentMessaging, RoutineService } from "@outcomego/messaging";
import { PluginEventPoller, hostFields, isUnsupportedPollTool, parsePollResult } from "../src/services/plugin/events";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const text = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

test("poll results accept MCP text or structured content and surface tool errors", () => {
  expect(parsePollResult(text({ events: [{ id: "1" }], cursor: { uid: 2 } }))).toEqual({
    events: [{ id: "1" }],
    cursor: { uid: 2 },
  });
  expect(parsePollResult({ structuredContent: { events: [] } })).toEqual({
    events: [],
    cursor: null,
  });
  expect(() =>
    parsePollResult({ isError: true, content: [{ type: "text", text: "IMAP login failed" }] })
  ).toThrow("IMAP login failed");
  expect(() => parsePollResult(text({ cursor: 1 }))).toThrow("no events list");
  expect(() => parsePollResult({ content: [{ type: "text", text: "not json" }] })).toThrow(
    "unreadable"
  );
});

test("a failed database read skips the poll pass instead of rejecting", async () => {
  const outage = { pluginConnection: { findMany: () => Promise.reject(new Error("Connection terminated unexpectedly")) } };
  const poller = new PluginEventPoller(
    outage as never,
    async () => undefined,
    async () => undefined
  );
  const warn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(" "));
  };
  try {
    await expect(poller.pollDue()).resolves.toBeUndefined();
  } finally {
    console.warn = warn;
  }
  expect(warnings).toEqual(["Plugin event poll failed: Connection terminated unexpectedly"]);
});

test("declared event polls run on their interval, force the manifest source, and save the cursor after dispatch", async () => {
  if (!url) return;
  const prisma = createPrismaClient(url);
  const pluginKey = `events-${crypto.randomUUID().slice(0, 8)}`;
  let now = new Date("2026-10-14T12:00:00Z");
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const dispatched: unknown[] = [];
  let reply: unknown = text({
    events: [
      {
        id: "mail-1",
        source: "webhook",
        kind: "received",
        text: "Subject: Hi",
        channel: "bot@example.com",
      },
    ],
    cursor: { mailbox: "bot@example.com", uidValidity: "7", uidNext: 43 },
  });
  const poller = new PluginEventPoller(
    prisma,
    async (_connection, tool, args) => {
      calls.push({ tool, args });
      return reply;
    },
    async (event) => {
      dispatched.push(event);
    },
    () => now
  );
  try {
    const installation = await prisma.pluginInstallation.create({
      data: {
        pluginKey,
        version: "1.0.0",
        name: "Events fixture",
        publisher: "Test",
        manifest: {
          key: pluginKey,
          name: "Events fixture",
          skills: [],
          connections: [
            {
              key: "mail",
              transport: "stdio",
              events: { pollTool: "poll_new_mail", source: "email", intervalSeconds: 60 },
            },
            { key: "plain", transport: "stdio" },
          ],
        },
      },
    });
    const connection = await prisma.pluginConnection.create({
      data: {
        installationId: installation.id,
        connectorKey: "mail",
        name: "Mail",
        transport: "stdio",
        authType: "none",
        status: "ready",
      },
    });
    await prisma.pluginConnection.create({
      data: {
        installationId: installation.id,
        connectorKey: "plain",
        name: "Plain",
        transport: "stdio",
        authType: "none",
        status: "ready",
      },
    });
    await prisma.pluginConnection.create({
      data: {
        installationId: installation.id,
        connectorKey: "mail",
        alias: "off",
        name: "Off",
        transport: "stdio",
        authType: "none",
        status: "needs_auth",
      },
    });

    await poller.pollDue();
    expect(calls).toEqual([{ tool: "poll_new_mail", args: { cursor: null } }]);
    expect(dispatched).toEqual([
      {
        id: "mail-1",
        source: "email",
        kind: "received",
        text: "Subject: Hi",
        channel: "bot@example.com",
      },
    ]);
    expect(
      (await prisma.pluginConnection.findUniqueOrThrow({ where: { id: connection.id } }))
        .eventCursor
    ).toEqual({
      mailbox: "bot@example.com",
      uidValidity: "7",
      uidNext: 43,
    });

    now = new Date(now.getTime() + 30_000);
    await poller.pollDue();
    expect(calls).toHaveLength(1);

    now = new Date(now.getTime() + 30_000);
    reply = { isError: true, content: [{ type: "text", text: "IMAP login failed" }] };
    await poller.pollDue();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.args).toEqual({
      cursor: { mailbox: "bot@example.com", uidValidity: "7", uidNext: 43 },
    });
    expect(
      (await prisma.pluginConnection.findUniqueOrThrow({ where: { id: connection.id } }))
        .eventCursor
    ).toEqual({
      mailbox: "bot@example.com",
      uidValidity: "7",
      uidNext: 43,
    });

    // A dispatch failure keeps the cursor so the same delivery IDs are retried (and deduplicated).
    now = new Date(now.getTime() + 60_000);
    reply = text({
      events: [{ id: "mail-2", kind: "received", text: "x", channel: "bot@example.com" }],
      cursor: { uidNext: 44 },
    });
    const failing = new PluginEventPoller(
      prisma,
      async () => reply,
      async () => {
        throw new Error("database unavailable");
      },
      () => now
    );
    await failing.pollDue();
    expect(
      (await prisma.pluginConnection.findUniqueOrThrow({ where: { id: connection.id } }))
        .eventCursor
    ).toEqual({
      mailbox: "bot@example.com",
      uidValidity: "7",
      uidNext: 43,
    });

    // Reconfiguring the account (a new runtime generation) discards an in-flight cursor.
    now = new Date(now.getTime() + 60_000);
    const racing = new PluginEventPoller(
      prisma,
      async () => {
        await prisma.pluginConnection.update({
          where: { id: connection.id },
          data: { runtimeGeneration: { increment: 1 } },
        });
        return text({ events: [], cursor: { uidNext: 99 } });
      },
      async () => undefined,
      () => now
    );
    await racing.pollDue();
    expect(
      (await prisma.pluginConnection.findUniqueOrThrow({ where: { id: connection.id } }))
        .eventCursor
    ).toEqual({
      mailbox: "bot@example.com",
      uidValidity: "7",
      uidNext: 43,
    });
  } finally {
    await prisma.pluginInstallation.deleteMany({ where: { pluginKey } });
    await prisma.$disconnect();
  }
});

test("connector tools marked host-only are never listed for Bots", async () => {
  const { PluginTransport, HOST_ONLY_TOOL_META } = await import("../src/services/plugin/transport");
  const transport = new PluginTransport(
    {} as never,
    {} as never,
    "http://127.0.0.1:8787",
    async () =>
      Response.json({
        state: "ready",
        tools: [
          {
            name: "send_email",
            description: "Send",
            inputSchema: { type: "object" },
            annotations: { readOnlyHint: false },
          },
          {
            name: "poll_new_mail",
            description: "Host poll",
            inputSchema: { type: "object" },
            _meta: { [HOST_ONLY_TOOL_META]: true },
          },
        ],
      })
  );
  expect((await transport.stdioStatus("connection")).tools.map((tool) => tool.name)).toEqual([
    "send_email",
  ]);
});

test("connector results keep non-secret setup values and scrub secrets", async () => {
  if (!url) return;
  const prisma = createPrismaClient(url);
  const { PluginTransport } = await import("../src/services/plugin/transport");
  const pluginKey = `redact-${crypto.randomUUID().slice(0, 8)}`;
  let request: Record<string, any> = {};
  const transport = new PluginTransport(
    prisma,
    {} as never,
    "http://127.0.0.1:8787",
    async (_path, init) => {
      request = JSON.parse(String(init?.body));
      return Response.json({
        result: {
          content: [
            {
              type: "text",
              text: "From bot@example.test (auto-replied); password s3cret-app-password",
            },
          ],
        },
      });
    }
  );
  try {
    const installation = await prisma.pluginInstallation.create({
      data: {
        pluginKey,
        version: "1.0.0",
        name: "Redaction fixture",
        publisher: "Test",
        manifest: {
          key: pluginKey,
          name: "Redaction fixture",
          skills: [],
          connections: [{ key: "mail", transport: "stdio" }],
        },
      },
    });
    const connection = await prisma.pluginConnection.create({
      data: {
        installationId: installation.id,
        connectorKey: "mail",
        name: "Mail",
        transport: "stdio",
        authType: "none",
        status: "ready",
        configuration: {
          command: "bun",
          args: ["server.mjs"],
          env: {
            EMAIL_ADDRESS: "${EMAIL_ADDRESS}",
            EMAIL_PASSWORD: "${EMAIL_PASSWORD}",
            IMAP_SERVER: "${IMAP_SERVER}",
          },
          values: { EMAIL_ADDRESS: "bot@example.test", IMAP_SERVER: "auto" },
        },
        credentials: { values: { EMAIL_PASSWORD: "s3cret-app-password" } },
      },
    });
    const result = (await transport.callHostTool(connection, "poll_new_mail", {
      cursor: null,
    })) as { content: Array<{ text: string }> };
    expect(request.configuration.env).toMatchObject({
      EMAIL_ADDRESS: "bot@example.test",
      EMAIL_PASSWORD: "s3cret-app-password",
      IMAP_SERVER: "auto",
    });
    expect(result.content[0]!.text).toBe(
      "From bot@example.test (auto-replied); password [redacted]"
    );
  } finally {
    await prisma.pluginInstallation.deleteMany({ where: { pluginKey } });
    await prisma.$disconnect();
  }
});

test("server-side callers can invoke a connector's declared host tools; Bot calls cannot", async () => {
  if (!url) return;
  const prisma = createPrismaClient(url);
  const { PluginInvocations } = await import("../src/services/plugin/invocations");
  const { PluginTransport } = await import("../src/services/plugin/transport");
  const pluginKey = `host-${crypto.randomUUID().slice(0, 8)}`;
  const executed: string[] = [];
  // The real execution path, with the Bot computer replaced by a stub.
  const transport = new PluginTransport(
    prisma,
    {} as never,
    "http://127.0.0.1:8787",
    async (_path, init) => {
      executed.push(JSON.parse(String(init?.body)).toolName);
      return Response.json({ result: { content: [{ type: "text", text: "{}" }] } });
    }
  );
  const invocations = new PluginInvocations(prisma, (callId) =>
    transport.executeInvocation(callId)
  );
  const botId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  try {
    await prisma.bot.create({
      data: {
        id: botId,
        name: "Host tool fixture",
        defaultDirectory: "/workspace",
        conversation: { create: { id: conversationId } },
      },
    });
    const message = await prisma.message.create({
      data: {
        botId,
        conversationId,
        role: "user",
        content: "x",
        clientId: `host-${runId}`,
        status: "completed",
      },
    });
    await prisma.run.create({
      data: { id: runId, botId, conversationId, userMessageId: message.id, status: "running" },
    });
    const installation = await prisma.pluginInstallation.create({
      data: {
        pluginKey,
        version: "1.0.0",
        name: "Host",
        publisher: "Test",
        manifest: {
          key: pluginKey,
          name: "Host",
          skills: [],
          connections: [
            {
              key: "mail",
              transport: "stdio",
              drafts: { platform: "email", tool: "send_reviewed_email" },
            },
            { key: "remote", transport: "http" },
          ],
        },
      },
    });
    const configuration = { command: "bun", args: ["server.mjs"] };
    const stdio = await prisma.pluginConnection.create({
      data: {
        installationId: installation.id,
        connectorKey: "mail",
        name: "Mail",
        transport: "stdio",
        authType: "none",
        status: "ready",
        toolSnapshot: [],
        configuration,
      },
    });
    const http = await prisma.pluginConnection.create({
      data: {
        installationId: installation.id,
        connectorKey: "remote",
        name: "Remote",
        transport: "http",
        authType: "none",
        status: "ready",
        toolSnapshot: [],
      },
    });
    const call = (connectionId: string, toolName: string, hostTool?: boolean) =>
      invocations.invoke({
        connectionId,
        botId,
        runId,
        callId: crypto.randomUUID(),
        toolName,
        arguments: { action: "send" },
        hostTool,
      });
    await expect(call(stdio.id, "send_reviewed_email")).rejects.toThrow("Plugin tool not found");
    expect(executed).toEqual([]);
    await call(stdio.id, "send_reviewed_email", true);
    expect(executed).toEqual(["send_reviewed_email"]);
    await expect(call(stdio.id, "some_hidden_tool", true)).rejects.toThrow(
      "declares no such host tool"
    );
    await expect(call(http.id, "send_reviewed_email", true)).rejects.toThrow(
      "declares no such host tool"
    );
    expect(executed).toHaveLength(1);
  } finally {
    await prisma.pluginInstallation.deleteMany({ where: { pluginKey } });
    await prisma.bot.deleteMany({ where: { id: botId } });
    await prisma.$disconnect();
  }
});

// ---- Generic `plugin` event source, including remote MCP connections. No database needed. ----
const CONNECTION_ID = "11111111-1111-4111-8111-111111111111";
const remoteRow = (overrides: Record<string, unknown> = {}) => ({
  id: CONNECTION_ID,
  alias: "work",
  transport: "http",
  endpoint: "https://dsh.example/mcp",
  authType: "token",
  connectorKey: "dsh",
  configuration: {},
  credentials: {},
  runtimeGeneration: 1,
  eventCursor: null,
  installation: {
    pluginKey: "dsh-web",
    manifest: {
      key: "dsh-web",
      name: "DSH-WEB",
      skills: [],
      connections: [
        {
          key: "dsh",
          transport: "http",
          events: { pollTool: "session_events", source: "plugin", intervalSeconds: 60 },
        },
      ],
    },
  },
  ...overrides,
});
const fakeDatabase = (rows: unknown[]) => {
  const cursors = new Map<string, unknown>();
  const deferred: Array<{ id: string; polledAt: Date }> = [];
  const prisma = {
    pluginConnection: {
      findMany: async () => rows,
      updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if ("eventCursor" in data) cursors.set(where.id, data.eventCursor);
        else if (data.eventsPolledAt instanceof Date) deferred.push({ id: where.id, polledAt: data.eventsPolledAt });
        return { count: 1 };
      },
    },
  };
  return { prisma: prisma as never, cursors, polledAt: deferred };
};
const captureWarnings = async (run: () => Promise<void>): Promise<string[]> => {
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
  try {
    await run();
  } finally {
    console.warn = warn;
  }
  return warnings;
};
const identity = { pluginKey: "dsh-web", alias: "work" };

test("plugin events are stamped with the host's plugin and account and get a namespaced ID", () => {
  const stamped = hostFields(
    { id: "e1", kind: "session.completed", text: "Done", source: "email", plugin: "other", account: "other", resourceId: "s1" },
    "plugin",
    CONNECTION_ID,
    identity
  );
  expect(stamped).toMatchObject({
    id: `plugin:dsh-web:${CONNECTION_ID}:e1`,
    source: "plugin",
    plugin: "dsh-web",
    account: "work",
    resourceId: "s1",
  });
  // Email keeps its ID and gets only the manifest's source.
  expect(hostFields({ id: "mail-1", source: "webhook", kind: "received", text: "" }, "email", CONNECTION_ID, identity)).toEqual({
    id: "mail-1",
    source: "email",
    kind: "received",
    text: "",
  });
  for (const id of [undefined, "", "   ", 5, "x".repeat(151)])
    expect(() => hostFields({ id, kind: "k", text: "" }, "plugin", CONNECTION_ID, identity)).toThrow("1 to 150");
  expect(() => hostFields({ id: "x".repeat(150), kind: "k", text: "" }, "plugin", CONNECTION_ID, identity)).not.toThrow();
});

test("a remote plugin source is polled with a deadline and dispatches stamped events, dropping bad ones", async () => {
  const { prisma, cursors } = fakeDatabase([remoteRow()]);
  const calls: Array<{ connection: Record<string, unknown>; tool: string; args: unknown; signal?: AbortSignal }> = [];
  const dispatched: Array<Record<string, unknown>> = [];
  const poller = new PluginEventPoller(
    prisma,
    async (connection, tool, args, signal) => {
      calls.push({ connection: connection as never, tool, args, signal });
      return text({
        events: [
          { id: "e1", source: "email", plugin: "spoof", account: "spoof", kind: "session.completed", text: "Done", resourceId: "s1", actor: "bot-1" },
          { id: "", kind: "session.failed", text: "no id" },
          { id: "y".repeat(151), kind: "session.failed", text: "long id" },
          { id: "e2", kind: "session.failed", text: "Boom", resourceId: "s2" },
        ],
        cursor: { after: 9 },
      });
    },
    async (event) => void dispatched.push(event as never)
  );
  const warnings = await captureWarnings(() => poller.pollDue());
  expect(calls).toHaveLength(1);
  expect(calls[0]!.tool).toBe("session_events");
  expect(calls[0]!.args).toEqual({ cursor: null });
  expect(calls[0]!.connection).toMatchObject({
    id: CONNECTION_ID,
    transport: "http",
    endpoint: "https://dsh.example/mcp",
    authType: "token",
    connectorKey: "dsh",
  });
  expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  expect(calls[0]!.signal!.aborted).toBe(false);
  expect(dispatched.map((event) => event.id)).toEqual([`plugin:dsh-web:${CONNECTION_ID}:e1`, `plugin:dsh-web:${CONNECTION_ID}:e2`]);
  expect(dispatched[0]).toMatchObject({ source: "plugin", plugin: "dsh-web", account: "work", resourceId: "s1", actor: "bot-1" });
  expect(dispatched[1]).toMatchObject({ source: "plugin", plugin: "dsh-web", account: "work", kind: "session.failed" });
  expect(warnings.filter((warning) => warning.includes("was rejected"))).toHaveLength(2);
  expect(cursors.get(CONNECTION_ID)).toEqual({ after: 9 });
});

test("a failed dispatch keeps the remote cursor so the batch is retried", async () => {
  const { prisma, cursors } = fakeDatabase([remoteRow({ eventCursor: { after: 3 } })]);
  const seenCursors: unknown[] = [];
  const poller = new PluginEventPoller(
    prisma,
    async (_connection, _tool, args) => {
      seenCursors.push((args as { cursor: unknown }).cursor);
      return text({ events: [{ id: "e1", kind: "session.completed", text: "Done", resourceId: "s1" }], cursor: { after: 4 } });
    },
    async () => {
      throw new Error("database unavailable");
    }
  );
  await captureWarnings(() => poller.pollDue());
  expect(seenCursors).toEqual([{ after: 3 }]);
  expect(cursors.size).toBe(0);
});

test("a slow remote server is cancelled at the deadline and does not hold up other accounts", async () => {
  const slow = remoteRow({ id: "22222222-2222-4222-8222-222222222222", alias: "slow" });
  const fast = remoteRow();
  const { prisma, cursors } = fakeDatabase([slow, fast]);
  const dispatched: Array<Record<string, unknown>> = [];
  const poller = new PluginEventPoller(
    prisma,
    async (connection, _tool, _args, signal) => {
      if (connection.id === slow.id)
        return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("The operation timed out"))));
      return text({ events: [{ id: "e1", kind: "session.completed", text: "Done", resourceId: "s1" }], cursor: { after: 1 } });
    },
    async (event) => void dispatched.push(event as never),
    () => new Date(),
    20
  );
  const warnings = await captureWarnings(() => poller.pollDue());
  expect(cursors.has(slow.id)).toBe(false);
  expect(cursors.get(CONNECTION_ID)).toEqual({ after: 1 });
  expect(dispatched).toHaveLength(1);
  expect(warnings.join("\n")).toContain("dsh-web/slow");
  expect(warnings.join("\n")).toContain("timed out");
});

test("a packaged email connector keeps its source and ID and runs without a remote deadline", async () => {
  const email = remoteRow({
    transport: "stdio",
    alias: "mail",
    installation: {
      pluginKey: "email",
      manifest: {
        key: "email",
        name: "Email",
        skills: [],
        connections: [{ key: "dsh", transport: "stdio", events: { pollTool: "poll_new_mail", source: "email", intervalSeconds: 60 } }],
      },
    },
  });
  const { prisma } = fakeDatabase([email]);
  let signal: AbortSignal | undefined | null = null;
  const dispatched: Array<Record<string, unknown>> = [];
  const poller = new PluginEventPoller(
    prisma,
    async (_connection, _tool, _args, given) => {
      signal = given;
      return text({ events: [{ id: "mail-1", source: "webhook", kind: "received", text: "Subject: Hi", channel: "bot@example.com" }], cursor: { uidNext: 2 } });
    },
    async (event) => void dispatched.push(event as never)
  );
  await poller.pollDue();
  expect(signal).toBeUndefined();
  expect(dispatched).toEqual([{ id: "mail-1", source: "email", kind: "received", text: "Subject: Hi", channel: "bot@example.com" }]);
});

test("only the first 50 events of a poll run, with a warning", async () => {
  const { prisma, cursors } = fakeDatabase([remoteRow()]);
  const dispatched: unknown[] = [];
  const poller = new PluginEventPoller(
    prisma,
    async () =>
      text({
        events: Array.from({ length: 60 }, (_, index) => ({ id: `e${index}`, kind: "session.completed", text: "", resourceId: "s1" })),
        cursor: { after: 60 },
      }),
    async (event) => void dispatched.push(event)
  );
  const warnings = await captureWarnings(() => poller.pollDue());
  expect(dispatched).toHaveLength(50);
  expect(warnings.some((warning) => warning.includes("returned 60 events; only the first 50 run"))).toBe(true);
  expect(cursors.get(CONNECTION_ID)).toEqual({ after: 60 });
});

test("a remote plugin's events wake only the Bots subscribed to them, once, and the cursor moves after dispatch", async () => {
  if (!url) return;
  const prisma = createPrismaClient(url);
  const root = await mkdtemp(join(tmpdir(), "plugin-event-e2e-"));
  const bots = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const channels = bots.map(() => crypto.randomUUID());
  const data = new AgentDataStore(prisma, { root: join(root, "data"), workspaceRoot: root });
  const messaging = new AgentMessaging(prisma, { send: async () => crypto.randomUUID(), sendDebounced: async () => crypto.randomUUID() } as never, data);
  const routines = new RoutineService(prisma, messaging, data);
  const pluginKey = `dsh-e2e-${crypto.randomUUID().slice(0, 8)}`;
  let installationId = "";
  try {
    await data.writeRootSettings({});
    for (const [index, botId] of bots.entries()) {
      await prisma.bot.create({ data: { id: botId, name: `Plugin fixture ${index}`, defaultDirectory: root, status: "active", onboardingStatus: "completed", conversation: { create: {} } } });
      await prisma.channel.create({ data: { id: channels[index]!, kind: "bot_dm", directKey: `bot:${botId}`, name: `Plugin fixture ${index}`, members: { create: { botId, ordinal: 0 } } } });
      await data.initializeBot(botId);
    }
    const create = (botId: string, trigger: unknown) =>
      routines.mutate(botId, crypto.randomUUID(), null, { action: "create", name: "Watch", prompt: "Report the session result.", trigger }) as Promise<{ id: string }>;
    const bySession = await create(bots[0]!, { type: "plugin", plugin: pluginKey, resourceIds: ["s1"], events: ["session.completed"] });
    const byActor = await create(bots[1]!, { type: "plugin", plugin: pluginKey, actors: ["bot-b"] });
    await create(bots[2]!, { type: "plugin", plugin: "some-other-plugin", resourceIds: ["s1", "s9"] });
    // A subscription that would match every event is refused when it is saved.
    await expect(create(bots[2]!, { type: "plugin", plugin: pluginKey })).rejects.toThrow();

    const manifest = {
      key: pluginKey,
      name: "DSH-WEB fixture",
      skills: [],
      connections: [{ key: "dsh", transport: "http", events: { pollTool: "session_events", source: "plugin", intervalSeconds: 60 } }],
    };
    const installation = await prisma.pluginInstallation.create({
      data: { pluginKey, version: "1.0.0", name: "DSH-WEB fixture", publisher: "Test", manifest },
    });
    installationId = installation.id;
    const connection = await prisma.pluginConnection.create({
      data: {
        installationId: installation.id,
        connectorKey: "dsh",
        alias: "work",
        name: "DSH-WEB",
        transport: "http",
        authType: "token",
        endpoint: "https://dsh.example/mcp",
        status: "ready",
      },
    });

    let now = new Date("2026-11-19T12:00:00Z");
    const seen: Array<{ cursor: unknown; signal?: AbortSignal; transport?: string }> = [];
    const events = [
      { id: "evt-1", kind: "session.completed", text: "Finished the refactor", resourceId: "s1", actor: "bot-a" },
      { id: "evt-2", kind: "session.failed", text: "Build broke", resourceId: "s2", actor: "bot-b" },
      { id: "evt-3", kind: "session.completed", text: "Unwatched", resourceId: "s7", actor: "bot-z" },
    ];
    const poller = new PluginEventPoller(
      prisma,
      async (called, _tool, args, signal) => {
        seen.push({ cursor: (args as { cursor: unknown }).cursor, signal, transport: called.transport });
        return text({ events, cursor: { after: seen.length } });
      },
      (event) => routines.dispatchEventToAll(event),
      () => now
    );
    await poller.pollDue();
    expect(seen).toEqual([{ cursor: null, signal: expect.any(AbortSignal), transport: "http" }]);
    const executions = await prisma.routineExecution.findMany({ where: { routineId: { in: [bySession.id, byActor.id] } } });
    expect(executions.map((execution) => execution.routineId).sort()).toEqual([bySession.id, byActor.id].sort());
    const wake = await prisma.message.findFirstOrThrow({ where: { runId: executions.find((execution) => execution.routineId === bySession.id)!.runId! } });
    expect(wake.content).toContain("<plugin_event>");
    expect(wake.content).toContain(`What woke you: ${pluginKey} session.completed for s1: "Finished the refactor" by bot-a`);
    expect(wake.content).not.toContain("Build broke");
    const stored = await prisma.pluginConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(stored.eventCursor).toEqual({ after: 1 });

    // The server returns the same events again: nothing runs twice, and the next poll resumes from the cursor.
    now = new Date(now.getTime() + 60_000);
    await poller.pollDue();
    expect(seen[1]!.cursor).toEqual({ after: 1 });
    expect(await prisma.routineExecution.count({ where: { routineId: { in: [bySession.id, byActor.id] } } })).toBe(2);
  } finally {
    await prisma.bot.deleteMany({ where: { id: { in: bots } } });
    await prisma.channel.deleteMany({ where: { id: { in: channels } } });
    if (installationId) await prisma.pluginInstallation.deleteMany({ where: { id: installationId } });
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("an older remote server without the poll tool is not a failure: wait quietly, then work once it is upgraded", async () => {
  expect(isUnsupportedPollTool(Object.assign(new Error("MCP error -32601: Method not found"), { code: -32601 }))).toBe(true);
  expect(isUnsupportedPollTool(new Error("Unknown tool: session_events"))).toBe(true);
  expect(isUnsupportedPollTool(new Error("session not found"))).toBe(false);
  expect(isUnsupportedPollTool(new Error("IMAP login failed"))).toBe(false);

  const { prisma, cursors, polledAt } = fakeDatabase([remoteRow()]);
  let now = new Date("2026-11-19T12:00:00Z");
  let upgraded = false;
  let calls = 0;
  const dispatched: unknown[] = [];
  const poller = new PluginEventPoller(
    prisma,
    async () => {
      calls++;
      if (!upgraded) throw Object.assign(new Error("MCP error -32601: Method not found"), { code: -32601 });
      return text({ events: [], cursor: { seq: 7 } });
    },
    async (event) => void dispatched.push(event),
    () => now
  );
  const warnings = await captureWarnings(async () => {
    await poller.pollDue();
    await poller.pollDue();
  });
  expect(calls).toBe(2);
  // One calm notice, not a failure report, and nothing saved.
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("dsh-web/work does not publish its event tool \"session_events\" yet");
  expect(warnings[0]).not.toContain("failed");
  expect(cursors.size).toBe(0);
  // The next check is pushed out: due 15 minutes from now, not at the 60 second interval.
  const deferral = polledAt.at(-1)!.polledAt;
  expect(deferral.getTime() + 60_000 - now.getTime()).toBe(15 * 60_000);

  // After the server is upgraded the poll succeeds and records its baseline cursor.
  upgraded = true;
  now = new Date(now.getTime() + 15 * 60_000);
  await poller.pollDue();
  expect(cursors.get(CONNECTION_ID)).toEqual({ seq: 7 });
});

test("a packaged connector or the email source that lacks its poll tool still reports a failure", async () => {
  const email = remoteRow({
    transport: "stdio",
    alias: "mail",
    installation: {
      pluginKey: "email",
      manifest: { key: "email", name: "Email", skills: [], connections: [{ key: "dsh", transport: "stdio", events: { pollTool: "poll_new_mail", source: "email" } }] },
    },
  });
  const { prisma } = fakeDatabase([email]);
  const poller = new PluginEventPoller(
    prisma,
    async () => {
      throw Object.assign(new Error("MCP error -32601: Method not found"), { code: -32601 });
    },
    async () => undefined
  );
  const warnings = await captureWarnings(() => poller.pollDue());
  expect(warnings.join("\n")).toContain("Plugin event poll failed for email/mail");
});
