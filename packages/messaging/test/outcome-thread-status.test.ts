import { expect, test } from "bun:test";
import { recomputeOutcomeStatus } from "../src/outcome-state";

type Row = Record<string, any>;

/** The status the server derives for a goal, given its contract and whether its thread is working. */
function derive(options: { revision?: "pending_approval" | "approved" | "draft" | null; activeTurns: number; stored?: string }) {
  const updates: Row[] = [];
  const events: Row[] = [];
  const revisionStatus = options.revision === undefined ? "pending_approval" : options.revision;
  const tx: Row = {
    $executeRaw: async () => 0,
    outcome: {
      findUniqueOrThrow: async () => ({
        id: "o1", status: options.stored ?? "pending_approval", resumeStatus: null, trackingMode: "standard", cancelledAt: null, acceptedAt: null,
        currentRevision: revisionStatus ? { id: "r1", status: revisionStatus, revision: 1 } : null, workItems: [],
      }),
      update: async ({ data }: Row) => void updates.push(data),
    },
    outcomeThreadTurn: {
      count: async ({ where }: Row) => (where.status.in.includes("running") && where.thread.outcomeId === "o1" ? options.activeTurns : 0),
    },
    outcomeDecision: { count: async () => 0 },
    event: { create: async ({ data }: Row) => void events.push(data) },
  };
  return recomputeOutcomeStatus(tx as never, "o1", "system:outcome-thread").then((status) => ({ status, updates, events }));
}

test("while the goal's thread is working, a new goal and a pending plan are both planning", async () => {
  for (const revision of [null, "draft", "pending_approval"] as const) {
    const result = await derive({ revision, activeTurns: 1 });
    expect(result.status).toBe("planning");
  }
});

test("planning is announced so lists and badges move at once", async () => {
  const result = await derive({ revision: "pending_approval", activeTurns: 1 });
  expect(result.updates).toEqual([{ status: "planning", resumeStatus: null }]);
  expect(result.events.some((event) => event.topic === "goal.status.changed" && event.payload.to === "planning")).toBe(true);
});

test("when the turn ends the facts decide again: a pending plan awaits approval, no contract is a draft", async () => {
  expect((await derive({ revision: "pending_approval", activeTurns: 0, stored: "planning" })).status).toBe("pending_approval");
  expect((await derive({ revision: null, activeTurns: 0, stored: "planning" })).status).toBe("draft");
});

test("a working thread never moves a goal that is already approved", async () => {
  expect((await derive({ revision: "approved", activeTurns: 1, stored: "approved" })).status).toBe("approved");
});
