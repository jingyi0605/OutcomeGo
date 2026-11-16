import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComputerRuntime } from "../../src/runtime";

const turn = (overrides: Record<string, unknown> = {}): any => ({
  runId: "run-1",
  botId: "bot-1",
  contextSessionId: "context-1",
  screenBotId: "screen-1",
  conversationId: "conversation-1",
  channelId: "channel-1",
  deliveryId: null,
  cwd: "/tmp",
  runtimeProfile: "agent",
  subagentType: null,
  requestSource: "turn",
  readOnly: false,
  pluginNamespaces: [],
  ...overrides,
});

test("Bitwarden reads keep the credential out of the tool result and return only a browser reference", async () => {
  const root = await mkdtemp(join(tmpdir(), "outcomego-bitwarden-runtime-"));
  const previousRoot = process.env.OUTCOMEGO_AGENT_DATA_ROOT;
  const previousFetch = globalThis.fetch;
  const secret = "credential-never-enters-context";
  const installPath = join(root, "plugins", "cache", "outcomego", "bitwarden", "test-revision");
  const cachedInstallPath = "/Users/jackson/.openteam-dev/mnt/agent-data/plugins/cache/outcomego/bitwarden/test-revision";
  const wrapper = join(installPath, "skills", "bitwarden", "scripts", "bw.sh");
  await mkdir(join(root, "plugin-skills"), { recursive: true });
  await mkdir(join(installPath, "skills", "bitwarden", "scripts"), { recursive: true });
  await writeFile(join(root, "plugin-skills", "cache.json"), JSON.stringify({
    packages: [{ pluginId: "bitwarden", installPath: cachedInstallPath }],
  }));
  await writeFile(wrapper, `#!/bin/sh\nprintf '%s\\n' '{"ok":true,"value":"${secret}"}'\n`);
  await chmod(wrapper, 0o755);
  process.env.OUTCOMEGO_AGENT_DATA_ROOT = root;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as { tool: string };
    if (request.tool === "ReadBitwardenCredential") return Response.json({ leaseToken: "read-lease" });
    if (request.tool === "ConsumeBitwardenReadLease") {
      return Response.json({
        environment: {
          BW_SERVER_URL: "https://vault.example.test",
          BW_EMAIL: "bot@example.test",
          BW_CLIENT_ID: "client-id",
          BW_CLIENT_SECRET: "client-secret",
          BW_MASTER_PASSWORD: "master-password",
        },
      });
    }
    throw new Error(`Unexpected private tool ${request.tool}`);
  }) as typeof fetch;

  try {
    const runtime = new ComputerRuntime();
    const tools = (runtime as any).tools;
    const result = await tools.executeOutcomeGoTool(
      turn(),
      "call-1",
      "CallDynamicTool",
      {
        namespace: "cursor",
        toolName: "ReadBitwardenCredential",
        arguments: {
          itemId: "00000000-0000-0000-0000-000000000001",
          field: "password",
        },
      },
    );
    const text = result.content[0].text as string;
    expect(text).toContain('"stored":true');
    expect(text).toContain('"browserReference":"$OUTCOMEGO_BITWARDEN_PASSWORD_');
    expect(text).not.toContain(secret);
    expect(result.details).not.toHaveProperty("value");
    const variable = result.details.environmentVariable as string;
    expect(process.env[variable]).toBe(secret);
    tools.clearBitwardenSecrets(turn());
    expect(process.env[variable]).toBeUndefined();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRoot === undefined) delete process.env.OUTCOMEGO_AGENT_DATA_ROOT;
    else process.env.OUTCOMEGO_AGENT_DATA_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("Bitwarden search spans all connected instances and tags candidates with connectionId and instanceName", async () => {
  const root = await mkdtemp(join(tmpdir(), "outcomego-bitwarden-search-"));
  const previousRoot = process.env.OUTCOMEGO_AGENT_DATA_ROOT;
  const previousFetch = globalThis.fetch;
  const installPath = join(root, "plugins", "cache", "outcomego", "bitwarden", "test-revision");
  const wrapper = join(installPath, "skills", "bitwarden", "scripts", "bw.sh");
  await mkdir(join(root, "plugin-skills"), { recursive: true });
  await mkdir(join(installPath, "skills", "bitwarden", "scripts"), { recursive: true });
  await writeFile(join(root, "plugin-skills", "cache.json"), JSON.stringify({
    packages: [{ pluginId: "bitwarden", installPath }],
  }));
  await writeFile(
    wrapper,
    [
      "#!/bin/sh",
      'if [ "$BW_EMAIL" = "alice@example.com" ]; then',
      '  printf \'%s\\n\' \'{"ok":true,"kind":"search","ambiguous":false,"candidates":[{"itemId":"00000000-0000-0000-0000-000000000001","title":"GitHub Personal","hostnames":["github.com"]}]}\'',
      'else',
      '  printf \'%s\\n\' \'{"ok":true,"kind":"search","ambiguous":false,"candidates":[{"itemId":"00000000-0000-0000-0000-000000000002","title":"GitHub Work","hostnames":["github.com"]}]}\'',
      "fi",
    ].join("\n")
  );
  await chmod(wrapper, 0o755);
  process.env.OUTCOMEGO_AGENT_DATA_ROOT = root;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const req = JSON.parse(String(init.body)) as { tool: string };
    if (req.tool === "SearchBitwardenItems") return Response.json({ leaseToken: "search-lease" });
    if (req.tool === "ConsumeBitwardenSearchLease") {
      return Response.json({
        instances: [
          {
            connectionId: "11111111-1111-1111-1111-111111111111",
            instanceName: "alice@example.com",
            environment: { BW_SERVER_URL: "https://vault.one.test", BW_EMAIL: "alice@example.com", BW_CLIENT_ID: "a", BW_CLIENT_SECRET: "b", BW_MASTER_PASSWORD: "c" },
          },
          {
            connectionId: "22222222-2222-2222-2222-222222222222",
            instanceName: "bob@vault.test",
            environment: { BW_SERVER_URL: "https://vault.two.test", BW_EMAIL: "bob@vault.test", BW_CLIENT_ID: "d", BW_CLIENT_SECRET: "e", BW_MASTER_PASSWORD: "f" },
          },
        ],
      });
    }
    throw new Error(`Unexpected private tool ${req.tool}`);
  }) as typeof fetch;

  try {
    const runtime = new ComputerRuntime();
    const tools = (runtime as any).tools;
    const result = await tools.executeOutcomeGoTool(
      turn(),
      "call-search",
      "CallDynamicTool",
      {
        namespace: "cursor",
        toolName: "SearchBitwardenItems",
        arguments: { query: "github.com" },
      }
    );
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.ambiguous).toBe(true);
    expect(parsed.candidates).toEqual([
      {
        itemId: "00000000-0000-0000-0000-000000000001",
        title: "GitHub Personal",
        hostnames: ["github.com"],
        connectionId: "11111111-1111-1111-1111-111111111111",
        instanceName: "alice@example.com",
      },
      {
        itemId: "00000000-0000-0000-0000-000000000002",
        title: "GitHub Work",
        hostnames: ["github.com"],
        connectionId: "22222222-2222-2222-2222-222222222222",
        instanceName: "bob@vault.test",
      },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRoot === undefined) delete process.env.OUTCOMEGO_AGENT_DATA_ROOT;
    else process.env.OUTCOMEGO_AGENT_DATA_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});
