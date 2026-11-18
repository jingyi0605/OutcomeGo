import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import type {
  OutcomeDetail as OutcomeDetailView,
  ContractRevisionView,
  PlanningDraftView,
} from "@outcomego/contracts/outcomes";
import { ContractConfirmation } from "../planning/contract-confirmation";
import {
  type OutcomeClient,
  OutcomeRequestIds,
  outcomeErrorMessage,
  planOutcomeChanges,
} from "../planning/outcome-client";
import { MoreHorizontal } from "lucide-react";
import { PlanningWizard } from "../planning/planning-wizard";
import { OutcomeSourceInfo } from "../outcome-source-info";
import { ContractEditor } from "./contract-editor";
import { ReviewPanel } from "./review-panel";
import { RevisionHistory, revisionMaterialLabel } from "./revision-history";
import { RecoveryDiagnostics } from "../inbox/recovery-diagnostics";
import { responseStatus } from "../inbox/decision-state";
import { useI18n } from "../../../../lib/i18n";
import { OutcomeAsset } from "../outcome-asset";
import { OutcomeButton, OutcomeRefresh } from "../outcome-ui";
import { outcomeCardStage } from "@outcomego/contracts/outcome-chat";
import { outcomeStatusLabels } from "../outcome-list";
import { outcomeNextSteps } from "../outcome-presentation";
import { OutcomeActionItems, OutcomeApprovalScope, OutcomeBriefView } from "../outcome-brief";
import { DecisionCard } from "../inbox/decision-card";
import type { InboxClient } from "../inbox/inbox-api";
import type { OutcomeInboxItemView } from "@outcomego/contracts/outcome-inbox";
import { OutcomeExecutionCard, type OutcomeExecutionBot } from "../outcome-execution-card";

