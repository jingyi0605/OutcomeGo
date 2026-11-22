import type { OutcomeDetail, OutcomeWorkItemProgress } from "@outcomego/contracts/outcomes";

type WorkItem = OutcomeDetail["workItems"][number];
type ProgressStep = OutcomeWorkItemProgress["tasks"][number];

export interface OutcomeStepEntry {
  step: ProgressStep;
  item: WorkItem;
}

/**
 * The single source of task counts for the chat card and the goal detail.
 * Steps from every work item of the current revision are counted together, so a finished
 * work item is never dropped while another one is running.
 */
export function outcomeProgressSteps(outcome: OutcomeDetail) {
  const items = outcome.workItems.filter((item) => item.contractRevision === outcome.currentRevision);
  const steps: OutcomeStepEntry[] = items.flatMap((item) =>
    (item.progress?.tasks ?? []).map((step) => ({ step, item }))
  );
  const withProgress = items.filter((item) => item.progress);
  const active =
    withProgress.find((item) => item.status === "running") ??
    [...withProgress].sort((a, b) => (b.progress!.updatedAt > a.progress!.updatedAt ? 1 : -1))[0];
  return {
    items,
    steps,
    active,
    done: steps.filter((entry) => entry.step.status === "completed").length,
    running: steps.filter((entry) => entry.step.status === "in_progress").length,
  };
}
