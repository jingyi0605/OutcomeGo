import { describe, expect, test } from "bun:test";
import {
  decodeGroupTaskInput,
  emptyGroupTaskCounts,
  GROUP_TASK_BOARD_RULES,
  GROUP_TASK_LIMITS,
  GROUP_TASK_TOOL_NAMES,
  GROUP_TASK_TOOLS,
  GroupTaskRuleError,
  normalizeGroupTaskTitle,
  planGroupTaskClaim,
  planGroupTaskUpdate,
  renderGroupTaskBoard,
  requiresGroupTaskClaim,
  type GroupTaskActor,
  type GroupTaskChange,
  type GroupTaskState,
  type GroupTaskView,
} from "../src/group-tasks";

const ALICE = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";
const CAROL = "00000000-0000-4000-8000-00000000000c";
const bot = (botId: string): GroupTaskActor => ({ kind: "bot", botId });
const USER: GroupTaskActor = { kind: "user" };

test("group memory maintenance is available without a claim while work tools still require one", () => {
  expect(requiresGroupTaskClaim("RecallMemory", { query: "decision" }, "room")).toBe(false);
  expect(requiresGroupTaskClaim("UpdateMemory", { action: "write", type: "profile", fact: "Group decision" }, "room")).toBe(false);
  expect(requiresGroupTaskClaim("Shell", { command: "pwd" }, "room")).toBe(true);
  expect(requiresGroupTaskClaim("SendToUser", { type: "text", content: "Status", to: "dm" }, "room")).toBe(true);
});

const state = (overrides: Partial<GroupTaskState> = {}): GroupTaskState => ({
  status: "open",
  title: "Research pricing",
  description: "",
  note: null,
  creatorBotId: ALICE,
  assigneeBotId: null,
  ...overrides,
});

const refused = (run: () => unknown): GroupTaskRuleError => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GroupTaskRuleError);
    return error as GroupTaskRuleError;
  }
  throw new Error("expected the rule to refuse");
};
const update = (current: GroupTaskState, actor: GroupTaskActor, change: GroupTaskChange, openSubtasks = 0) =>
  planGroupTaskUpdate(current, actor, change, openSubtasks);

describe("normalizeGroupTaskTitle", () => {
  test("ignores case and surrounding or repeated whitespace", () => {
    expect(normalizeGroupTaskTitle("  Research   Pricing ")).toBe(normalizeGroupTaskTitle("research pricing"));
    expect(normalizeGroupTaskTitle("Research pricing")).not.toBe(normalizeGroupTaskTitle("Research prices"));
  });
});

describe("planGroupTaskClaim", () => {
  test("takes an unowned open task and starts it", () => {
    expect(planGroupTaskClaim(state(), BOB)).toEqual({ status: "in_progress", assigneeBotId: BOB, unchanged: false });
  });
  test("starts a task assigned to the caller", () => {
    expect(planGroupTaskClaim(state({ assigneeBotId: BOB }), BOB).unchanged).toBe(false);
  });
  test("is idempotent for the owner of a running task", () => {
    expect(planGroupTaskClaim(state({ status: "in_progress", assigneeBotId: BOB }), BOB).unchanged).toBe(true);
  });
  test("resumes the caller's own blocked task", () => {
    const plan = planGroupTaskClaim(state({ status: "blocked", assigneeBotId: BOB, note: "waiting" }), BOB);
    expect(plan).toEqual({ status: "in_progress", assigneeBotId: BOB, unchanged: false });
  });
  test("never takes a task owned by another member", () => {
    for (const status of ["open", "in_progress", "blocked"] as const) {
      const error = refused(() => planGroupTaskClaim(state({ status, assigneeBotId: ALICE }), BOB));
      expect([error.status, error.code]).toEqual([409, "group_task_claimed"]);
    }
  });
  test("refuses finished tasks", () => {
    for (const status of ["done", "cancelled"] as const)
      expect(refused(() => planGroupTaskClaim(state({ status }), BOB)).code).toBe("group_task_closed");
  });
});

