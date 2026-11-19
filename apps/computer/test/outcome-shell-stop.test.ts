import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeToolExecutor } from "../src/native-tool-executor";
import { RuntimeTools } from "../src/runtime/tools";
import { ComputerRuntime } from "../src/runtime";

test("scoped Outcome stop preserves main, Routine and another Outcome; old all-Bot stop still works", async () => {
  const root = await mkdtemp(join(tmpdir(), "outcome-shell-stop-"));
  await chmod(root, 0o755);
  const executor = new NativeToolExecutor({ agentDir: root, controlToken: "fixture" });
  const tools = Object.assign(Object.create(RuntimeTools.prototype), { nativeToolExecutor: executor });
  const runtime = Object.assign(Object.create(ComputerRuntime.prototype), { tools }) as ComputerRuntime;
  const jobs: Array<{ id: string; run: string | undefined }> = [];
  const status = async (id: string, wait = 0) => (await executor.awaitShell({ shell_id: id, block_until_ms: wait }, undefined, "bot")).details.status;
  try {
    for (const run of [undefined, "routine", "outcome-a", "outcome-a-continuation", "outcome-b"]) {
      const result = await executor.shell({ command: "sleep 20", block_until_ms: 0 }, root, undefined, undefined, "bot", run ? { automationRunId: run } : {});
      jobs.push({ id: String(result.details?.shellId), run });
    }
    expect(runtime.stopBackgroundShells("bot", [])).toBe(0);
    expect(runtime.stopBackgroundShells("bot", ["outcome-a", "outcome-a-continuation"])).toBe(2);
    for (const job of jobs) {
      const stopped = job.run?.startsWith("outcome-a");
      expect(await status(job.id, stopped ? 3000 : 0)).toBe(stopped ? "completed" : "running");
    }
    expect(runtime.stopBackgroundShells("bot")).toBe(3);
    for (const job of jobs) await status(job.id, 3000);
  } finally {
    runtime.stopBackgroundShells("bot");
    for (const job of jobs) await status(job.id, 3000).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
