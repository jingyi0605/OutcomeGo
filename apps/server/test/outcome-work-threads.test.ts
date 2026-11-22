import { expect, test } from "bun:test";
import { Effect } from "effect";
import { workThreadCanStop } from "@outcomego/contracts/outcomes";
import { OutcomeService } from "../src/services/outcome-service";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";
const row = (id: string, status: string, dependsOn: string[] = []) => ({
  id, outcomeId: "outcome-1", outcome: { title: "Compare" }, botId: "bot-1", title: id,
  status, completedAt: null, updatedAt: new Date("2026-11-22T00:00:00Z"), dependsOn,
});

function service(rows: ReturnType<typeof row>[], dependencies: Record<string, string>) {
  const prisma = {
    outcomeWorkItem: {
      findMany: async ({ where }: { where: { id?: { in: string[] } } }) =>
        where.id ? where.id.in.map((id) => ({ id, status: dependencies[id] })) : rows,
    },
  };
  return new OutcomeService(prisma as never);
}

test("a queued task behind an unfinished one is listed as waiting, and cannot be force-ended", async () => {
  const page = await Effect.runPromise(service(
    [row(FIRST, "running"), row(SECOND, "queued", [FIRST])],
    { [FIRST]: "running" },
  ).listWorkThreads("bot-1", false, null));
  const [first, second] = page.items;
  expect(first!.waitingOnDependency).toBeUndefined();
  expect(second!.waitingOnDependency).toBe(true);
  expect(workThreadCanStop(first!)).toBe(true);
  expect(workThreadCanStop(second!)).toBe(false);
});

test("a queued task whose dependencies finished, or that has none, is an ordinary queued thread", async () => {
  const page = await Effect.runPromise(service(
    [row(SECOND, "queued", [FIRST]), row(THIRD, "queued")],
    { [FIRST]: "completed" },
  ).listWorkThreads("bot-1", false, null));
  expect(page.items.map((item) => item.waitingOnDependency)).toEqual([undefined, undefined]);
  expect(page.items.every(workThreadCanStop)).toBe(true);
});
