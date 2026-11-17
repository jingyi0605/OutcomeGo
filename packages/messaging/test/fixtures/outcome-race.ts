import { expect } from "bun:test";
import type { PrismaClient } from "@outcomego/db";
import { settleOutcomeWorkItem } from "../../src";

/** Pause after the settlement family snapshot; wait for a concurrent producer to block on its lock. */
export async function settleAgainstCallback(db: PrismaClient, runId: string, produce: (db: PrismaClient) => Promise<unknown>) {
  let callback: Promise<unknown> | undefined;
  let callbackPid: number | undefined;
  let callbackDone = false;
  const producerDb = new Proxy(db, { get(target, property) {
    if (property !== "$transaction") return Reflect.get(target, property);
    return (write: (tx: unknown) => Promise<unknown>) => target.$transaction(async tx => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      callbackPid = row!.pid;
      return write(tx);
    });
  } });
  try {
    await db.$transaction(async tx => {
      const run = new Proxy(tx.run, { get(target, property) {
        if (property !== "findMany") return Reflect.get(target, property);
        return async (query: Parameters<typeof tx.run.findMany>[0]) => {
          const family = await target.findMany(query);
          callback = produce(producerDb).finally(() => { callbackDone = true; });
          let waiting = false;
          for (let attempt = 0; attempt < 200 && !callbackDone && !waiting; attempt++) {
            if (callbackPid) {
              const activity = await db.$queryRaw<Array<{ wait_event: string | null }>>`SELECT wait_event FROM pg_stat_activity WHERE pid = ${callbackPid}`;
              waiting = activity[0]?.wait_event === "advisory";
            }
            if (!waiting && !callbackDone) await Bun.sleep(5);
          }
          expect(waiting).toBe(true);
          expect(callbackDone).toBe(false);
          return family;
        };
      } });
      const wrapped = new Proxy(tx, { get(target, property) { return property === "run" ? run : Reflect.get(target, property); } });
      await settleOutcomeWorkItem(wrapped, runId);
    });
    await callback;
  } finally { await callback?.catch(() => undefined); }
}
