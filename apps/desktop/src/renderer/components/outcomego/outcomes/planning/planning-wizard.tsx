import { useRef, useState } from "react";
import {
  OUTCOME_PLANNING_DIMENSIONS,
  hasBlockingConflict,
  resolvePlanningSelections,
  type ContractRevisionView,
  type PlanningDraftView,
  type OutcomeDetail,
  type OutcomeBudget,
} from "@outcomego/contracts/outcomes";
import { OutcomeApprovalScope } from "../outcome-brief";
import { ContractConfirmation } from "./contract-confirmation";
import {
  type OutcomeClient,
  OutcomeRequestIds,
  outcomeErrorMessage,
  planOutcomeChanges,
} from "./outcome-client";
import {
  customPlanningEntries,
  emptySelections,
  planningConflicts,
  selectPlanningOption,
  selectionsFromPlan,
} from "./planning-state";
import { useOutcomeAttention } from "../../../../hooks/use-outcome-attention";
import { OutcomeButton } from "../outcome-ui";
import { useI18n } from "../../../../lib/i18n";

export function PlanningWizard({
  botId,
  client,
  initialPlan,
  initialBudget,
  onSaved,
  onDone,
  revisionTarget,
}: {
  botId: string;
  client: OutcomeClient;
  initialPlan?: PlanningDraftView;
  initialBudget?: OutcomeBudget | null;
  onSaved?: (value: { planId?: string; outcomeId?: string }) => void;
  onDone: (outcome: OutcomeDetail) => void;
  revisionTarget?: { outcomeId: string; revision: ContractRevisionView; changeSummary: string };
}) {
  const { t } = useI18n();
  const [sourceText, setSourceText] = useState(initialPlan?.sourceText ?? "");
  const [title, setTitle] = useState(initialPlan?.sourceText.slice(0, 200) ?? "");
  const [draft, setDraft] = useState(initialPlan ?? null);
  const [selections, setSelections] = useState(
    initialPlan ? selectionsFromPlan(initialPlan) : emptySelections()
  );
  const [step, setStep] = useState(0);
  const [time, setTime] = useState(initialBudget?.timeLimitMinutes?.toString() ?? "");
  const [cost, setCost] = useState(initialBudget?.costLimit?.toString() ?? "");
  const [outcome, setOutcome] = useState<OutcomeDetail | null>(null);
  const attention = useOutcomeAttention({ surface: "planning", outcomeId: outcome?.id });
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changePlan, setChangePlan] = useState<{ plan: PlanningDraftView; request: string } | null>(
    null
  );
  const requestIds = useRef(new OutcomeRequestIds());
  const budget =
    !time && !cost
      ? null
      : { timeLimitMinutes: time ? Number(time) : null, costLimit: cost ? Number(cost) : null };
  const validBudget =
    (!time || (Number.isInteger(Number(time)) && Number(time) > 0)) &&
    (!cost || (Number.isFinite(Number(cost)) && Number(cost) > 0));
  const conflicts = draft ? planningConflicts(draft, selections, budget) : [];
  async function submit(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(outcomeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const dimension = OUTCOME_PLANNING_DIMENSIONS[Math.min(step, 2)]!;
  const dimensionLabel = { goal: "Goal", acceptance: "Acceptance", boundaries: "Boundaries" }[
    dimension
  ];
  if (changePlan && outcome?.currentRevisionView)
    return (
      <PlanningWizard
        botId={botId}
        client={client}
        initialPlan={changePlan.plan}
        initialBudget={outcome.currentRevisionView.budget}
        revisionTarget={{
          outcomeId: outcome.id,
          revision: outcome.currentRevisionView,
          changeSummary: changePlan.request,
        }}
        onDone={(value) => {
          setChangePlan(null);
          setComment("");
          setOutcome(value);
          onDone(value);
        }}
      />
    );
  return (
    <section
      ref={attention.ref}
      aria-label={t("Outcome planning")}
      className="space-y-4"
      aria-busy={busy}
    >
      <h2 className="text-[15px] font-medium tracking-[-0.015em]">
        {t(revisionTarget ? "Choose changes to your plan" : "Plan an Outcome")}
      </h2>
      {error && <p role="alert">{error}</p>}
      {!draft && (
        <>
          <label className="block">
            {t("Task description")}
            <textarea
              className="mt-1 min-h-24 w-full outcome-control"
              value={sourceText}
              maxLength={8000}
              disabled={busy}
              onChange={(e) => setSourceText(e.target.value)}
            />
          </label>
          <OutcomeButton
            variant="default"
            disabled={busy || !sourceText.trim()}
            onClick={() =>
              void submit(async () => {
                const plan = await client.plan({
                  sourceText,
                  context: { botId },
                  clientRequestId: `plan:${crypto.randomUUID()}`,
                });
                setDraft(plan);
                setSelections(selectionsFromPlan(plan));
                setTitle(sourceText.trim().slice(0, 200));
                onSaved?.({ planId: plan.planId });
              })
            }
          >
            {t(busy ? "Generating…" : "Generate planning options")}
          </OutcomeButton>
        </>
      )}
      {draft && !outcome && (
        <>
          <div className="outcome-planning-steps" aria-label={t("Planning progress")}>
            {["Goal", "Acceptance", "Boundaries", "Confirm"].map((label, index) => (
              <span
                key={label}
                aria-current={step === index ? "step" : undefined}
                data-complete={index < step}
              >
                <span>{index + 1}</span>
                {t(label)}
              </span>
            ))}
          </div>
          <p className="sr-only">
            {t("Step {step} of 4", { step: step + 1 })} ·{" "}
            {t(step < 3 ? dimensionLabel : "Contract and optional budget")}
          </p>
          {step < 3 ? (
            <fieldset disabled={busy || draft.status !== "ready"} className="space-y-3">
              <legend className="mb-2 font-medium">{t(dimensionLabel)}</legend>
              {draft[dimension].options.map((option) => (
                <div key={option.id} className="outcome-card">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selections[dimension].selectedOptionIds.includes(option.id)}
                      onChange={() =>
                        setSelections((current) =>
                          selectPlanningOption(current, dimension, option.id)
                        )
                      }
                    />
                    <span>
                      {option.text}
                      {option.kind === "excluded" ? ` (${t("Excluded")})` : ""}
                      {option.required === false ? ` (${t("Optional")})` : ""}
                    </span>
                  </label>
                  {option.reason && (
                    <details className="mt-2 text-xs">
                      <summary>{t("Why recommended")}</summary>
                      {option.reason}
                    </details>
                  )}
                </div>
              ))}
              <label className="block">
                {t("Custom {dimension} entries (one per line, up to four)", {
                  dimension: t(dimensionLabel).toLocaleLowerCase(),
                })}
                <textarea
                  aria-label={t("Custom {dimension}", {
                    dimension: t(dimensionLabel).toLocaleLowerCase(),
                  })}
                  className="mt-1 min-h-20 w-full outcome-control"
                  maxLength={8000}
                  value={selections[dimension].customEntries.join("\n")}
                  onChange={(e) =>
                    setSelections((current) =>
                      customPlanningEntries(current, dimension, e.target.value)
                    )
                  }
                />
              </label>
            </fieldset>
          ) : (
            <>
              {!revisionTarget && (
                <label className="block">
                  {t("Outcome title")}
                  <input
                    className="mt-1 w-full outcome-control"
                    value={title}
                    maxLength={200}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={busy}
                  />
                </label>
              )}
              <label className="block">
                {t("Time limit in minutes (optional)")}
                <input
                  aria-label={t("Time limit in minutes")}
                  className="outcome-control ml-2"
                  type="number"
                  min="1"
                  step="1"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="block">
                {t("Cost limit (optional)")}
                <input
                  aria-label={t("Cost limit")}
                  className="outcome-control ml-2"
                  type="number"
                  min="0.01"
                  step="any"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  disabled={busy}
                />
              </label>
              <p className="text-xs">
                {t("Leave budget blank to skip. Budget does not automatically stop execution.")}
              </p>
              {conflicts.map((conflict, i) => (
                <p key={i} role={conflict.severity === "blocking" ? "alert" : "status"}>
                  {conflict.message}
                </p>
              ))}
              <button
                className="outcome-control"
                disabled={
                  busy ||
                  (!revisionTarget && !title.trim()) ||
                  !validBudget ||
                  hasBlockingConflict(conflicts) ||
                  draft.status !== "ready"
                }
                onClick={() =>
                  void submit(async () => {
                    if (revisionTarget) {
                      const input = {
                        baseRevision: revisionTarget.revision.revision,
                        contract: resolvePlanningSelections(draft, selections, budget),
                        changeSummary: revisionTarget.changeSummary,
                      };
                      const changed = await client.revise(revisionTarget.outcomeId, {
                        ...input,
                        clientRequestId: requestIds.current.for(
                          `revise:${revisionTarget.outcomeId}`,
                          input
                        ),
                      });
                      onDone(changed);
                      return;
                    }
                    const input = { planId: draft.planId, title, ...selections, budget };
                    const result = await client.create({
                      ...input,
                      clientRequestId: requestIds.current.for("create", input),
                    });
                    attention.attachOutcome(result.id);
                    setOutcome(result);
                    onSaved?.({ outcomeId: result.id });
                  })
                }
              >
                {t(revisionTarget ? "Save proposed changes" : "Create contract for confirmation")}
              </button>
            </>
          )}
          {draft.status !== "ready" && (
            <p role="alert">
              {t("This plan is {status}. Generate a new plan.", { status: draft.status })}
            </p>
          )}
          <div className="flex items-center gap-2 border-t border-border/60 pt-4">
            <OutcomeButton disabled={busy || step === 0} onClick={() => setStep((s) => s - 1)}>
              {t("Back")}
            </OutcomeButton>
            <OutcomeButton
              variant="default"
              disabled={busy || step === 3}
              onClick={() => setStep((s) => s + 1)}
            >
              {t("Next")}
            </OutcomeButton>
            <OutcomeButton
              variant="ghost"
              className="ml-auto text-foreground-secondary"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setStep(0);
              }}
            >
              {t("Start over")}
            </OutcomeButton>
          </div>
        </>
      )}
      {outcome?.currentRevisionView && (
        <>
          <OutcomeApprovalScope revision={outcome.currentRevisionView} />
          <ContractConfirmation
            key={outcome.currentRevisionView.id}
            revision={outcome.currentRevisionView}
            busy={busy}
            comment={comment}
            onComment={setComment}
            onRequestChanges={(text) =>
              void submit(async () => {
                const plan = await planOutcomeChanges(client, outcome.currentRevisionView!, text);
                setChangePlan({ plan, request: text });
              })
            }
            onApprove={() =>
              void submit(async () => {
                const input = {
                  expectedRevision: outcome.currentRevision!,
                  confirmationText: [
                    t("I approve the saved goals, acceptance criteria and scope."),
                    comment.trim(),
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                };
                const approved = await client.approve(outcome.id, outcome.currentRevision!, {
                  ...input,
                  clientRequestId: requestIds.current.for("approve", input),
                });
                setOutcome(approved);
                onDone(approved);
              })
            }
          />
          <button className="outcome-control" disabled={busy} onClick={() => onDone(outcome)}>
            {t("Open Outcome details")}
          </button>
        </>
      )}
    </section>
  );
}