export const evidenceCredibilityLabels = {
  deterministic_check: "Deterministic check",
  human_confirmed: "Human confirmed",
  external_record: "External record",
  agent_report: "Agent report · advisory",
  ai_prereview: "AI prereview · advisory",
} as const;
export function OutcomeDetail({
  outcomeId,
  client,
  initialOutcome,
  reviewRevision,
  actionItems = [],
  actionsError = false,
  actionsLoading = false,
  onAction,
  inboxClient,
  bots = [],
}: {
  bots?: OutcomeExecutionBot[];
  outcomeId: string;
  client: OutcomeClient;
  inboxClient?: InboxClient;
  initialOutcome?: OutcomeDetailView;
  reviewRevision?: number;
  actionItems?: OutcomeInboxItemView[];
  actionsError?: boolean;
  actionsLoading?: boolean;
  onAction?: (item: OutcomeInboxItemView) => void;
}) {
  const { t: translateCurrent } = useI18n();
  const [outcome, setOutcome] = useState(initialOutcome ?? null);
  const [changePlan, setChangePlan] = useState<{
    plan: PlanningDraftView;
    request: string;
    revision: ContractRevisionView;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [transcript, setTranscript] = useState<unknown>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestIds = useRef(new OutcomeRequestIds());
  const generation = useRef(0);
  const [reviewView, setReviewView] = useState<ContractRevisionView | null>(null);
  const [reviewError, setReviewError] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewReload, setReviewReload] = useState(0);
  // A visited entry stays mounted when closed, preserving unsaved form state.
  const [sections, setSections] = useState<Map<string, boolean>>(() => new Map());
  useEffect(() => {
    // New revisions cannot inherit comments or generated choices from the previous plan.
    setSections(new Map());
    setChangePlan(null);
    setComment("");
    setTranscript(null);
  }, [outcomeId, outcome?.currentRevisionView?.id]);
  const disclosure = (name: string) => ({
    open: sections.get(name) === true,
    onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => {
      const open = event.currentTarget.open;
      setSections((previous) => {
        if (previous.get(name) === open || (!open && !previous.has(name))) return previous;
        return new Map(previous).set(name, open);
      });
    },
  });
  function reveal(name: string) {
    setSections((previous) => {
      return new Map(previous).set(name, true).set("records", true);
    });
    window.requestAnimationFrame?.(() =>
      document.getElementById(`outcome-${name}`)?.scrollIntoView?.({ block: "nearest" })
    );
  }
  const historicalReview =
    reviewRevision !== undefined && outcome?.currentRevision !== reviewRevision;
  useEffect(() => {
    if (!historicalReview || reviewRevision === undefined) return;
    let active = true;
    setReviewView(null);
    setReviewLoading(true);
    setReviewError(false);
    if (!client.getRevision) {
      setReviewLoading(false);
      setReviewError(true);
      return;
    }
    void client
      .getRevision(outcomeId, reviewRevision)
      .then(
        (value) => {
          if (active) {
            if (value.revision === reviewRevision) setReviewView(value);
            else setReviewError(true);
          }
        },
        () => {
          if (active) setReviewError(true);
        }
      )
      .finally(() => {
        if (active) setReviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, outcomeId, reviewRevision, historicalReview, refreshVersion, reviewReload]);
  useEffect(() => {
    const request = ++generation.current;
    void client.get(outcomeId).then(
      (result) => {
        if (generation.current === request) {
          setOutcome(result);
          setRefreshVersion((v) => v + 1);
        }
      },
      (e) => {
        if (generation.current === request) setError(outcomeErrorMessage(e));
      }
    );
    return () => {
      generation.current++;
    };
  }, [outcomeId, client]);
  // Approval starts execution on the server. A goal approved before that rule (or whose start failed) is
  // started once when opened; the request is idempotent, so a repeat cannot create a second run.
  const autoStarted = useRef<string | null>(null);
  useEffect(() => {
    const approved = outcome?.currentRevisionView;
    if (!outcome || !approved || historicalReview || busy) return;
    const waiting =
      outcome.status === "approved" &&
      approved.status === "approved" &&
      !outcome.workItems.some((item) => item.contractRevision === approved.revision);
    const key = `${outcomeId}:${approved.revision}`;
    if (!waiting || autoStarted.current === key) return;
    autoStarted.current = key;
    const input = { expectedRevision: approved.revision };
    void mutate("start", input, (clientRequestId) =>
      client.start(outcomeId, { ...input, clientRequestId })
    );
  }, [outcome, busy, outcomeId, client, historicalReview]);
  async function mutate(
    action: string,
    input: unknown,
    operation: (key: string) => Promise<OutcomeDetailView>
  ) {
    if (busy) return;
    generation.current++;
    setBusy(true);
    setError(null);
    try {
      const result = await operation(requestIds.current.for(`${action}:${outcomeId}`, input));
      setOutcome(result);
      setRefreshVersion((v) => v + 1);
      requestIds.current.complete(`${action}:${outcomeId}`);
    } catch (e) {
      setError(outcomeErrorMessage(e));
      if (responseStatus(e) === 409) {
        try {
          setOutcome(await client.get(outcomeId));
          setRefreshVersion((value) => value + 1);
        } catch {
          /* Retain the conflict until an authenticated refresh succeeds. */
        }
      }
    } finally {
      setBusy(false);
    }
  }
  async function requestChanges(text: string) {
    if (busy || !outcome?.currentRevisionView) return;
    const revision = outcome.currentRevisionView;
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const plan = await planOutcomeChanges(client, revision, text);
      if (generation.current === request) setChangePlan({ plan, request: text, revision });
    } catch (error) {
      if (generation.current === request) setError(outcomeErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (!outcome)
    return (
      <section>
        {error ? <p role="alert">{error}</p> : <p role="status">Loading Outcome…</p>}
        <button onClick={() => void mutate("refresh", {}, () => client.get(outcomeId))}>
          Retry
        </button>
      </section>
    );
  const revision = outcome.currentRevisionView;
  const selectedReview = historicalReview
    ? reviewView?.revision === reviewRevision
      ? reviewView
      : null
    : revision;
  const terminal = ["accepted", "cancelled"].includes(outcome.status);
  const stage = outcomeCardStage(outcome.status);
  const canStart =
    outcome.status === "approved" &&
    revision?.status === "approved" &&
    !terminal &&
    !outcome.workItems.some((i) => i.contractRevision === revision.revision);
  const latestResult = [...outcome.outputs]
    .reverse()
    .find((output) =>
      outcome.workItems.some(
        (item) =>
          item.id === output.workItemId &&
          item.contractRevision === (reviewRevision ?? outcome.currentRevision)
      )
    );
  return (
    <article aria-label="Outcome details" aria-busy={busy} className="outcome-detail space-y-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium tracking-[-0.015em]">{outcome.title}</h2>
          <p className="outcome-status mt-2" data-outcome-status={outcome.status}>
            {translateCurrent(outcomeStatusLabels[outcome.status])}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <OutcomeRefresh
            busy={busy}
            onRefresh={() => void mutate("refresh", {}, () => client.get(outcomeId))}
          />
          <OutcomeButton
            variant="ghost"
            iconOnly
            aria-label={translateCurrent("More details")}
            aria-expanded={sections.get("records") === true}
            onClick={() =>
              setSections((previous) =>
                new Map(previous).set("records", previous.get("records") !== true)
              )
            }
          >
            <MoreHorizontal size={16} />
          </OutcomeButton>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      <OutcomeBriefView outcome={outcome} client={client}>
        {(brief) => (
          <section className="outcome-now" aria-label={translateCurrent("What needs you now")}>
            <p className="outcome-now-eyebrow">{translateCurrent("What needs you now")}</p>
            {onAction && (
              <OutcomeActionItems
                items={actionItems.filter(
                  (item) => item.outcomeId === outcomeId && !(inboxClient && item.decisionId)
                )}
                onSelect={(item) =>
                  item.category === "acceptance_pending" &&
                  selectedReview?.revision === item.contractRevision
                    ? reveal("review")
                    : onAction(item)
                }
              />
            )}
            {inboxClient &&
              actionItems
                .filter(
                  (item) => item.requiresAction && item.outcomeId === outcomeId && item.decisionId
                )
                .map((item) => (
                  <div className="outcome-now-item" key={item.decisionId}>
                    <DecisionCard
                      decisionId={item.decisionId!}
                      client={inboxClient}
                      outcomes={client}
                      inline
                      onOutcome={() => reveal("records")}
                      onResolved={() => void mutate("refresh", {}, () => client.get(outcomeId))}
                    />
                  </div>
                ))}
            {revision?.status === "pending_approval" && !historicalReview && (
              <div className="outcome-now-item">
                <h3>{translateCurrent("Approve this plan?")}</h3>
                <OutcomeApprovalScope intent={brief?.intent} revision={revision} />
                {changePlan ? (
                  <PlanningWizard
                    key={changePlan.plan.planId}
                    botId={revision.executionBotId}
                    client={client}
                    initialPlan={changePlan.plan}
                    initialBudget={revision.budget}
                    revisionTarget={{
                      outcomeId,
                      revision: changePlan.revision,
                      changeSummary: changePlan.request,
                    }}
                    onDone={(value) => {
                      setOutcome(value);
                      setChangePlan(null);
                      setComment("");
                      setRefreshVersion((v) => v + 1);
                    }}
                  />
                ) : (
                  <ContractConfirmation
                    key={revision.id}
                    revision={revision}
                    busy={busy}
                    comment={comment}
                    onComment={setComment}
                    onRequestChanges={(text) => void requestChanges(text)}
                    onApprove={() => {
                      const confirmationText = [
                        translateCurrent(
                          "I approve the saved goals, acceptance criteria and scope."
                        ),
                        comment.trim(),
                      ]
                        .filter(Boolean)
                        .join("\n\n");
                      const input = { expectedRevision: revision.revision, confirmationText };
                      void mutate("approve", input, (clientRequestId) =>
                        client.approve(outcomeId, revision.revision, { ...input, clientRequestId })
                      );
                    }}
                  />
                )}
              </div>
            )}
            {(historicalReview ||
              (outcome.status === "review_pending" &&
                !actionItems.some(
                  (item) =>
                    item.requiresAction &&
                    item.category === "acceptance_pending" &&
                    item.contractRevision === selectedReview?.revision
                ))) && (
              <div className="outcome-now-line">
                <div>
                  <h3>{translateCurrent("Do these results meet your requirements?")}</h3>
                  {latestResult && <p>{latestResult.title}</p>}
                </div>
                <OutcomeButton variant="default" onClick={() => reveal("review")}>
                  {translateCurrent("Review results")}
                </OutcomeButton>
              </div>
            )}
            {canStart && <p role="status">{translateCurrent("Starting execution…")}</p>}
            {!historicalReview &&
              !canStart &&
              revision?.status !== "pending_approval" &&
              outcome.status !== "review_pending" &&
              !actionItems.some((item) => item.requiresAction) && (
                <p role="status">{translateCurrent(outcomeNextSteps[stage])}</p>
              )}
            {actionsLoading && (
              <p role="status">{translateCurrent("Checking current decisions…")}</p>
            )}
            {actionsError && (
              <p role="alert">
                {translateCurrent(
                  "Current decisions could not be loaded. Open Needs attention to retry."
                )}
              </p>
            )}
          </section>
        )}
      </OutcomeBriefView>
      {!historicalReview && (
        <OutcomeExecutionCard
          key={`${outcome.id}:${outcome.currentRevision}`}
          outcome={outcome}
          bot={bots.find((bot) => bot.id === outcome.botId)}
          client={client}
        />
      )}
      {sections.has("records") && (
        <section
          hidden={sections.get("records") !== true}
          aria-label={translateCurrent("Supporting records")}
          className="space-y-5"
        >
          {revision && (
            <div className="outcome-saved-plan">
              <span>{translateCurrent("Saved plan")}</span>
              <OutcomeSourceInfo
                text={JSON.stringify(revision, null, 2)}
                name={translateCurrent("Saved plan")}
              />
              {!terminal && (
                <ContractEditor
                  key={revision.id}
                  revision={revision}
                  busy={busy}
                  onSave={(input) =>
                    void mutate("revision", input, (clientRequestId) =>
                      client.revise(outcomeId, { ...input, clientRequestId })
                    )
                  }
                />
              )}
            </div>
          )}
          {outcome.workItems.length > 0 && (
            <details className="outcome-disclosure" {...disclosure("execution")}>
              <summary>
                {translateCurrent("Execution progress")}{" "}
                <span>
                  {translateCurrent("{count} work items", { count: outcome.workItems.length })}
                </span>
              </summary>
              {sections.has("execution") && (
                <section className="space-y-2">
                  {outcome.workItems.map((item) => (
                    <div key={item.id} className="outcome-card">
                      <p>
                        {item.title} · {translateCurrent(item.status)}
                      </p>
                      {item.statusReason && <p>{item.statusReason}</p>}
                      <details className="outcome-technical">
                        <summary>{translateCurrent("Execution IDs and provenance")}</summary>
                        <p>
                          {item.executorType} · {item.kind} ·{" "}
                          {revisionMaterialLabel(item.contractRevision, outcome.currentRevision)}
                        </p>
                        <p className="break-all text-xs">
                          WorkItem {item.id}
                          {item.rootRunId && ` · Root Run ${item.rootRunId}`}
                        </p>
                        {item.runIds.length > 0 && (
                          <p className="break-all text-xs">Runs: {item.runIds.join(", ")}</p>
                        )}
                        {item.reworkOfWorkItemId && (
                          <p className="break-all text-xs">Rework of {item.reworkOfWorkItemId}</p>
                        )}
                      </details>
                      {item.executorType === "agent" && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            setError(null);
                            void client
                              .transcript(outcomeId, item.id)
                              .then(setTranscript, (e) => setError(outcomeErrorMessage(e)));
                          }}
                        >
                          {translateCurrent("Show read-only transcript")}
                        </button>
                      )}
                    </div>
                  ))}
                </section>
              )}
            </details>
          )}
          {transcript !== null && (
            <details open>
              <summary>Read-only transcript</summary>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(transcript, null, 2)}
              </pre>
              <button onClick={() => setTranscript(null)}>Close transcript</button>
            </details>
          )}
          {outcome.outputs.length > 0 && (
            <details id="outcome-outputs" className="outcome-disclosure" {...disclosure("outputs")}>
              <summary>
                {translateCurrent("Results")}{" "}
                <span>
                  {translateCurrent("{count} outputs", { count: outcome.outputs.length })}
                </span>
              </summary>
              {sections.has("outputs") && (
                <section className="space-y-2">
                  {outcome.outputs.map((output) => (
                    <div key={output.id} className="outcome-card">
                      <h4>{output.title}</h4>
                      <p className="text-xs">
                        {revisionMaterialLabel(
                          outcome.workItems.find((item) => item.id === output.workItemId)
                            ?.contractRevision ?? null,
                          outcome.currentRevision
                        )}
                      </p>
                      {output.content && (
                        <details>
                          <summary>{translateCurrent("Read result")}</summary>
                          <p className="whitespace-pre-wrap">{output.content}</p>
                        </details>
                      )}
                      <details className="outcome-technical">
                        <summary>{translateCurrent("Source and execution records")}</summary>
                        <p>{output.kind}</p>
                        {output.contentRef && (
                          <p className="break-all">Source: {output.contentRef}</p>
                        )}
                        <p className="break-all text-xs">
                          WorkItem {output.workItemId}
                          {output.runId && ` · Run ${output.runId}`}
                        </p>
                      </details>
                    </div>
                  ))}
                </section>
              )}
            </details>
          )}
          {outcome.evidence.length > 0 && (
            <details className="outcome-disclosure" {...disclosure("evidence")}>
              <summary>
                {translateCurrent("Review evidence")}{" "}
                <span>
                  {translateCurrent("{count} evidence records", { count: outcome.evidence.length })}
                </span>
              </summary>
              {sections.has("evidence") && (
                <section className="space-y-2">
                  {outcome.evidence.map((e) => (
                    <div key={e.id} className="outcome-card">
                      <span className="rounded-md bg-subtle px-2 py-0.5 text-[11px] text-foreground-secondary">
                        {evidenceCredibilityLabels[e.credibility]}
                      </span>
                      <p className="mt-2 whitespace-pre-wrap">{e.contentSummary}</p>
                      <p className="text-xs">
                        {revisionMaterialLabel(e.contractRevision, outcome.currentRevision)}
                      </p>
                      <details className="outcome-technical">
                        <summary>{translateCurrent("Evidence source and capture details")}</summary>
                        <p className="break-all text-xs">
                          {e.sourceType}: {e.sourceRef} · revision {e.contractRevision} ·{" "}
                          {e.capturedBy} · {e.capturedAt}
                        </p>
                      </details>
                      {e.sourceType === "asset" && <OutcomeAsset sourceRef={e.sourceRef} />}
                    </div>
                  ))}
                </section>
              )}
            </details>
          )}
          {historicalReview && (
            <section
              aria-label={translateCurrent("Receipt Contract revision")}
              className="space-y-2 outcome-card"
            >
              <p>
                {translateCurrent(
                  "Receipt review uses Contract revision {revision}. The current Contract stays at revision {current}.",
                  { revision: reviewRevision, current: outcome.currentRevision }
                )}
              </p>
              {reviewLoading && (
                <p role="status">{translateCurrent("Loading the receipt's original Contract…")}</p>
              )}
              {reviewError && (
                <p role="alert">
                  {translateCurrent(
                    "Could not load the receipt's Contract. Review is disabled until its actual criteria are available."
                  )}
                </p>
              )}
              <button
                className="outcome-control"
                disabled={reviewLoading}
                onClick={() => setReviewReload((value) => value + 1)}
              >
                {translateCurrent("Reload receipt Contract")}
              </button>
            </section>
          )}
          {selectedReview &&
            (historicalReview ||
              (selectedReview.status === "approved" && outcome.workItems.length > 0)) && (
              <details id="outcome-review" className="outcome-disclosure" {...disclosure("review")}>
                <summary>
                  {translateCurrent("Review and rework")}{" "}
                  <span>
                    {outcome.status === "review_pending"
                      ? translateCurrent("Waiting for your confirmation")
                      : translateCurrent("Check against the acceptance criteria")}
                  </span>
                </summary>
                {sections.has("review") && (
                  <ReviewPanel
                    key={`${selectedReview.id}:${refreshVersion}`}
                    outcome={outcome}
                    reviewRevisionView={selectedReview}
                    busy={busy || reviewLoading}
                    onSubmit={(input) =>
                      void mutate("review", input, (clientRequestId) =>
                        client.review(outcomeId, { ...input, clientRequestId })
                      )
                    }
                    onRework={(criterionIds, comment) => {
                      const input = {
                        criterionIds,
                        comment,
                        expectedRevision: selectedReview.revision,
                      };
                      void mutate("rework", input, (clientRequestId) =>
                        client.rework(outcomeId, { ...input, clientRequestId })
                      );
                    }}
                  />
                )}
              </details>
            )}
          {(outcome.revisions.length > 1 || outcome.reviews.length > 0) && (
            <details className="outcome-disclosure" {...disclosure("history")}>
              <summary>{translateCurrent("History and revisions")}</summary>
              {sections.has("history") && (
                <>
                  <RevisionHistory outcome={outcome} />
                  <h3>{translateCurrent("Review history")}</h3>
                  {outcome.reviews.map((r) => (
                    <p key={r.id}>
                      {revisionMaterialLabel(r.contractRevision, outcome.currentRevision)} ·{" "}
                      {r.criterionId} · #{r.sequence} · {r.result} · {r.comment} · {r.reviewedBy}
                    </p>
                  ))}
                </>
              )}
            </details>
          )}
          <details className="outcome-disclosure" {...disclosure("advanced")}>
            <summary>{translateCurrent("More actions and diagnostics")}</summary>
            {sections.has("advanced") && (
              <>
                <RecoveryDiagnostics outcomeId={outcomeId} />
                {!terminal && (
                  <button
                    className="outcome-control"
                    disabled={busy}
                    onClick={() =>
                      void mutate("cancel", {}, (clientRequestId) =>
                        client.cancel(outcomeId, { clientRequestId })
                      )
                    }
                  >
                    {translateCurrent("Cancel Outcome")}
                  </button>
                )}
              </>
            )}
          </details>
        </section>
      )}
    </article>
  );
}
