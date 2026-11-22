import { describe, expect, test } from "bun:test";
import type { GroupTaskView } from "@outcomego/contracts";
import { arrangeGroupTasks } from "../src/renderer/lib/group-tasks";
import { sourceTranslations, translate } from "../src/renderer/lib/i18n-catalog";

const task = (number: number, parentNumber: number | null = null): GroupTaskView => ({
  id: `task-${number}`,
  channelId: "channel",
  number,
  parentNumber,
  title: `Task ${number}`,
  description: "",
  status: "open",
  note: null,
  revision: 1,
  creator: null,
  assignee: null,
  createdAt: "2026-11-20T00:00:00.000Z",
  updatedAt: "2026-11-20T00:00:00.000Z",
  completedAt: null,
});

describe("group task board layout", () => {
  test("lists subtasks directly under their parent, ordered by number", () => {
    const rows = arrangeGroupTasks([task(4, 1), task(2), task(1), task(3, 1), task(5, 2)]);
    expect(rows.map(({ task: row, depth }) => [row.number, depth])).toEqual([
      [1, 0],
      [3, 1],
      [4, 1],
      [2, 0],
      [5, 1],
    ]);
  });

  test("a subtask whose parent is not listed stays visible at the top level", () => {
    expect(arrangeGroupTasks([task(7, 6)]).map(({ task: row, depth }) => [row.number, depth])).toEqual([[7, 0]]);
  });

  test("an empty board has no rows", () => {
    expect(arrangeGroupTasks([])).toEqual([]);
  });
});

describe("group task board copy", () => {
  test("every interface string of the panel has a Simplified Chinese translation", () => {
    const keys = [
      "Couldn’t load tasks",
      "Couldn’t update the task. It may have changed.",
      "{count} unfinished",
      "Show finished",
      "Hide finished",
      "No tasks yet. Members register work here before they start it.",
      "Loading tasks",
      "Open",
      "In progress",
      "Blocked",
      "Done",
      "Cancelled",
      "Unowned",
      "Waiting: {note}",
      "Actions for task #{number}",
      "Release",
      "Cancel task",
      "Cancel task #{number}?",
      "Its unfinished subtasks are cancelled with it, and members will stop working on it.",
      "Keep task",
    ];
    for (const key of keys) expect(sourceTranslations[key]).toBeDefined();
    expect(translate("zh-CN", "{count} unfinished", { count: 3 })).toBe("3 项未完成");
  });
});
