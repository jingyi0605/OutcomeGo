import { describe, expect, test } from "bun:test";
import { markSettlementMessage, runHasOpenWork } from "../src/notifications";

const fakeTx = (options: { payload?: unknown; open?: number; backgroundWorkPending?: boolean }) => {
  const calls: { count?: unknown; sql?: string } = {};
  const tx = {
    run: { findUnique: async () => ({ backgroundWorkPending: options.backgroundWorkPending ?? false }) },
    inboxEvent: { findFirst: async () => (options.payload === undefined ? null : { payload: options.payload }) },
    subagent: {
      count: async (args: unknown) => {
        calls.count = args;
        return options.open ?? 0;
      },
    },
    $executeRaw: async (strings: TemplateStringsArray) => {
      calls.sql = strings.join("?");
      return 1;
    },
  };
  return { tx: tx as never, calls };
};

describe("settlement marker", () => {
  test("a turn with a worker still owed its result is not settled", async () => {
    const { tx, calls } = fakeTx({ open: 1 });
    expect(await runHasOpenWork(tx, "run-1")).toBe(true);
    expect(calls.count).toEqual({
      where: {
        status: { in: ["provisioning", "queued", "running", "waiting"] },
        OR: [{ parentRunId: "run-1" }, { requestRunId: { in: ["run-1"] } }],
      },
    });
  });

  test("a wake that continues an earlier request also counts that request's workers", async () => {
    const { tx, calls } = fakeTx({ payload: { taskContextRunId: "root-1" } });
    expect(await runHasOpenWork(tx, "run-2")).toBe(false);
    expect((calls.count as { where: { OR: unknown[] } }).where.OR[1]).toEqual({
      requestRunId: { in: ["run-2", "root-1"] },
    });
  });

  test("a background command the turn left running defers settlement without asking the workers", async () => {
    const { tx, calls } = fakeTx({ backgroundWorkPending: true });
    expect(await runHasOpenWork(tx, "run-3")).toBe(true);
    expect(calls.count).toBeUndefined();
  });

  test("marking is idempotent and never overwrites an existing marker", async () => {
    const { tx, calls } = fakeTx({});
    await markSettlementMessage(tx, "message-1");
    expect(calls.sql).toContain(`'{"settled": true}'::jsonb`);
    expect(calls.sql).toContain("NOT (COALESCE");
  });
});
