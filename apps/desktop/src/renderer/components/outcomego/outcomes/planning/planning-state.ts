import {
  OUTCOME_LIMITS, detectPlanningConflicts, resolvePlanningSelections,
  type CreateOutcomeInput, type OutcomePlanningDimension, type OutcomeBudget, type PlanningDraftView,
} from "@outcomego/contracts/outcomes";

export type PlanningSelections = Pick<CreateOutcomeInput, "goal" | "acceptance" | "boundaries">;
export const emptySelections = (): PlanningSelections => ({
  goal: { selectedOptionIds: [], customEntries: [] }, acceptance: { selectedOptionIds: [], customEntries: [] }, boundaries: { selectedOptionIds: [], customEntries: [] },
});
export function selectPlanningOption(selections: PlanningSelections, dimension: OutcomePlanningDimension, id: string): PlanningSelections {
  const current = selections[dimension];
  const selectedOptionIds = current.selectedOptionIds.includes(id)
    ? current.selectedOptionIds.filter(selected => selected !== id)
    : [...current.selectedOptionIds, id].slice(0, OUTCOME_LIMITS.selectedPerDimension);
  return { ...selections, [dimension]: { ...current, selectedOptionIds } };
}
export function customPlanningEntries(selections: PlanningSelections, dimension: OutcomePlanningDimension, text: string): PlanningSelections {
  return { ...selections, [dimension]: { ...selections[dimension], customEntries: text.split("\n").slice(0, OUTCOME_LIMITS.customEntriesPerDimension).map(entry => entry.slice(0, OUTCOME_LIMITS.customEntryChars)) } };
}
export function planningConflicts(draft: PlanningDraftView, selections: PlanningSelections, budget: OutcomeBudget | null) {
  return [...draft.conflicts, ...detectPlanningConflicts(resolvePlanningSelections(draft, selections, budget))];
}
export function selectionsFromPlan(draft: PlanningDraftView): PlanningSelections {
  const copy = (dimension: OutcomePlanningDimension) => ({ selectedOptionIds: [...draft[dimension].selectedOptionIds], customEntries: [...draft[dimension].customEntries] });
  return { goal: copy("goal"), acceptance: copy("acceptance"), boundaries: copy("boundaries") };
}
