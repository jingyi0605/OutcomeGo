import { useContext, useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import type {
  OutcomeDetail as OutcomeDetailView,
  ContractRevisionView,
} from "@outcomego/contracts/outcomes";
import { ContractConfirmation } from "../planning/contract-confirmation";
import {
  type OutcomeClient,
  OutcomeRequestIds,
  outcomeErrorMessage,
} from "../planning/outcome-client";
import { Info, MoreHorizontal } from "lucide-react";
import { OutcomeThreadPanel } from "../thread/outcome-thread-panel";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../ui/dropdown-menu";
import { OutcomeSourceInfo } from "../outcome-source-info";
import { ContractEditor } from "./contract-editor";
import { ReviewPanel } from "./review-panel";
import { RevisionHistory, revisionMaterialLabel } from "./revision-history";
import { RecoveryDiagnostics } from "../inbox/recovery-diagnostics";
import { responseStatus } from "../inbox/decision-state";
import { useI18n } from "../../../../lib/i18n";
import { subscribeOutcomeRefresh } from "../../../../lib/outcome-events";
import { OutcomeAsset } from "../outcome-asset";
import { OutcomeButton, OutcomeRefresh } from "../outcome-ui";
import { outcomeCardStage } from "@outcomego/contracts/outcome-chat-card";
import { outcomeStatusLabels } from "../outcome-list";
import { outcomeNextSteps } from "../outcome-presentation";
import { OutcomeActionItems, OutcomeApprovalScope, OutcomeBriefView } from "../outcome-brief";
import { DecisionCard } from "../inbox/decision-card";
import type { InboxClient } from "../inbox/inbox-api";
import type { OutcomeInboxItemView } from "@outcomego/contracts/outcome-inbox";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import { WorkThreadNavigation } from "../../../../lib/work-thread-navigation";

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
  onReplanStarted,
  onActionSubmitted,
  onReady,
  useCache = false,
  inChat = false,
  onOpenDetails,
}: {
  bots?: OutcomeExecutionBot[];
  /** Called right after a Modify request is handed to the background, so the host can close its modal. */
  onReplanStarted?: () => void;
  /** Called after an inline choice, approval, or acceptance submission completes. */
  onActionSubmitted?: () => void;
  /** Called once initial goal actions and any inline decision/report have finished loading. */
  onReady?: () => void;
  useCache?: boolean;
  outcomeId: string;
  client: OutcomeClient;
  inboxClient?: InboxClient;
  initialOutcome?: OutcomeDetailView;
  reviewRevision?: number;
  actionItems?: OutcomeInboxItemView[];
  actionsError?: boolean;
  actionsLoading?: boolean;
  onAction?: (item: OutcomeInboxItemView) => void;
  inChat?: boolean;
  onOpenDetails?: () => void;
}) {
  const { t: translateCurrent } = useI18n();
  const sectionId = useId();
  const openWorkThread = useContext(WorkThreadNavigation);
  const [outcome, setOutcome] = useState(initialOutcome ?? null);
  const outcomeRef = useRef<OutcomeDetailView | null>(initialOutcome ?? null);
  useEffect(() => {
    if (!outcomeRef.current && initialOutcome && initialOutcome.id === outcomeId) {
      outcomeRef.current = initialOutcome;
      setOutcome(initialOutcome);
    }
  }, [initialOutcome, outcomeId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [stopping, setStopping] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestIds = useRef(new OutcomeRequestIds());
  const generation = useRef(0);
  const readyDecisionsRef = useRef<Set<string>>(new Set());
  const reviewReadyRef = useRef(false);
  const readyNotifiedRef = useRef(false);
  useEffect(() => {
    readyDecisionsRef.current.clear();
    reviewReadyRef.current = false;
    readyNotifiedRef.current = false;
  }, [outcomeId]);
  const decisionIdsKey = inboxClient
    ? actionItems
        .filter((item) => item.requiresAction && item.outcomeId === outcomeId && item.decisionId)
        .map((item) => item.decisionId!)
        .join(",")
    : "";
  const [reviewView, setReviewView] = useState<ContractRevisionView | null>(null);
  const [reviewError, setReviewError] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewReload, setReviewReload] = useState(0);
  // A visited entry stays mounted when closed, preserving unsaved form state.
  const [sections, setSections] = useState<Map<string, boolean>>(() => new Map());
  useEffect(() => {
    // New revisions cannot inherit comments or generated choices from the previous plan.
    setSections(new Map());
    setComment("");
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
      const next = new Map(previous).set(name, true);
      if (name === "review") next.set("goal-details", false);
      else next.set("records", true);
      return next;
    });
    window.requestAnimationFrame?.(() =>
      document.getElementById(name === "review" ? `${sectionId}-review` : `outcome-${name}`)?.scrollIntoView?.({ block: "nearest" })
    );
  }
  const historicalReview =
    reviewRevision !== undefined && outcome?.currentRevision !== reviewRevision;
  const currentReviewRevision = outcome?.currentRevisionView;
  const currentSelectedReview = historicalReview
    ? reviewView?.revision === reviewRevision
      ? reviewView
      : null
    : currentReviewRevision;
  const canRenderCurrentReview = Boolean(
    outcome &&
      currentSelectedReview &&
      (historicalReview ||
        (currentSelectedReview.status === "approved" && outcome.workItems.length > 0))
  );
  const currentReviewOpen = Boolean(
    outcome &&
      (sections.get("review") ??
        (reviewRevision !== undefined ||
          (outcome.status === "review_pending" && canRenderCurrentReview)))
  );
  const currentPrereview =
    outcome && currentSelectedReview && outcome.prereview?.revision === currentSelectedReview.revision
      ? outcome.prereview
      : undefined;
  const currentReviewStatus =
    outcome && currentSelectedReview?.revision === outcome.currentRevision
      ? outcome.prereviewStatus
      : undefined;
  const needsReviewReportReady = Boolean(
    outcome &&
      currentReviewOpen &&
      canRenderCurrentReview &&
      currentSelectedReview &&
      client.resultSummary &&
      !currentPrereview &&
      currentReviewStatus !== "pending"
  );
  useEffect(() => {
    if (!onReady || readyNotifiedRef.current || !outcome || actionsLoading) return;
    if (needsReviewReportReady && !reviewReadyRef.current) return;
    const ids = decisionIdsKey ? decisionIdsKey.split(",") : [];
    if (ids.every((id) => readyDecisionsRef.current.has(id))) {
      readyNotifiedRef.current = true;
      onReady();
    }
  }, [onReady, outcome, actionsLoading, decisionIdsKey, needsReviewReportReady]);
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
          const previous = outcomeRef.current;
          outcomeRef.current = result;
          setOutcome(result);
          if (
            previous &&
            (previous.currentRevision !== result.currentRevision ||
              previous.status !== result.status)
          ) {
            setRefreshVersion((v) => v + 1);
          }
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
  useEffect(() => {
    return subscribeOutcomeRefresh(outcomeId, () => {
      const request = ++generation.current;
      void client.get(outcomeId).then(
        (result) => {
          if (generation.current === request) {
            const previous = outcomeRef.current;
            outcomeRef.current = result;
            setOutcome(result);
            if (
              previous &&
              (previous.currentRevision !== result.currentRevision ||
                previous.status !== result.status)
            ) {
              setRefreshVersion((v) => v + 1);
            }
          }
        },
        () => {
          /* Keep current view until manual refresh or next event succeeds. */
        }
      );
    });
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
      outcomeRef.current = result;
      setOutcome(result);
      setRefreshVersion((v) => v + 1);
      requestIds.current.complete(`${action}:${outcomeId}`);
      if (["approve", "acceptance", "review", "rework", "adopt-prereview", "cancel"].includes(action)) {
        onActionSubmitted?.();
      }
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
  // The owner's words go to the goal's thread as written. The bot decides what to do with them (change the
  // plan, cancel, ask back), so the host modal can close at once; its answer is in the goal's thread.
  async function requestChanges(text: string) {
    const send = client.sendThreadMessage;
    if (!send || busy || !outcome) return;
    setBusy(true);
    setError(null);
    try {
      await send.call(client, outcomeId, {
        text,
        clientRequestId: requestIds.current.for(`message:${outcomeId}`, { text }),
      });
      requestIds.current.complete(`message:${outcomeId}`);
      setComment("");
      setRefreshVersion((v) => v + 1);
      onReplanStarted?.();
      onActionSubmitted?.();
    } catch (e) {
      setError(outcomeErrorMessage(e));
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
  const currentWorkItems = outcome.workItems.filter(
    (item) => item.contractRevision === outcome.currentRevision
  );
  const activeProgress =
    currentWorkItems.find((item) => item.status === "running" && item.progress)?.progress ??
    [...currentWorkItems].reverse().find((item) => item.progress)?.progress ??
    null;
  const prereviewPending = !historicalReview && outcome.status === "review_pending" && outcome.prereviewStatus === "pending";
  const canRenderReview = Boolean(
    selectedReview &&
      !prereviewPending &&
      (historicalReview || (selectedReview.status === "approved" && outcome.workItems.length > 0))
  );
  const reviewOpen = !prereviewPending && (sections.get("review") ??
    (reviewRevision !== undefined || (outcome.status === "review_pending" && canRenderReview)));
  const goalDetailsOpen = !reviewOpen || sections.get("goal-details") === true;
  const receiptReview = outcome.workItems.some(
    (item) =>
      item.executorType === "human" &&
      item.contractRevision === selectedReview?.revision &&
      ["submitted", "review_pending"].includes(item.status)
  );
  function decideAcceptance(decision: "approve" | "reject", reason = "") {
    const decide = client.decideAcceptance;
    if (!selectedReview || !decide) return;
    const expectedRevision = selectedReview.revision;
    const input = decision === "approve"
      ? { decision, expectedRevision }
      : { decision, expectedRevision, reason };
    if (decision === "approve") {
      setSections((previous) => new Map(previous).set("review", true));
    }
    void mutate("acceptance", input, (clientRequestId) =>
      decide(outcomeId, { ...input, clientRequestId })
    );
  }
  return (
    <article aria-label="Outcome details" aria-busy={busy} className={inChat ? "outcome-detail space-y-2.5" : "outcome-detail space-y-5"}>
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className={inChat ? "sr-only" : "text-[15px] font-medium tracking-[-0.015em]"}>{outcome.title}</h2>
          <p className={inChat ? "outcome-status" : "outcome-status mt-2"} data-outcome-status={outcome.status}>
            {translateCurrent(
              prereviewPending ? "Preliminary review in progress" : outcomeStatusLabels[outcome.status]
            )}
          </p>
          {outcome.trackingMode === "tracked" ? (
            <p className="mt-1 text-[12px] opacity-70" data-outcome-tracked={outcome.autoClosedAt ? "closed" : "open"}>
              {translateCurrent(
                outcome.autoClosedAt ? "Closed automatically by its Bot" : "Tracked by its Bot"
              )}
              {outcome.closeSummary ? ` · ${outcome.closeSummary}` : ""}
            </p>
          ) : null}
          {prereviewPending && (
            <p role="status" className="mt-2 text-[12px] text-foreground-secondary">
              {translateCurrent("The reviewer is checking the latest results. Acceptance will open after the preliminary review finishes.")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <OutcomeRefresh
            busy={busy}
            onRefresh={() => void mutate("refresh", {}, () => client.get(outcomeId))}
          />
          <OutcomeButton
            variant="ghost"
            iconOnly
            aria-label={translateCurrent(onOpenDetails ? "View goal details" : "More details")}
            aria-expanded={onOpenDetails ? undefined : sections.get("records") === true}
            aria-haspopup={onOpenDetails ? "dialog" : undefined}
            title={translateCurrent(onOpenDetails ? "View goal details" : "More details")}
            onClick={() => {
              if (onOpenDetails) {
                onOpenDetails();
                return;
              }
              setSections((previous) =>
                new Map(previous).set("goal-details", true).set("records", previous.get("records") !== true)
              );
            }}
          >
            <Info size={16} aria-hidden="true" />
          </OutcomeButton>
          {outcome.status !== "accepted" && typeof client.cancel === "function" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="outcome-control" aria-label={translateCurrent("Goal actions")}>
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={busy} className="text-destructive" onSelect={() => setStopping(true)}>
                  {translateCurrent(outcome.status === "cancelled" ? "Retry stopping goal" : "End goal")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      {stopping && (
        <section className="space-y-2 border-b border-border pb-3" aria-label={translateCurrent("End goal")}>
          <p>{translateCurrent("Stop this goal and its active tasks? Saved results will be kept.")}</p>
          <div className="flex gap-2">
            <OutcomeButton variant="secondary" disabled={busy} onClick={() => setStopping(false)}>{translateCurrent("Cancel")}</OutcomeButton>
            <OutcomeButton disabled={busy} onClick={() => void mutate("cancel", {}, async (clientRequestId) => {
              const result = await client.cancel(outcomeId, { clientRequestId });
              setStopping(false);
              return result;
            })}>{translateCurrent("End goal")}</OutcomeButton>
          </div>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      {(reviewOpen || sections.has("review")) && (historicalReview || canRenderReview) && (
        <section
          data-outcome-section="review"
          id={`${sectionId}-review`}
          hidden={!reviewOpen}
          aria-label={translateCurrent("Acceptance review")}
          className="space-y-4"
        >
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
          {canRenderReview && selectedReview && (
            <ReviewPanel
              key={`${selectedReview.id}:${refreshVersion}`}
              outcome={outcome}
              reviewRevisionView={selectedReview}
              receiptReview={receiptReview}
              loadResultSummary={client.resultSummary}
              useCache={useCache}
              onReady={() => {
                reviewReadyRef.current = true;
                if (!onReady || readyNotifiedRef.current || !outcome || actionsLoading) return;
                const ids = decisionIdsKey ? decisionIdsKey.split(",") : [];
                if (ids.every((id) => readyDecisionsRef.current.has(id))) {
                  readyNotifiedRef.current = true;
                  onReady();
                }
              }}
              busy={busy || reviewLoading}
              onClose={() => setSections((previous) => new Map(previous).set("review", false))}
              onApprove={client.decideAcceptance ? () => decideAcceptance("approve") : undefined}
              onReject={client.decideAcceptance ? (reason) => decideAcceptance("reject", reason) : undefined}
              onAdoptPrereview={
                client.adoptPrereview
                  ? (turnId) => {
                      const input = { expectedRevision: selectedReview.revision, turnId };
                      void mutate("adopt-prereview", input, (clientRequestId) =>
                        client.adoptPrereview!(outcomeId, { ...input, clientRequestId })
                      );
                    }
                  : undefined
              }
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
        </section>
      )}
      {reviewOpen && !inChat && (
        <OutcomeButton
          variant="secondary"
          aria-expanded={goalDetailsOpen}
          aria-controls={`${sectionId}-goal-details`}
          onClick={() =>
            setSections((previous) => new Map(previous).set("goal-details", !goalDetailsOpen))
          }
        >
          {translateCurrent("Goal details")}
        </OutcomeButton>
      )}
      <div data-outcome-section="goal-details" id={`${sectionId}-goal-details`} hidden={!goalDetailsOpen} className="space-y-5">
        <OutcomeBriefView outcome={outcome} client={client} hideFacts={inChat}>
          {(brief) => {
            const decisionItems = inboxClient
              ? actionItems.filter(
                  (item) => item.requiresAction && item.outcomeId === outcomeId && item.decisionId
                )
              : [];
            const visibleActionItems = actionItems.filter((item) => {
              if (item.outcomeId !== outcomeId || (inboxClient && item.decisionId)) return false;
              if (inChat && (item.category === "acceptance_pending" || decisionItems.length > 0)) {
                return false;
              }
              return true;
            });
            return (
              <section className="outcome-now" aria-label={translateCurrent("What needs you now")}>
                {!inChat && (
                  <p className="outcome-now-eyebrow">{translateCurrent("What needs you now")}</p>
                )}
                {onAction && visibleActionItems.length > 0 && (
                  <OutcomeActionItems
                    items={visibleActionItems}
                    onSelect={(item) =>
                      item.category === "acceptance_pending" &&
                      selectedReview?.revision === item.contractRevision
                        ? reveal("review")
                        : onAction(item)
                    }
                  />
                )}
                {decisionItems.map((item) => (
                  <div className="outcome-now-item" key={item.decisionId}>
                    <DecisionCard
                      decisionId={item.decisionId!}
                      client={inboxClient!}
                      outcomes={client}
                      useCache={useCache}
                      inline
                      onOutcome={() => reveal("records")}
                      onReady={() => {
                        readyDecisionsRef.current.add(item.decisionId!);
                        if (!onReady || readyNotifiedRef.current || !outcome || actionsLoading) return;
                        const ids = decisionIdsKey ? decisionIdsKey.split(",") : [];
                        if (ids.every((id) => readyDecisionsRef.current.has(id))) {
                          readyNotifiedRef.current = true;
                          onReady();
                        }
                      }}
                      onResolved={() => {
                        void mutate("refresh", {}, () => client.get(outcomeId));
                        onActionSubmitted?.();
                      }}
                    />
                  </div>
                ))}
              {revision?.status === "pending_approval" && !historicalReview && (
                <div className="outcome-now-item">
                  <h3>{translateCurrent("Approve this plan?")}</h3>
                  <OutcomeApprovalScope intent={brief?.intent} revision={revision} />
                  <ContractConfirmation
                    key={revision.id}
                    revision={revision}
                    busy={busy}
                    waiting={outcome.status === "planning"}
                    comment={comment}
                    onComment={setComment}
                    onRequestChanges={(text) => void requestChanges(text)}
                    onApprove={() => {
                      const confirmationText = [
                        translateCurrent("I approve the saved goals, acceptance criteria and scope."),
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
                </div>
              )}
              {(historicalReview ||
                (outcome.status === "review_pending" &&
                  !prereviewPending &&
                  !actionItems.some(
                    (item) =>
                      item.requiresAction &&
                      item.category === "acceptance_pending" &&
                      item.contractRevision === selectedReview?.revision
                  ))) && (
                <div className="outcome-now-line">
                  <div>
                    <h3>{translateCurrent("Do these results meet your requirements?")}</h3>
                  </div>
                  <OutcomeButton variant="default" onClick={() => reveal("review")}>
                    {translateCurrent("Review results")}
                  </OutcomeButton>
                </div>
              )}
              {canStart && <p role="status">{translateCurrent("Starting execution…")}</p>}
              {!historicalReview &&
                !canStart &&
                !actionsLoading &&
                revision?.status !== "pending_approval" &&
                outcome.status !== "review_pending" &&
                !actionItems.some((item) => item.requiresAction) && (
                  <>
                    {activeProgress && (
                      <div className="outcome-now-phase">
                        <p className="font-medium">
                          {translateCurrent("Current phase")}: {activeProgress.phase}
                        </p>
                        {activeProgress.summary && <p>{activeProgress.summary}</p>}
                      </div>
                    )}
                    <p role="status">{translateCurrent(outcomeNextSteps[stage])}</p>
                  </>
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
            );
          }}
        </OutcomeBriefView>
        {!inChat && sections.get("records") === true && outcome.plan && (
          <details
            className="outcome-disclosure"
            {...disclosure("plan")}
            open={sections.get("plan") ?? revision?.status === "pending_approval"}
          >
            <summary>
              {translateCurrent("Task plan")}{" "}
              <span>
                {translateCurrent("{count} tasks", { count: outcome.plan.tasks.length })}
              </span>
            </summary>
            <div className="mt-2 space-y-2">
              {outcome.plan.notes && (
                <p className="rounded-md bg-subtle px-2.5 py-2 text-xs whitespace-pre-wrap">
                  {outcome.plan.notes}
                </p>
              )}
              {outcome.plan.tasks.map((task) => {
                const assignedBot = bots.find((b) => b.id === task.botId);
                const linkedItem = outcome.workItems.find(
                  (w) => w.contractRevision === revision?.revision && w.planKey === task.key
                );
                return (
                  <div key={task.key} className="outcome-card space-y-1 text-xs">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      <span>{task.title}</span>
                      <span className="rounded bg-subtle px-1.5 py-0.5 text-[11px]">
                        {translateCurrent(task.nature === "deliverable" ? "Deliverable" : "Action")}
                      </span>
                      <span className="text-foreground-secondary">
                        · {assignedBot?.name ?? task.botId}
                      </span>
                      {linkedItem && (
                        <span className="text-foreground-secondary">· {translateCurrent(linkedItem.status)}</span>
                      )}
                      {linkedItem?.review?.state === "rejected_once" && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                          {translateCurrent("Rejected once by review")}
                        </span>
                      )}
                      {linkedItem?.review?.state === "unreviewed" && (
                        <span className="rounded bg-subtle px-1.5 py-0.5 text-[11px] text-foreground-secondary">
                          {translateCurrent("Unreviewed")}
                        </span>
                      )}
                      {linkedItem?.review?.state === "passed" && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                          {translateCurrent("Passed task review")}
                        </span>
                      )}
                    </div>
                    {task.dependsOn && task.dependsOn.length > 0 && (
                      <p className="text-foreground-secondary">
                        {translateCurrent("Depends on")}: {task.dependsOn.join(", ")}
                      </p>
                    )}
                    {linkedItem?.review && linkedItem.review.findings.length > 0 && (
                      <ul className="list-disc space-y-0.5 pl-4 text-foreground-secondary">
                        {linkedItem.review.findings.map((finding, idx) => (
                          <li key={idx}>
                            [{finding.kind}] {finding.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        )}
        {!inChat && !outcome.plan && revision && ["draft", "pending_approval"].includes(revision.status) && outcome.status !== "planning" && (
          <p className="text-xs text-foreground-secondary">
            {translateCurrent("The planner role did not save a task plan; approving will fall back to default execution.")}
          </p>
        )}
        {!inChat && sections.has("records") && (
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
                    {outcome.workItems.map((item) => {
                      const assignedBot = item.botId ? bots.find((b) => b.id === item.botId) : undefined;
                      return (
                        <div key={item.id} className="outcome-card">
                          <div className="flex flex-wrap items-center gap-2">
                            <p>
                              {item.title} · {translateCurrent(item.status)}
                            </p>
                            {item.nature && (
                              <span className="rounded bg-subtle px-1.5 py-0.5 text-[11px]">
                                {translateCurrent(item.nature === "deliverable" ? "Deliverable" : "Action")}
                              </span>
                            )}
                            {assignedBot && (
                              <span className="text-xs text-foreground-secondary">· {assignedBot.name}</span>
                            )}
                            {item.review?.state === "rejected_once" && (
                              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                                {translateCurrent("Rejected once by review")}
                              </span>
                            )}
                            {item.review?.state === "unreviewed" && (
                              <span className="rounded bg-subtle px-1.5 py-0.5 text-[11px] text-foreground-secondary">
                                {translateCurrent("Unreviewed")}
                              </span>
                            )}
                            {item.review?.state === "passed" && (
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                                {translateCurrent("Passed task review")}
                              </span>
                            )}
                          </div>
                          {item.statusReason && <p>{item.statusReason}</p>}
                          {item.review && item.review.findings.length > 0 && (
                            <details className="outcome-technical">
                              <summary>{translateCurrent("Task review findings ({count})", { count: item.review.findings.length })}</summary>
                              <ul className="list-disc space-y-1 pl-4 text-xs">
                                {item.review.findings.map((finding, idx) => (
                                  <li key={idx}>
                                    [{finding.kind}] {finding.reason}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
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
                        {item.executorType === "agent" && item.botId && openWorkThread && (
                          <OutcomeButton variant="ghost" onClick={() => openWorkThread({
                            id: item.id, outcomeId, outcomeTitle: outcome.title, botId: item.botId!,
                            title: item.title, status: item.status, completedAt: null,
                          })}>
                            {translateCurrent("Open in bot chat")}
                          </OutcomeButton>
                        )}
                      </div>
                      );
                    })}
                  </section>
                )}
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
                          {translateCurrent(evidenceCredibilityLabels[e.credibility])}
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
            {(historicalReview || canRenderReview) && !reviewOpen && !prereviewPending && (
              <div className="outcome-disclosure flex items-center justify-between gap-3">
                <div>
                  <span className="text-[13px] font-medium">
                    {translateCurrent("Review and rework")}
                  </span>
                  <span className="ml-2 text-[11px] text-foreground-secondary">
                    {outcome.status === "review_pending"
                      ? translateCurrent("Waiting for your confirmation")
                      : translateCurrent("Check against the acceptance criteria")}
                  </span>
                </div>
                <OutcomeButton variant="secondary" onClick={() => reveal("review")}>
                  {translateCurrent("Open acceptance review")}
                </OutcomeButton>
              </div>
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
                </>
              )}
            </details>
          </section>
        )}
      </div>
      {!historicalReview && !inChat && (
        <OutcomeThreadPanel key={outcomeId} outcomeId={outcomeId} client={client} closed={terminal} compact />
      )}
    </article>
  );
}
