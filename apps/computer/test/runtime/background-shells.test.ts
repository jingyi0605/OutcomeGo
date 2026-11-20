import { describe, expect, test } from "bun:test";
import {
  backgroundWorkPending,
  observeShellAwait,
  recordBackgroundShell,
} from "../../src/runtime/background-shells";

const turn = () => ({}) as Parameters<typeof recordBackgroundShell>[0];

describe("background shell tracking", () => {
  test("a command that finished inside the call is not background work", () => {
    const active = turn();
    recordBackgroundShell(active, undefined, { shellId: "a", status: "completed", exitCode: 0 });
    expect(backgroundWorkPending(active)).toBe(false);
  });

  test("a local command that outlived its block is owed until a wait reads its result", () => {
    const active = turn();
    recordBackgroundShell(active, undefined, { shellId: "a", status: "running" });
    expect(backgroundWorkPending(active)).toBe(true);
    observeShellAwait(active, undefined, "a", { status: "running" });
    expect(backgroundWorkPending(active)).toBe(true);
    observeShellAwait(active, undefined, "a", { status: "completed" });
    expect(backgroundWorkPending(active)).toBe(false);
  });

  test("a failed wait result also consumes the completion", () => {
    const active = turn();
    recordBackgroundShell(active, undefined, { shellId: "a", status: "running" });
    observeShellAwait(active, undefined, "a", { status: "failed" });
    expect(backgroundWorkPending(active)).toBe(false);
  });

  test("a host command reports snake_case ids and is keyed by machine", () => {
    const active = turn();
    recordBackgroundShell(active, "mac-1", { shell_id: "a", status: "running" });
    recordBackgroundShell(active, undefined, { shellId: "a", status: "running" });
    observeShellAwait(active, "mac-1", "a", { status: "completed" });
    // The box command with the same id is a different command and is still owed.
    expect(backgroundWorkPending(active)).toBe(true);
    observeShellAwait(active, undefined, "a", { status: "completed" });
    expect(backgroundWorkPending(active)).toBe(false);
  });

  test("a sleep, an unknown id, or a missing id changes nothing", () => {
    const active = turn();
    recordBackgroundShell(active, undefined, { status: "running" });
    recordBackgroundShell(active, undefined, undefined);
    observeShellAwait(active, undefined, undefined, { status: "completed" });
    observeShellAwait(active, undefined, "x", { status: "completed" });
    expect(backgroundWorkPending(active)).toBe(false);
  });

  test("two commands need two reads", () => {
    const active = turn();
    recordBackgroundShell(active, undefined, { shellId: "a", status: "running" });
    recordBackgroundShell(active, undefined, { shellId: "b", status: "running" });
    observeShellAwait(active, undefined, "a", { status: "completed" });
    expect(backgroundWorkPending(active)).toBe(true);
    observeShellAwait(active, undefined, "b", { status: "completed" });
    expect(backgroundWorkPending(active)).toBe(false);
  });
});
