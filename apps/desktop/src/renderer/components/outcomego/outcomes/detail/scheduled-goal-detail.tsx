import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { isOnceTrigger, type ScheduledGoalDetail as Goal, type UpdateRoutineInput } from "@outcomego/contracts";
import { isTransientRoutineExecutionStatus } from "@outcomego/product-core/statuses";
import { api } from "../../../../client/outcomego-api";
import { useI18n } from "../../../../lib/i18n";
import { routineLocalDateTime } from "../../../../lib/routines";
import { subscribeOutcomeListRefresh } from "../../../../lib/outcome-events";
import { OutcomeRequestIds, outcomeErrorMessage } from "../planning/outcome-client";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import { styleForActivity } from "../dashboard/activity-state";
import { OutcomeButton, OutcomeRefresh } from "../outcome-ui";

export function ScheduledGoalDetail({ id, bots }: { id: string; bots: readonly OutcomeExecutionBot[] }) {
  const { t } = useI18n();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ revision: number; time: string } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<number | null>(null);
  const requestIds = useRef(new OutcomeRequestIds());
  const generation = useRef(0);
  const mutating = useRef(false);

  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await api.scheduledGoal(id);
      if (request !== generation.current) return;
      setGoal(result);
      setReadError(false);
    } catch {
      if (request === generation.current) setReadError(true);
    }
  }, [id]);
  useEffect(() => {
    void load();
    const refresh = () => { if (!mutating.current) void load(); };
    const unsubscribe = subscribeOutcomeListRefresh(refresh);
    window.addEventListener("focus", refresh);
    return () => {
      generation.current++;
      unsubscribe();
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const advice = goal?.executions.find((entry) => entry.kind === "preparation" && entry.revision === goal.routine.revision);
  const pending = Boolean(advice && isTransientRoutineExecutionStatus(advice.status));
  const running = goal?.state === "running" || goal?.state === "waiting";
  useEffect(() => {
    if (!pending && !running) return;
    const timer = window.setInterval(() => {
      if (!mutating.current && document.visibilityState !== "hidden") void load();
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [pending, running, load]);

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

  if (!goal) return readError ? (
    <div role="alert">{t("Could not load scheduled goals.")} <OutcomeButton onClick={() => void load()}>{t("Retry")}</OutcomeButton></div>
  ) : <p role="status">{t("Loading…")}</p>;

  const { routine } = goal;
  const trigger = isOnceTrigger(routine.trigger) ? routine.trigger : null;
  const future = goal.runAt !== null && Date.parse(goal.runAt) > Date.now();
  const canEdit = ["scheduled", "waiting", "preparing", "paused"].includes(goal.state);
  const canPrepare = canEdit && routine.enabled && !running && future && !routine.validationError;
  const ready = advice?.status === "completed" && Boolean(advice.result?.summary);
  const requestAdvice = () => void mutate(async () => {
    const nonce = requestIds.current.for("prepare", routine.revision);
    const execution = await api.prepareRoutine(id, routine.revision, nonce);
    requestIds.current.complete("prepare");
    setGoal((current) => current && { ...current, executions: [execution, ...current.executions.filter((entry) => entry.id !== execution.id)] });
  });
  const reschedule = (event: FormEvent) => {
    event.preventDefault();
    if (!editing || editing.revision !== routine.revision) return;
    const time = new Date(editing.time);
    if (!(time.getTime() > Date.now())) {
      setActionError(t("Choose a future execution time."));
      return;
    }
    const prep = trigger?.preparation;
    const preparation = prep && Date.parse(prep.at) < time.getTime() ? prep : undefined;
    const input: UpdateRoutineInput = { expectedRevision: editing.revision, trigger: { type: "once", runAt: time.toISOString(), ...(preparation && { preparation }) } };
    void mutate(async () => {
      await api.updateRoutine(id, input);
      setEditing(null);
    });
  };
  return (
    <article aria-label={t("Scheduled goal details")} aria-busy={busy} className="space-y-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="break-words text-base font-medium">{goal.name}</h2>
          <p className="outcome-row-meta">{bots.find((bot) => bot.id === goal.botId)?.name ?? t("Bot")} · {t(styleForActivity(goal.state).label)}</p>
          {goal.runAt && <p className="text-sm">{t("Scheduled time")} · <time dateTime={goal.runAt}>{new Date(goal.runAt).toLocaleString()}</time></p>}
        </div>
        <OutcomeRefresh busy={busy} onRefresh={() => void load()} />
      </header>
      <p className="whitespace-pre-wrap break-words text-sm">{routine.prompt}</p>
      {(actionError || readError) && <p role="alert" className="text-sm text-destructive">{actionError ?? t("Could not load scheduled goals.")}</p>}
      {canEdit && <div className="flex flex-wrap gap-2">
        <OutcomeButton disabled={busy} onClick={() => setEditing({ revision: routine.revision, time: goal.runAt ? routineLocalDateTime(goal.runAt) : "" })}>{t("Change scheduled time")}</OutcomeButton>
        <OutcomeButton disabled={busy || (!routine.enabled && (!future || Boolean(routine.validationError)))} onClick={() => void mutate(() => api.setRoutineEnabled(routine, !routine.enabled))}>
          {routine.enabled ? t("Pause") : t("Resume")}
        </OutcomeButton>
        <OutcomeButton className="text-destructive" disabled={busy} onClick={() => setConfirmCancel(routine.revision)}>{t("Cancel scheduled goal")}</OutcomeButton>
      </div>}
      {canEdit && editing && <form onSubmit={reschedule} className="outcome-card space-y-2">
        <label className="block text-sm" htmlFor="scheduled-goal-time">{t("Scheduled time")}</label>
        <input className="outcome-control" id="scheduled-goal-time" type="datetime-local" required value={editing.time} onChange={(event) => setEditing({ ...editing, time: event.target.value })} />
        {!trigger && <p className="text-xs text-muted-foreground">{t("Saving a new time makes this an explicit one-time schedule.")}</p>}
        {editing.revision !== routine.revision && <p role="alert">{t("This routine changed elsewhere. Reopen it to load the latest version.")}</p>}
        <div className="flex gap-2">
          <OutcomeButton type="submit" disabled={busy || editing.revision !== routine.revision}>{t("Save")}</OutcomeButton>
          <OutcomeButton type="button" variant="ghost" onClick={() => setEditing(null)}>{t("Cancel")}</OutcomeButton>
        </div>
      </form>}
      {canEdit && confirmCancel !== null && <div className="outcome-card space-y-2">
        <p>{t("Cancel this scheduled goal and keep its history?")}</p>
        <div className="flex gap-2">
          <OutcomeButton variant="destructive" disabled={busy || confirmCancel !== routine.revision} onClick={() => void mutate(async () => {
            await api.deleteRoutine(routine);
            setConfirmCancel(null);
          })}>{t("Confirm cancellation")}</OutcomeButton>
          <OutcomeButton variant="ghost" onClick={() => setConfirmCancel(null)}>{t("Keep scheduled goal")}</OutcomeButton>
        </div>
      </div>}
      {(canPrepare || advice) && <section aria-label={t("Run advice")} className="outcome-card space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">{t("Run advice")}</h3>
          {canPrepare && !ready && <OutcomeButton disabled={busy || pending} onClick={requestAdvice}>
            {t("Generate run advice")}
          </OutcomeButton>}
        </div>
        <div aria-live="polite" className="text-sm">
          {pending ? <p>{t(advice?.status === "running" ? "Generating advice…" : "Advice queued…")}</p>
            : ready ? <p className="whitespace-pre-wrap break-words">{advice?.result?.summary}</p>
            : advice ? <p>{t("Advice could not be generated.")}</p> : null}
        </div>
      </section>}
      {goal.executions.length > 0 && <section aria-label={t("Run history")} className="space-y-2">
        <h3 className="font-medium">{t("Run history")}</h3>
        <ul className="space-y-2">
          {goal.executions.map((entry) => <li key={entry.id} className="outcome-card text-sm">
            <details>
              <summary>{t(entry.kind === "preparation" ? "Preparation" : entry.kind === "test" ? "Manual run" : "Scheduled run")} · <time dateTime={entry.scheduledFor}>{new Date(entry.scheduledFor).toLocaleString()}</time> · {t(styleForActivity(entry.status).label)}</summary>
              {entry.kind === "scheduled" && entry.result && <p>{t(entry.result.delivered ? "Reminder sent" : "Reminder not yet sent")}</p>}
              {entry.result?.summary && <p className="whitespace-pre-wrap break-words">{entry.result.summary}</p>}
            </details>
          </li>)}
        </ul>
      </section>}
    </article>
  );
}
