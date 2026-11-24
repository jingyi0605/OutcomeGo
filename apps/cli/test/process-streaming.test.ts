import { expect, test } from "bun:test";
import { runStreaming } from "../src/process";

test("joins half-lines, handles UTF-8 bytes, and keeps both streams independent", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const script = `
    const value = Buffer.from('start \\u4e2d');
    process.stdout.write(value.subarray(0, value.length - 1));
    process.stderr.write('error\\n');
    await Bun.sleep(20);
    process.stdout.write(value.subarray(value.length - 1));
    process.stdout.write('\\r\\nfinal');
    process.stderr.write('tail');
  `;
  expect(await runStreaming(process.execPath, ["-e", script], {
    onStdoutLine: (line) => stdout.push(line), onStderrLine: (line) => stderr.push(line),
  })).toEqual({ status: 0 });
  expect(stdout).toEqual(["start \u4e2d", "final"]);
  expect(stderr).toEqual(["error", "tail"]);
});

test("discards an oversized line in full and resumes at the next line", async () => {
  const lines: string[] = [];
  const script = "process.stdout.write('sentinel' + 'x'.repeat(1024 * 1024) + 'secret\\nkept\\n')";
  expect(await runStreaming(process.execPath, ["-e", script], {
    onStdoutLine: (line) => lines.push(line),
  })).toEqual({ status: 0 });
  expect(lines).toEqual(["kept"]);
});

test("an already aborted run never spawns a command", async () => {
  expect(await runStreaming("missing-outcomego-command", [], {
    signal: AbortSignal.abort(),
  })).toEqual({ status: 130 });
});

test("cancellation reaches a child and its grandchild", async () => {
  const controller = new AbortController();
  let descendant: number | undefined;
  const childSource = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)";
  const parentSource = `
    const child = Bun.spawn([process.execPath, '-e', ${JSON.stringify(childSource)}]);
    setTimeout(() => process.stdout.write(String(child.pid) + '\\n'), 50);
    await child.exited;
  `;
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    expect(await runStreaming(process.execPath, ["-e", parentSource], {
      signal: controller.signal,
      onStdoutLine: (line) => {
        descendant = Number(line);
        controller.abort();
      },
    })).toEqual({ status: 130 });
    expect(descendant).toBeGreaterThan(0);
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        process.kill(descendant!, 0);
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("ESRCH");
        return;
      }
      await Bun.sleep(25);
    }
    throw new Error("Cancellation left the grandchild running");
  } finally {
    clearTimeout(timeout);
  }
}, 8_000);