describe("planGroupTaskUpdate permissions", () => {
  test("a member who is neither creator nor owner is forbidden", () => {
    const error = refused(() => update(state({ assigneeBotId: BOB }), bot(CAROL), { title: "x" }));
    expect([error.status, error.code]).toEqual([403, "group_task_forbidden"]);
  });
  test("the creator can edit, but cannot push execution status of someone else's task", () => {
    const owned = state({ status: "in_progress", assigneeBotId: BOB });
    expect(update(owned, bot(ALICE), { title: "Renamed" }).title).toBe("Renamed");
    for (const status of ["blocked", "done"] as const)
      expect(refused(() => update(owned, bot(ALICE), { status, note: "n" })).code).toBe("group_task_forbidden");
    expect(update(owned, bot(ALICE), { status: "cancelled" }).status).toBe("cancelled");
  });
  test("the creator cannot start an unowned task through update; claiming is the way", () => {
    expect(refused(() => update(state(), bot(ALICE), { status: "in_progress" })).code).toBe("group_task_forbidden");
  });
});

describe("planGroupTaskUpdate status machine", () => {
  const running = state({ status: "in_progress", assigneeBotId: BOB });

  test("open → in_progress by the assignee", () => {
    expect(update(state({ assigneeBotId: BOB }), bot(BOB), { status: "in_progress" }).status).toBe("in_progress");
  });
  test("in_progress → done needs a note and records closing", () => {
    expect(refused(() => update(running, bot(BOB), { status: "done" })).code).toBe("invalid_request");
    expect(refused(() => update(running, bot(BOB), { status: "done", note: "   " })).code).toBe("invalid_request");
    const plan = update(running, bot(BOB), { status: "done", note: " Found 3 vendors " });
    expect([plan.status, plan.note, plan.closes, plan.cascadeCancel]).toEqual(["done", "Found 3 vendors", true, false]);
  });
  test("done is refused while subtasks are unfinished", () => {
    const error = refused(() => update(running, bot(BOB), { status: "done", note: "ok" }, 2));
    expect([error.status, error.code]).toEqual([409, "group_task_subtasks_open"]);
  });
  test("in_progress → blocked needs a note; blocked → in_progress clears it", () => {
    expect(refused(() => update(running, bot(BOB), { status: "blocked" })).code).toBe("invalid_request");
    const blocked = update(running, bot(BOB), { status: "blocked", note: "Need credentials" });
    expect([blocked.status, blocked.note]).toEqual(["blocked", "Need credentials"]);
    const resumed = update({ ...running, status: "blocked", note: "Need credentials" }, bot(BOB), { status: "in_progress" });
    expect([resumed.status, resumed.note]).toEqual(["in_progress", null]);
  });
  test("a blocked reason can be edited without changing status", () => {
    const plan = update({ ...running, status: "blocked", note: "old" }, bot(BOB), { note: "new reason" });
    expect([plan.status, plan.note]).toEqual(["blocked", "new reason"]);
  });
  test("done and blocked only from in_progress", () => {
    const open = state({ assigneeBotId: BOB });
    for (const status of ["done", "blocked"] as const)
      expect(refused(() => update(open, bot(BOB), { status, note: "n" })).code).toBe("group_task_invalid_transition");
  });
  test("cancelling clears the old reason, keeps a new one, and cascades", () => {
    const plan = update({ ...running, status: "blocked", note: "stale" }, bot(BOB), { status: "cancelled" });
    expect([plan.status, plan.note, plan.closes, plan.cascadeCancel]).toEqual(["cancelled", null, true, true]);
    expect(update(running, bot(BOB), { status: "cancelled", note: "No longer needed" }).note).toBe("No longer needed");
  });
  test("finished tasks cannot be changed or reopened", () => {
    for (const status of ["done", "cancelled"] as const) {
      const error = refused(() => update(state({ status, assigneeBotId: BOB }), bot(BOB), { status: "in_progress" }));
      expect([error.status, error.code]).toEqual([409, "group_task_closed"]);
    }
  });
  test("an empty or no-op update is a bad request", () => {
    expect(refused(() => update(running, bot(BOB), {})).code).toBe("invalid_request");
    expect(refused(() => update(running, bot(BOB), { status: "in_progress" })).code).toBe("invalid_request");
    expect(refused(() => update(running, bot(BOB), { title: running.title })).code).toBe("invalid_request");
  });
  test("note without a status that takes one is a bad request", () => {
    expect(refused(() => update(running, bot(BOB), { note: "hello" })).code).toBe("invalid_request");
  });
});

