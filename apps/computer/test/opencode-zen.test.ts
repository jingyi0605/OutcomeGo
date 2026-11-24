import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ChatProviderRegistry } from "../src/chat-provider-registry";
import { createModelRuntime } from "../src/model-runtime";
import {
  OPENCODE_ANONYMOUS_KEY,
  OPENCODE_MIN_VERSION,
  OPENCODE_STUB_DESCRIPTION,
  OPENCODE_TOOLS,
  ZEN_STUB_NOTE,
  applyOpenCodeClientHeaders,
  createOpenCodeFetch,
  fetchLatestOpenCodeVersion,
  isOpenCodeFreeModel,
  isOpenCodeUrl,
  isOpenCodeZenUrl,
  openCodeEnvironment,
  openCodeFreeUrl,
  openCodeHasEnvironment,
  openCodeNewId,
  openCodeProject,
  openCodeRealSession,
  openCodeSession,
  openCodeTrace,
  openCodeUserAgent,
  prepareZenFreeContext,
  resetOpenCodeVersionForTests,
  transformZenFreePayload,
  transformZenFreeStream,
} from "../src/opencode-zen";

const tempDirs: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(() => {
  resetOpenCodeVersionForTests();
  for (const server of servers.splice(0)) server.stop(true);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const mkTempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

describe("OpenCode Zen URL and model classification", () => {
  test("detects OpenCode hosts and separates Zen from Go", () => {
    expect(isOpenCodeUrl("https://opencode.ai/zen/v1")).toBe(true);
    expect(isOpenCodeUrl("https://sub.opencode.ai:8443/zen")).toBe(true);
    expect(isOpenCodeUrl("https://openrouter.ai/api/v1")).toBe(false);

    expect(isOpenCodeZenUrl("https://opencode.ai/zen/v1")).toBe(true);
    expect(isOpenCodeZenUrl("https://opencode.ai/zen/go/v1")).toBe(false);
  });

  test("rewrites Zen free URLs to OpenCode 2 inference paths", () => {
    expect(openCodeFreeUrl("https://opencode.ai/zen/v1", "openai-completions")).toBe(
      "https://opencode.ai/inference/openai/v1"
    );
    expect(openCodeFreeUrl("https://opencode.ai/zen/v1", "openai-responses")).toBe(
      "https://opencode.ai/inference/openai/v1"
    );
    expect(openCodeFreeUrl("https://opencode.ai/zen", "anthropic-messages")).toBe(
      "https://opencode.ai/inference/anthropic"
    );
    expect(openCodeFreeUrl("https://opencode.ai/zen/go/v1", "openai-completions")).toBe(
      "https://opencode.ai/zen/go/v1"
    );
  });

  test("identifies free models by -free suffix, known ids, or zero cost", () => {
    expect(isOpenCodeFreeModel("deepseek-v4.1-flash-free")).toBe(true);
    expect(isOpenCodeFreeModel("big-pickle")).toBe(true);
    expect(isOpenCodeFreeModel("grok-code")).toBe(true);
    expect(isOpenCodeFreeModel("test")).toBe(false);
    expect(isOpenCodeFreeModel("jev-1.13-free")).toBe(false);
    expect(
      isOpenCodeFreeModel("zero-cost-model", {
        provider: "opencode",
        baseUrl: "https://opencode.ai/zen/v1",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      })
    ).toBe(true);
    expect(
      isOpenCodeFreeModel("gpt-5.5", {
        provider: "opencode",
        baseUrl: "https://opencode.ai/zen/v1",
        cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
      })
    ).toBe(false);
    expect(
      isOpenCodeFreeModel("mimo-v2.6-flash-free", {
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      })
    ).toBe(false);
  });
});

describe("OpenCode 2.2.5 client headers, session, trace, and project ids", () => {
  test("produces valid descending ses_ ids and keeps trace per session with new span per request", () => {
    const generated = openCodeNewId("ses", true);
    expect(openCodeRealSession(generated)).toBe(true);
    expect(openCodeRealSession("ses_notvalid")).toBe(false);

    const s1 = openCodeSession("conv-a");
    const s2 = openCodeSession("conv-a");
    const s3 = openCodeSession("conv-b");
    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);
    expect(openCodeRealSession(s1)).toBe(true);

    const t1 = openCodeTrace(s1);
    const t2 = openCodeTrace(s1);
    const t3 = openCodeTrace(s3);
    expect(t1.b3).toMatch(/^[0-9a-f]{32}-[0-9a-f]{16}-1-[0-9a-f]{16}$/);
    expect(t1.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    // Same trace id, different span id across turns in the same session.
    expect(t1.traceparent.slice(3, 35)).toBe(t2.traceparent.slice(3, 35));
    expect(t1.traceparent.slice(36, 52)).not.toBe(t2.traceparent.slice(36, 52));
    // Different trace id for a different conversation.
    expect(t1.traceparent.slice(3, 35)).not.toBe(t3.traceparent.slice(3, 35));
  });

  test("computes x-opencode-project for git remotes and plain directories", () => {
    const repoDir = mkTempDir("opencode-repo-");
    mkdirSync(join(repoDir, ".git"), { recursive: true });
    writeFileSync(
      join(repoDir, ".git", "config"),
      '[remote "origin"]\n\turl = https://github.com/Example/Project.git\n'
    );
    const plainDir = mkTempDir("opencode-plain-");
    expect(openCodeProject(repoDir)).toMatch(/^[0-9a-f]{40}$/);
    expect(openCodeProject(plainDir)).toMatch(/^[0-9a-f]{40}$/);
    expect(openCodeProject(repoDir)).not.toBe(openCodeProject(plainDir));
    expect(openCodeEnvironment(repoDir)).toContain("Is directory a git repo: yes");
    expect(openCodeEnvironment(plainDir)).toContain("Is directory a git repo: no");
    expect(openCodeHasEnvironment(openCodeEnvironment(plainDir))).toBe(true);
  });

  test("validates OpenCode updater version responses", async () => {
    let reply = JSON.stringify({ version: "2.3.1" });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response(reply);
      },
    });
    servers.push(server);
    expect(await fetchLatestOpenCodeVersion(server.url.origin, OPENCODE_MIN_VERSION)).toBe("2.3.1");
    reply = JSON.stringify({ version: "1.19.0" });
    expect(await fetchLatestOpenCodeVersion(server.url.origin, OPENCODE_MIN_VERSION)).toBe("");
    reply = "not-json";
    expect(await fetchLatestOpenCodeVersion(server.url.origin, OPENCODE_MIN_VERSION)).toBe("");
    expect(openCodeUserAgent()).toBe(`opencode/latest/${OPENCODE_MIN_VERSION}/cli`);
  });

  test("applyOpenCodeClientHeaders sets all required headers and strips x-opencode-request", () => {
    const headers = new Headers({ "x-opencode-request": "msg_old" });
    applyOpenCodeClientHeaders(headers, "seed-1", "/tmp");
    expect(headers.get("x-opencode-request")).toBeNull();
    expect(headers.get("x-opencode-client")).toBe("cli");
    expect(headers.get("Accept")).toBe("*/*");
    expect(headers.get("User-Agent")).toMatch(/^opencode\/latest\/\d+\.\d+\.\d+\/cli$/);
    const ses = headers.get("x-opencode-session")!;
    expect(openCodeRealSession(ses)).toBe(true);
    expect(headers.get("x-opencode-session-id")).toBe(ses);
    expect(headers.get("x-session-affinity")).toBe(ses);
    expect(headers.get("x-session-id")).toBe(ses);
    expect(headers.get("x-opencode-project")).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("Zen Free tools, payload, fetch, and stream adaptation", () => {
  test("renames Read/Shell, adds stubs for missing core tools, and adds env block", () => {
    const dir = mkTempDir("zen-context-");
    const context: Context = {
      systemPrompt: "You are helpful.",
      tools: [
        { name: "SendToUser", description: "send", parameters: Type.Object({}) },
        { name: "Read", description: "read", parameters: Type.Object({ path: Type.String() }) },
        { name: "Shell", description: "shell", parameters: Type.Object({ command: Type.String() }) },
      ],
      messages: [
        {
          role: "assistant",
          content: [
            { type: "toolCall", id: "c1", name: "Read", arguments: { path: "a.txt" } },
          ],
          api: "openai-completions",
          provider: "opencode",
          model: "big-pickle",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "toolUse",
          timestamp: 1,
        },
        {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "Read",
          content: [{ type: "text", text: "ok" }],
          isError: false,
          timestamp: 2,
        },
      ],
    };

    const { context: adapted, mapping } = prepareZenFreeContext(context, dir);
    expect(adapted.tools?.map((t) => t.name)).toEqual([
      "SendToUser",
      "read",
      "shell",
      "edit",
      "glob",
      "grep",
    ]);
    expect(mapping.back.get("read")).toBe("Read");
    expect(mapping.back.get("shell")).toBe("Shell");
    expect([...mapping.stubs].sort()).toEqual(["edit", "glob", "grep"]);
    expect(adapted.tools?.find((t) => t.name === "edit")?.description).toBe(OPENCODE_STUB_DESCRIPTION);
    expect(openCodeHasEnvironment(adapted.systemPrompt ?? "")).toBe(true);
    expect((adapted.messages[0] as AssistantMessage).content[0]).toMatchObject({ name: "read" });
    expect(adapted.messages[1]).toMatchObject({ toolName: "read" });

    const payload = transformZenFreePayload(
      {
        stream: false,
        tool_choice: { type: "function", function: { name: "Read" } },
        tools: [{ type: "function", function: { name: "read", parameters: {} } }],
      },
      "openai-completions",
      mapping.to
    ) as Record<string, unknown>;
    expect(payload.stream).toBe(true);
    expect(payload.tool_choice).toEqual({ type: "function", function: { name: "read" } });
    expect((payload.tools as Array<{ function: { strict: boolean } }>)[0]?.function.strict).toBe(false);
  });

  test("maps renamed tool calls back and drops stub calls", async () => {
    const inner = createAssistantMessageEventStream();
    const mapping = {
      back: new Map([["read", "Read"]]),
      to: new Map([["Read", "read"]]),
      stubs: new Set(["edit", "glob", "grep", "shell"]),
    };
    const out = transformZenFreeStream(inner, mapping);

    const makePartial = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "pending"): AssistantMessage => ({
      role: "assistant",
      content,
      api: "openai-completions",
      provider: "opencode",
      model: "big-pickle",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason,
      timestamp: 1,
    });

    const readCall = { type: "toolCall" as const, id: "t1", name: "read", arguments: { path: "a" } };
    const stubCall = { type: "toolCall" as const, id: "t2", name: "glob", arguments: { pattern: "*" } };

    inner.push({ type: "start", partial: makePartial([]) });
    inner.push({ type: "toolcall_start", contentIndex: 0, partial: makePartial([readCall]) });
    inner.push({ type: "toolcall_end", contentIndex: 0, toolCall: readCall, partial: makePartial([readCall]) });
    inner.push({ type: "toolcall_start", contentIndex: 1, partial: makePartial([readCall, stubCall]) });
    inner.push({ type: "toolcall_end", contentIndex: 1, toolCall: stubCall, partial: makePartial([readCall, stubCall]) });
    inner.push({ type: "done", reason: "toolUse", message: makePartial([readCall, stubCall], "toolUse") });
    inner.end();

    const events = [];
    for await (const event of out) events.push(event);
    const result = await out.result();
    expect(result.content).toEqual([{ ...readCall, name: "Read" }]);
    expect(result.stopReason).toBe("toolUse");
    expect(events.filter((e) => e.type === "toolcall_end")).toHaveLength(1);
    expect((events.find((e) => e.type === "toolcall_end") as { toolCall: { name: string } }).toolCall.name).toBe("Read");

    // When ONLY a stub was called and no text was emitted, turns into plain stop with ZEN_STUB_NOTE.
    const innerStubOnly = createAssistantMessageEventStream();
    const outStubOnly = transformZenFreeStream(innerStubOnly, mapping);
    innerStubOnly.push({ type: "start", partial: makePartial([]) });
    innerStubOnly.push({ type: "toolcall_start", contentIndex: 0, partial: makePartial([stubCall]) });
    innerStubOnly.push({ type: "toolcall_end", contentIndex: 0, toolCall: stubCall, partial: makePartial([stubCall]) });
    innerStubOnly.push({ type: "done", reason: "toolUse", message: makePartial([stubCall], "toolUse") });
    innerStubOnly.end();

    const stubResult = await outStubOnly.result();
    expect(stubResult.stopReason).toBe("stop");
    expect(stubResult.content).toEqual([{ type: "text", text: ZEN_STUB_NOTE }]);
  });

  test("createOpenCodeFetch strips SDK fingerprints and converts bare 400 to 502", async () => {
    let seenHeaders: Headers | undefined;
    let status = 200;
    let body = "{}";
    const wrapped = createOpenCodeFetch(
      (async (_input, init) => {
        seenHeaders = new Headers(init?.headers);
        return new Response(body, { status });
      }) as typeof fetch,
      { zenFree: true, sessionSeed: "seed-fetch", dir: "/tmp" }
    );

    await wrapped("https://opencode.ai/inference/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer public",
        "content-type": "application/json",
        "x-stainless-os": "Linux",
        "user-agent": "OpenAI/JS 4.0",
      },
      body: "{}",
    });
    expect(seenHeaders?.get("x-stainless-os")).toBeNull();
    expect(seenHeaders?.get("authorization")).toBe("Bearer public");
    expect(seenHeaders?.get("user-agent")).toMatch(/^opencode\/latest\//);

    status = 400;
    body = '{"model":"deepseek-v4.1-flash-free"}';
    const bare = await wrapped("https://opencode.ai/inference/openai/v1/chat/completions", {
      method: "POST",
    });
    expect(bare.status).toBe(502);

    body = '{"error":{"message":"real error"}}';
    const realErr = await wrapped("https://opencode.ai/inference/openai/v1/chat/completions", {
      method: "POST",
    });
    expect(realErr.status).toBe(400);
  });
});

describe("OpenCode Zen catalog discovery and runtime integration", () => {
  test("public key filters Zen catalog to free models and excludes test/jev entries", async () => {
    const dir = mkTempDir("zen-catalog-");
    writeFileSync(join(dir, "models-store.json"), "{}");
    writeFileSync(
      join(dir, "auth.json"),
      JSON.stringify({ opencode: { type: "api_key", key: OPENCODE_ANONYMOUS_KEY } })
    );
    const runtime = await createModelRuntime({
      authPath: join(dir, "auth.json"),
      modelsPath: join(dir, "models.json"),
      modelsStorePath: join(dir, "models-store.json"),
      allowModelNetwork: false,
    });

    const seenHeaders: Headers[] = [];
    const fetcher = (async (_url: URL | string, init?: RequestInit) => {
      seenHeaders.push(new Headers(init?.headers));
      return Response.json({
        object: "list",
        data: [
          { id: "big-pickle" },
          { id: "deepseek-v4.1-flash-free" },
          { id: "muse-spark-1.2-contributor-free" },
          { id: "claude-opus-4-6" },
          { id: "gpt-5.5" },
          { id: "jev-1.13-free" },
          { id: "test" },
        ],
      });
    }) as unknown as typeof fetch;

    const registry = new ChatProviderRegistry(() => runtime, join(dir, "models.json"), fetcher);
    const publicCatalog = await registry.catalog("opencode");
    expect(seenHeaders[0]?.get("x-opencode-session")).toBeTruthy();
    expect(seenHeaders[0]?.get("authorization")).toBe("Bearer public");
    expect(publicCatalog.models.map((m) => m.id)).toEqual([
      "big-pickle",
      "deepseek-v4.1-flash-free",
      "muse-spark-1.2-contributor-free",
    ]);
    expect(publicCatalog.models[0]?.recommended).toBe(true);

    // Paid key lists paid models as well, keeping Anthropic baseUrl without /v1.
    writeFileSync(
      join(dir, "auth.json"),
      JSON.stringify({ opencode: { type: "api_key", key: "sk-own-zen" } })
    );
    await runtime.refresh({ allowNetwork: false });
    const paidCatalog = await registry.catalog("opencode");
    expect(paidCatalog.models.map((m) => m.id)).toEqual([
      "big-pickle",
      "deepseek-v4.1-flash-free",
      "muse-spark-1.2-contributor-free",
      "claude-opus-4-6",
      "gpt-5.5",
    ]);
    const claude = paidCatalog.models.find((m) => m.id === "claude-opus-4-6") as Model<string> | undefined;
    expect(claude?.baseUrl).toBe("https://opencode.ai/zen");
  });

  test("createModelRuntime streams free model via /inference/openai/v1 with OpenCode headers and tool adaptation", async () => {
    const dir = mkTempDir("zen-e2e-");
    writeFileSync(join(dir, "models-store.json"), "{}");
    writeFileSync(join(dir, "auth.json"), "{}");

    const captured: Array<{ path: string; headers: Headers; body: Record<string, unknown> }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = (await request.json()) as Record<string, unknown>;
        captured.push({ path: url.pathname, headers: new Headers(request.headers), body });
        const chunks = [
          `data: ${JSON.stringify({
            id: "c1",
            object: "chat.completion.chunk",
            created: 0,
            model: "big-pickle",
            choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
          })}\n\n`,
          "data: [DONE]\n\n",
        ];
        return new Response(chunks.join(""), {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    servers.push(server);

    const runtime = await createModelRuntime({
      authPath: join(dir, "auth.json"),
      modelsPath: join(dir, "models.json"),
      modelsStorePath: join(dir, "models-store.json"),
      allowModelNetwork: false,
    });

    let seenPlaceholder: string | undefined;
    await runtime.login("opencode", "api_key", {
      prompt: async (prompt) => {
        if ("placeholder" in prompt) seenPlaceholder = prompt.placeholder;
        return OPENCODE_ANONYMOUS_KEY;
      },
      notify() {},
    });
    expect(seenPlaceholder).toBe(OPENCODE_ANONYMOUS_KEY);

    const baseModel = runtime.getModel("opencode", "big-pickle")!;
    expect(baseModel).toBeDefined();
    // Point host to opencode.ai while using custom fetch to route to local mock server.
    const mockFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const parsed = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const localUrl = `${server.url.origin}${parsed.pathname}${parsed.search}`;
      return fetch(localUrl, init);
    }) as typeof fetch;

    const reply = await runtime.completeSimple(
      baseModel,
      {
        systemPrompt: "Test prompt",
        messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
        tools: [{ name: "Read", description: "read", parameters: Type.Object({ path: Type.String() }) }],
      },
      { fetch: mockFetch }
    );

    expect(reply.stopReason).toBe("stop");
    expect(reply.content).toEqual([{ type: "text", text: "OK" }]);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.path).toBe("/inference/openai/v1/chat/completions");
    expect(captured[0]!.headers.get("authorization")).toBe("Bearer public");
    expect(captured[0]!.headers.get("x-opencode-client")).toBe("cli");
    expect(captured[0]!.headers.get("x-stainless-os")).toBeNull();
    expect(openCodeRealSession(captured[0]!.headers.get("x-opencode-session") ?? "")).toBe(true);
    const toolNames = (captured[0]!.body.tools as Array<{ function: { name: string } }>).map(
      (t) => t.function.name
    );
    expect(toolNames).toEqual([...OPENCODE_TOOLS].sort((a, b) => (a === "read" ? -1 : b === "read" ? 1 : 0)));
    const sysMsg = (captured[0]!.body.messages as Array<{ role: string; content: string }>)[0]!;
    expect(sysMsg.role).toBe("system");
    expect(openCodeHasEnvironment(sysMsg.content)).toBe(true);
  });
});
