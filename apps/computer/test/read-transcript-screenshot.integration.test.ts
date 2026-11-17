import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMPUTER_USE_TOOL } from "@outcomego/contracts";
import { createPrismaClient } from "@outcomego/db";
import { readTranscript } from "@outcomego/messaging";
import { NativeToolExecutor } from "../src/native-tool-executor";
import { RuntimeTools } from "../src/runtime/tools";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
test.skipIf(!url)("recovered canonical Computer receipts still lead to a readable screenshot without replaying private input", async () => {
  const db = createPrismaClient(url!);
  const root = await mkdtemp(join(tmpdir(), "outcomego-transcript-screenshot-"));
  let botId: string | undefined, channelId: string | undefined;
  try {
    const bot = await db.bot.create({ data: {
      name: "Transcript screenshot", status: "active", defaultDirectory: root, conversation: { create: {} },
    }, include: { conversation: true } });
    botId = bot.id;
    const channel = await db.channel.create({ data: { kind: "bot_dm", name: "Transcript screenshot", members: { create: { botId, ordinal: 0 } } } });
    channelId = channel.id;
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4////fwAJ+wP92PZgeAAAAABJRU5ErkJggg==", "base64");
    const tools = Object.assign(Object.create(RuntimeTools.prototype), {
      workspaceRoot: root, screens: { actComputerUse: async () => png },
    }) as unknown as {
      callComputerUse(active: unknown, input: unknown): Promise<{
        content: Array<
          { type: "text"; text: string } |
          { type: "image"; data: string; mimeType: string }
        >;
        details: { path: string };
      }>;
    };
    // Exercise the production Computer result writer; only the screen transport is a fixture.
    const result = await tools.callComputerUse({ botId, screenBotId: botId, cwd: root, lastGraphicalSurface: "computer" }, { action: "type", text: "PRIVATE_TYPED_INPUT" });
    const screenshot = result.details.path;
    expect(screenshot).toContain(join(root, "shared", "screenshots"));
    expect(await readFile(screenshot)).toEqual(png);
    const run = await db.run.create({ data: {
      botId, conversationId: bot.conversation!.id, channelId, userMessageId: crypto.randomUUID(), status: "interrupted",
    } });
    const inputs = [
      { tool: COMPUTER_USE_TOOL.name, arguments: { action: "type", text: "PRIVATE_TYPED_INPUT" } },
      { tool: "outcomego_computer", arguments: { action: "type", text: "PRIVATE_TYPED_INPUT" } },
      { tool: "Screenshot", arguments: {} },
      { tool: "CallDynamicTool", arguments: { namespace: "cursor", toolName: COMPUTER_USE_TOOL.name, arguments: { action: "type", text: "PRIVATE_TYPED_INPUT" } } },
    ];
    for (const input of inputs) await db.runItem.create({ data: {
      runId: run.id, kind: "tool", status: "completed", content: { ...input, result },
    } });
    const recovered = await readTranscript(db, { botId, channelId }, {});
    expect(recovered.rows).toHaveLength(inputs.length);
    expect(recovered.rows.every(row => {
      const output = JSON.parse(row.content).output;
      return typeof output === "string" && output.includes(screenshot);
    })).toBe(true);
    expect(JSON.stringify(recovered)).not.toContain("PRIVATE_TYPED_INPUT");
    expect(JSON.stringify(recovered)).not.toContain(png.toString("base64"));
    const recoveredPath = /saved to (.+?), and if/.exec(JSON.parse(recovered.rows[0]!.content).output)?.[1];
    expect(recoveredPath).toBe(screenshot);
    const reader = new NativeToolExecutor({ agentDir: join(root, "runtime"), controlToken: "transcript-fixture" });
    const image = await reader.read({ path: recoveredPath! }, root);
    expect(image.content[0]).toEqual({ type: "text", text: `Read image file: ${await realpath(screenshot)}` });
    expect(image.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
  } finally {
    if (botId) await db.bot.deleteMany({ where: { id: botId } });
    if (channelId) await db.channel.deleteMany({ where: { id: channelId } });
    await db.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
});
