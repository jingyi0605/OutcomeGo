import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { OutcomeDetail } from "@outcomego/contracts/outcomes";
import type { OutcomeThreadView } from "@outcomego/contracts/outcome-thread";
import type { OutcomeClient } from "../../../../client/outcome-api";
import { useI18n } from "../../../../lib/i18n";
import { routineLocalDateTime } from "../../../../lib/routines";
import { subscribeOutcomeListRefresh } from "../../../../lib/outcome-events";
import { OutcomeRequestIds, outcomeErrorMessage } from "../planning/outcome-client";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import { outcomeStatusLabels } from "../outcome-list";
import { OutcomeButton, OutcomeRefresh } from "../outcome-ui";
import { UnifiedPlanPanel } from "../planning/unified-plan-panel";
import { MessageFileAttachments } from "../../file-attachment";
import { OutcomeEvolutionPanel, OutcomeRelationsPanel } from "./outcome-kind-panels";

export type ScheduledOutcome = Extract<OutcomeDetail, { kind: "scheduled_once" }>;

/** A one-time scheduled goal: its time, its lifecycle, the planner's run advice and the result of the run. */
export function ScheduledOutcomeDetail({ outcome, client, bots, thread, onChange, onSelectOutcome }: {
  outcome: ScheduledOutcome;
  client: OutcomeClient;
  bots: readonly OutcomeExecutionBot[];
  thread: { view: OutcomeThreadView | null; reload: () => void };
  onChange: (outcome: OutcomeDetail) => void;
  onSelectOutcome?: (outcomeId: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ revision: number; time: string } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<number | null>(null);
  const requestIds = useRef(new OutcomeRequestIds());
  const generation = useRef(0);
  const mutating = useRef(false);
  const { id, revision, status, scheduledAt } = outcome;

  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await client.get(id);
      if (request !== generation.current) return;
      onChange(result);
      setReadError(false);
    } catch {
      if (request === generation.current) setReadError(true);
    }
  }, [client, id]);
  const running = status === "running";
  useEffect(() => {
    const refresh = () => { if (!mutating.current) void load(); };
    const unsubscribe = subscribeOutcomeListRefresh(refresh);
    window.addEventListener("focus", refresh);
    const timer = running ? window.setInterval(() => {
      if (document.visibilityState !== "hidden") refresh();
    }, 1_500) : undefined;
    return () => {
      generation.current++;
      unsubscribe();
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [load, running]);

  async function mutate(operation: () => Promise<unknown>) {
    if (mutating.current) return;
    mutating.current = true;
    generation.current++;
    setBusy(true);
    setActionError(null);
    try {
      await operation();
    } catch (error) {
      setActionError(outcomeErrorMessage(error));
    } finally {
      await load();
      mutating.current = false;
      setBusy(false);
    }
  }

  const { startedAt, deliveredAt, resultSummary } = outcome.kindMeta;
  const future = Date.parse(scheduledAt) > Date.now();
  const canEdit = (status === "scheduled" || status === "preparing" || status === "paused") && !startedAt;
  const advice = thread.view?.turns.filter((turn) => turn.planMode === "advice" && turn.outcomeRevision === revision).at(-1);
  const pending = advice?.status === "queued" || advice?.status === "running";
  const { plan } = client;
  const canPrepare = canEdit && status !== "paused" && future && Boolean(plan);

  const requestAdvice = () => void mutate(async () => {
    const key = `advice:${id}`;
    const input = { mode: "advice" as const, expectedRevision: revision };
    await plan!.call(client, id, { ...input, clientRequestId: requestIds.current.for(key, input) });
    requestIds.current.complete(key);
    thread.reload();
  });
  const act = (action: "pause" | "resume" | "cancel", expectedRevision: number) => mutate(async () => {
    const key = `${action}:${id}`;
    const input = { action, expectedRevision };
    onChange(await client.act(id, { ...input, clientRequestId: requestIds.current.for(key, input) }));
    requestIds.current.complete(key);
    setConfirmCancel(null);
  });
  const reschedule = (event: FormEvent) => {
    event.preventDefault();
    if (!editing || editing.revision !== revision) return;
    const time = new Date(editing.time);
    if (!(time.getTime() > Date.now())) {
      setActionError(t("Choose a future execution time."));
      return;
    }
    // A preparation time at or after the new execution time no longer applies.
    const dropPreparation = outcome.prepareAt !== null && Date.parse(outcome.prepareAt) >= time.getTime();
    const key = `reschedule:${id}`;
    const input = { expectedRevision: editing.revision, scheduledAt: time.toISOString(), ...(dropPreparation && { prepareAt: null }) };
    void mutate(async () => {
      onChange(await client.update(id, { ...input, clientRequestId: requestIds.current.for(key, input) }));
      requestIds.current.complete(key);
      setEditing(null);
    });
  };
  return (
    <article aria-label={t("Scheduled goal details")} aria-busy={busy} className="space-y-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="break-words text-base font-medium">{outcome.title}</h2>
          <p className="outcome-row-meta">{bots.find((bot) => bot.id === outcome.botId)?.name ?? t("Bot")} · {t(outcomeStatusLabels[status])}</p>
          <p className="text-sm">{t("Scheduled time")} · <time dateTime={scheduledAt}>{new Date(scheduledAt).toLocaleString()}</time></p>
        </div>
        <OutcomeRefresh busy={busy} onRefresh={() => { thread.reload(); void load(); }} />
      </header>
      <p className="whitespace-pre-wrap break-words text-sm">{outcome.description}</p>
      {outcome.attachments.length > 0 && <MessageFileAttachments attachments={outcome.attachments} />}
      <OutcomeRelationsPanel outcome={outcome} onSelectOutcome={onSelectOutcome} />
      {(actionError || readError) && <p role="alert" className="text-sm text-destructive">{actionError ?? t("Could not load scheduled goals.")}</p>}
      {canEdit && <div className="flex flex-wrap gap-2">
        <OutcomeButton disabled={busy} onClick={() => setEditing({ revision, time: routineLocalDateTime(scheduledAt) })}>{t("Change scheduled time")}</OutcomeButton>
        <OutcomeButton disabled={busy || (status === "paused" && !future)} onClick={() => void act(status === "paused" ? "resume" : "pause", revision)}>
          {status === "paused" ? t("Resume") : t("Pause")}
        </OutcomeButton>
        <OutcomeButton className="text-destructive" disabled={busy} onClick={() => setConfirmCancel(revision)}>{t("Cancel scheduled goal")}</OutcomeButton>
      </div>}
      {canEdit && editing && <form onSubmit={reschedule} className="outcome-card space-y-2">
        <label className="block text-sm" htmlFor="scheduled-outcome-time">{t("Scheduled time")}</label>
        <input className="outcome-control" id="scheduled-outcome-time" type="datetime-local" required value={editing.time} onChange={(event) => setEditing({ ...editing, time: event.target.value })} />
        {editing.revision !== revision && <p role="alert">{t("This goal changed elsewhere. Reopen it to load the latest version.")}</p>}
        <div className="flex gap-2">
          <OutcomeButton type="submit" disabled={busy || editing.revision !== revision}>{t("Save")}</OutcomeButton>
          <OutcomeButton type="button" variant="ghost" onClick={() => setEditing(null)}>{t("Cancel")}</OutcomeButton>
        </div>
      </form>}
      {canEdit && confirmCancel !== null && <div className="outcome-card space-y-2">
        <p>{t("Cancel this scheduled goal and keep its history?")}</p>
        <div className="flex gap-2">
          <OutcomeButton variant="destructive" disabled={busy || confirmCancel !== revision} onClick={() => void act("cancel", confirmCancel)}>{t("Confirm cancellation")}</OutcomeButton>
          <OutcomeButton variant="ghost" onClick={() => setConfirmCancel(null)}>{t("Keep scheduled goal")}</OutcomeButton>
        </div>
      </div>}
      {(canPrepare || advice) && <UnifiedPlanPanel
        turns={advice ? [advice] : []}
        advice={outcome.latestAdvice}
        pending={pending}
        busy={busy}
        canPlan={canPrepare}
        scheduled
        onPlan={requestAdvice}
      />}
      {canEdit && <OutcomeEvolutionPanel
        outcome={outcome}
        client={client}
        bots={bots}
        busy={busy}
        onConverted={onChange}
      />}
      {(startedAt || outcome.closeSummary) && <section aria-label={t("Run result")} className="outcome-card space-y-2 text-sm">
        <h3 className="font-medium">{t("Run result")}</h3>
        {startedAt && <p><time dateTime={startedAt}>{new Date(startedAt).toLocaleString()}</time> · {t(deliveredAt ? "Reminder sent" : "Reminder not yet sent")}</p>}
        {(resultSummary ?? outcome.closeSummary) && <p className="whitespace-pre-wrap break-words">{resultSummary ?? outcome.closeSummary}</p>}
      </section>}
    </article>
  );
}
