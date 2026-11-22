import type { GroupTaskView } from "@outcomego/contracts";

/** Subtasks follow their parent; a subtask whose parent is not listed is shown at the top level. */
export function arrangeGroupTasks(
  tasks: readonly GroupTaskView[]
): Array<{ task: GroupTaskView; depth: 0 | 1 }> {
  const sorted = [...tasks].sort((a, b) => a.number - b.number);
  const present = new Set(sorted.map((task) => task.number));
  const children = new Map<number, GroupTaskView[]>();
  const top: GroupTaskView[] = [];
  for (const task of sorted) {
    if (task.parentNumber !== null && present.has(task.parentNumber))
      children.set(task.parentNumber, [...(children.get(task.parentNumber) ?? []), task]);
    else top.push(task);
  }
  return top.flatMap((task) => [
    { task, depth: 0 as const },
    ...(children.get(task.number) ?? []).map((child) => ({ task: child, depth: 1 as const })),
  ]);
}
