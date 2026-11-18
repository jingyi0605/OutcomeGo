import { describe, expect, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OutcomeClient } from "../src/renderer/client/outcome-api";
import { createOutcomeApi } from "../src/renderer/client/outcome-api";
import { PlanningWizard } from "../src/renderer/components/outcomego/outcomes/planning/planning-wizard";
import { ContractConfirmation } from "../src/renderer/components/outcomego/outcomes/planning/contract-confirmation";
import { OutcomeRequestIds } from "../src/renderer/components/outcomego/outcomes/planning/outcome-client";
import { emptySelections, selectPlanningOption, customPlanningEntries, planningConflicts, selectionsFromPlan } from "../src/renderer/components/outcomego/outcomes/planning/planning-state";
import { planFixture, outcomeFixture } from "./outcome-fixture";
import { I18nProvider } from "../src/renderer/lib/i18n";

const render = (element: ReactNode) =>
  renderToStaticMarkup(createElement(I18nProvider, { children: element }));

describe("Outcome planning components and state", () => {
  test("wizard renders source input and multi-select options with recommendation reasons", () => {
    const client = {} as OutcomeClient;
    const source = render(createElement(PlanningWizard, { botId: planFixture.botId, client, onDone() {} }));
    expect(source).toContain("Task description"); expect(source).toContain("Generate planning options");
    expect(source).toContain("disabled");
    const options = render(createElement(PlanningWizard, { botId: planFixture.botId, client, initialPlan: planFixture, onDone() {} }));
    expect(options).toContain('type="checkbox"'); expect(options).toContain("Recommend a plan");
    expect(options).toContain("The request asks for a decision"); expect(options).toContain("Custom goal");
  });
  test("multiselect and custom entries preserve separate dimensions, newline input and conflicts", () => {
    let selections = selectPlanningOption(emptySelections(), "goal", "goal-1");
    selections = selectPlanningOption(selections, "goal", "goal-2");
    selections = customPlanningEntries(selections, "acceptance", "Compare restore times\n");
    expect(selections.goal.selectedOptionIds).toEqual(["goal-1", "goal-2"]);
    expect(selections.acceptance.customEntries).toEqual(["Compare restore times", ""]);
    expect(selections.boundaries.selectedOptionIds).toEqual([]);
    expect(planningConflicts(planFixture, selections, null).some(c => c.severity === "blocking")).toBe(false);
    expect(planningConflicts(planFixture, emptySelections(), null).map(c => c.code)).toContain("missing_acceptance");
    const fresh = selectionsFromPlan(planFixture); expect(fresh).toEqual(emptySelections());
    expect(fresh.goal.selectedOptionIds).not.toBe(planFixture.goal.selectedOptionIds);
  });
  test("approval controls disable in flight and retain the confirmation text", () => {
    const html = render(createElement(ContractConfirmation, { revision: { ...outcomeFixture.currentRevisionView!, status: "pending_approval", approvedAt: null }, busy: true, confirmation: "Keep my confirmation after a failed request", onConfirmation() {}, onApprove() {} }));
    expect(html).toContain("Keep my confirmation after a failed request"); expect(html).toContain("Submitting");
    expect(html).toContain("disabled"); expect(html).toContain("No time limit specified");
  });
  test("ambiguous retries retain IDs, edited selections create a new intent", () => {
    const ids = new OutcomeRequestIds();
    const id = ids.for("approve", { revision: 1, confirmation: "I confirm" });
    expect(ids.for("approve", { revision: 1, confirmation: "I confirm" })).toBe(id);
    expect(ids.for("approve", { revision: 2, confirmation: "I confirm" })).not.toBe(id);
    const create = ids.for("create", { goal: ["goal-1"] });
    expect(ids.for("create", { goal: ["goal-1"] })).toBe(create);
    ids.complete("create"); expect(ids.for("create", { goal: ["goal-1"] })).not.toBe(create);
  });
  test("API adapter uses frozen endpoints and forwards client IDs without an actor", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client = createOutcomeApi(async <T>(path: string, init?: RequestInit) => { calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null }); return {} as T; });
    await client.approve("o/1", 2, { expectedRevision: 2, confirmationText: "I confirm", clientRequestId: "approve:retry-key" });
    await client.list("limit=20"); await client.get("o1"); await client.transcript("o1", "work/1");
    expect(calls[0]).toEqual({ path: "/api/outcomes/o%2F1/revisions/2/approve", body: { expectedRevision: 2, confirmationText: "I confirm", clientRequestId: "approve:retry-key" } });
    expect(calls[1]?.path).toBe("/api/outcomes?limit=20"); expect(calls[3]?.path).toBe("/api/outcomes/o1/work-items/work%2F1/transcript");
  });
});