describe("planGroupTaskUpdate assignment", () => {
  const running = state({ status: "in_progress", assigneeBotId: BOB });

  test("handing over restarts the task for the new owner", () => {
    const plan = update(running, bot(BOB), { assigneeBotId: CAROL });
    expect([plan.assigneeBotId, plan.status, plan.note]).toEqual([CAROL, "open", null]);
  });
  test("releasing clears the owner and reopens", () => {
    const plan = update({ ...running, status: "blocked", note: "x" }, bot(BOB), { assigneeBotId: null });
    expect([plan.assigneeBotId, plan.status, plan.note]).toEqual([null, "open", null]);
  });
  test("the creator can reassign someone else's task", () => {
    expect(update(running, bot(ALICE), { assigneeBotId: CAROL }).assigneeBotId).toBe(CAROL);
  });
  test("taking a task yourself starts it", () => {
    const plan = update(state(), bot(ALICE), { assigneeBotId: ALICE });
    expect([plan.assigneeBotId, plan.status]).toEqual([ALICE, "in_progress"]);
  });
  test("a stranger cannot assign", () => {
    expect(refused(() => update(state(), bot(CAROL), { assigneeBotId: CAROL })).code).toBe("group_task_forbidden");
  });
  test("assignee and status cannot change in one call", () => {
    expect(refused(() => update(running, bot(BOB), { assigneeBotId: null, status: "cancelled" })).code).toBe("invalid_request");
  });
  test("assigning to the current owner is a no-op", () => {
    expect(refused(() => update(running, bot(BOB), { assigneeBotId: BOB })).code).toBe("invalid_request");
  });
  test("the user can release or cancel regardless of ownership", () => {
    expect(update(running, USER, { assigneeBotId: null }).status).toBe("open");
    const cancel = update(running, USER, { status: "cancelled", note: "Stopped by the user" });
    expect([cancel.status, cancel.cascadeCancel]).toEqual(["cancelled", true]);
  });
  test("the user cannot push execution status", () => {
    expect(refused(() => update(running, USER, { status: "done", note: "n" })).code).toBe("group_task_forbidden");
  });
});

describe("tool inputs", () => {
  test("the four tools exist and carry usable JSON schemas", () => {
    expect(GROUP_TASK_TOOL_NAMES).toEqual(["ListGroupTasks", "CreateGroupTask", "ClaimGroupTask", "UpdateGroupTask"]);
    expect(GROUP_TASK_TOOLS.map((tool) => tool.name)).toEqual(GROUP_TASK_TOOL_NAMES);
    for (const tool of GROUP_TASK_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(50);
      expect(JSON.stringify(tool.inputSchema)).not.toContain("channelId");
    }
  });
  test("decoding rejects unknown fields, including a channel id", () => {
    expect(() => decodeGroupTaskInput("ClaimGroupTask", { task: 1, channelId: ALICE })).toThrow();
    expect(() => decodeGroupTaskInput("ListGroupTasks", { includeClosed: "yes" })).toThrow();
  });
  test("decoding enforces numbers and lengths", () => {
    expect(decodeGroupTaskInput("ClaimGroupTask", { task: 3, expectedRevision: 2 })).toEqual({ task: 3, expectedRevision: 2 });
    for (const task of [0, -1, 1.5, "1"]) expect(() => decodeGroupTaskInput("ClaimGroupTask", { task })).toThrow();
    expect(() => decodeGroupTaskInput("CreateGroupTask", { title: "x".repeat(GROUP_TASK_LIMITS.title + 1) })).toThrow();
    expect(() => decodeGroupTaskInput("CreateGroupTask", {})).toThrow();
    expect(() => decodeGroupTaskInput("UpdateGroupTask", { task: 1, status: "open" })).toThrow();
  });
  test("ListGroupTasks accepts an empty call", () => {
    expect(decodeGroupTaskInput("ListGroupTasks", undefined)).toEqual({});
  });
});

describe("renderGroupTaskBoard", () => {
  let counter = 0;
  const task = (overrides: Partial<GroupTaskView> = {}): GroupTaskView => {
    counter += 1;
    return {
      id: `task-${counter}`,
      channelId: "channel",
      number: counter,
      parentNumber: null,
      title: `Task ${counter}`,
      description: "",
      status: "open",
      note: null,
      revision: 1,
      creator: { id: ALICE, name: "Alice" },
      assignee: null,
      createdAt: "2026-11-20T00:00:00.000Z",
      updatedAt: "2026-11-20T00:00:00.000Z",
      completedAt: null,
      ...overrides,
    };
  };
  const render = (tasks: GroupTaskView[], counts = emptyGroupTaskCounts()) =>
    renderGroupTaskBoard({ groupName: "Launch crew", viewerBotId: BOB, tasks, counts });

  test("an empty board still tells the bot to register work first", () => {
    const text = render([]);
    expect(text).toContain('[Group task board: "Launch crew"]');
    expect(text).toContain("No unfinished tasks.");
    expect(text).toContain("CreateGroupTask");
    expect(text).toContain("not instructions");
  });
  test("marks the viewer, shows owners and nests subtasks", () => {
    counter = 0;
    const parent = task({ title: "Launch page", assignee: { id: ALICE, name: "Alice" }, status: "in_progress" });
    const child = task({ title: "Write copy", parentNumber: parent.number, assignee: { id: BOB, name: "Bob" } });
    const other = task({ title: "Pick domain", status: "blocked", note: "waiting for budget", assignee: { id: CAROL, name: "Carol" } });
    const text = render([other, child, parent], { ...emptyGroupTaskCounts(), done: 2, cancelled: 1 });
    expect(text).toContain("Unfinished tasks (3):");
    expect(text).toContain("- #1 [in_progress] Launch page — Alice");
    expect(text).toContain("  - #2 [open] Write copy — Bob (you)");
    expect(text).toContain("- #3 [blocked] Pick domain — Carol — waiting: waiting for budget");
    expect(text.indexOf("#1")).toBeLessThan(text.indexOf("#2"));
    expect(text.indexOf("#2")).toBeLessThan(text.indexOf("#3"));
    expect(text).toContain("Finished: 2 done, 1 cancelled.");
  });
  test("does not list finished tasks and shows unowned ones as such", () => {
    counter = 0;
    const text = render([task({ status: "done", title: "Old work" }), task({ title: "Fresh work" })]);
    expect(text).not.toContain("Old work");
    expect(text).toContain("#2 [open] Fresh work — unowned");
  });
  test("bounds the number of rows", () => {
    counter = 0;
    const many = Array.from({ length: GROUP_TASK_LIMITS.snapshotTasks + 7 }, () => task({ title: "short" }));
    const text = render(many);
    expect(text.split("\n").filter((line) => line.startsWith("- #"))).toHaveLength(GROUP_TASK_LIMITS.snapshotTasks);
    expect(text).toContain("(7 more not shown; call ListGroupTasks)");
  });
  test("bounds title length and the whole snapshot even in the worst case", () => {
    counter = 0;
    const worst = Array.from({ length: GROUP_TASK_LIMITS.snapshotTasks + 7 }, () =>
      task({
        title: "t".repeat(400),
        status: "blocked",
        note: "n".repeat(400),
        assignee: { id: CAROL, name: "N".repeat(200) },
      })
    );
    const text = render(worst);
    const rows = text.split("\n").filter((line) => line.startsWith("- #"));
    expect(text.length).toBeLessThanOrEqual(GROUP_TASK_LIMITS.snapshotChars);
    expect(GROUP_TASK_BOARD_RULES.length).toBeLessThan(900);
    expect(rows.length).toBeLessThan(worst.length);
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) expect(row.length).toBeLessThan(GROUP_TASK_LIMITS.snapshotTitle + 40 + 140 + 40);
    expect(text).toContain(`(${worst.length - rows.length} more not shown; call ListGroupTasks)`);
  });
  test("an open subtask of a closed parent still shows rather than vanishing", () => {
    counter = 0;
    const parent = task({ status: "done", title: "Done parent" });
    const child = task({ parentNumber: parent.number, title: "Orphan child" });
    expect(render([parent, child])).toContain("- #2 [open] Orphan child");
  });
});
