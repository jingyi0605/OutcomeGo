import { useEffect, useRef, useState } from "react";
import type {
  ActOnOutcomeInput,
  OutcomeDetail as OutcomeDetailView,
  OutcomeKind,
} from "@outcomego/contracts/outcomes";
import { OUTCOME_TERMINAL_STATUSES } from "@outcomego/contracts/outcomes";
import type { OutcomeClient } from "../planning/outcome-client";
import { OutcomeRequestIds, outcomeErrorMessage } from "../planning/outcome-client";
import { useI18n } from "../../../../lib/i18n";
import { MessageFileAttachments } from "../../file-attachment";
import { OutcomeButton } from "../outcome-ui";
import { outcomeStatusLabels } from "../outcome-list";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import { toLocalInput } from "../timeline/schedule-edit";

type ConversionTarget = Exclude<OutcomeKind, "tracked">;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type TodoActionRequest = DistributiveOmit<ActOnOutcomeInput, "expectedRevision" | "clientRequestId">;

const EVOLUTION_TARGETS: Record<OutcomeKind, readonly ConversionTarget[]> = {
  note: ["standard", "todo", "scheduled_once", "explore_idea"],
  todo: ["standard", "scheduled_once", "note"],
  explore_idea: ["standard", "todo", "note"],
  scheduled_once: ["standard", "todo"],
  tracked: ["standard"],
  standard: [],
};

const KIND_LABELS: Record<OutcomeKind, string> = {
  standard: "Goal",
  tracked: "Bot-registered",
  scheduled_once: "Scheduled",
  todo: "To-do",
  explore_idea: "Idea",
  note: "Note",
};

const localToIso = (value: string): string | null => {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

/** Links a split child back to its source note, and lists all child items created from a source note. */
export function OutcomeRelationsPanel({
  outcome,
  onSelectOutcome,
}: {
  outcome: OutcomeDetailView;
  onSelectOutcome?: (outcomeId: string) => void;
}) {
  const { t } = useI18n();
  const hasParent = Boolean(outcome.parentOutcomeId);
  const children = outcome.children ?? [];
  if (!hasParent && children.length === 0) return null;
  return (
    <section aria-label={t("Linked items")} className="outcome-card space-y-2.5">
      <h3 className="font-medium">{t("Linked items")}</h3>
      {hasParent && outcome.parentOutcomeId && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-foreground-secondary">{t("Created from source note")}</span>
          {onSelectOutcome ? (
            <OutcomeButton type="button" variant="ghost" onClick={() => onSelectOutcome(outcome.parentOutcomeId!)}>
              {t("View source note")}
            </OutcomeButton>
          ) : (
            <span className="text-xs text-foreground-secondary">{outcome.parentOutcomeId.slice(0, 8)}</span>
          )}
        </div>
      )}
      {children.length > 0 && (
        <ul className="space-y-1.5" aria-label={t("Split items")}>
          {children.map((child) => (
            <li key={child.id} className="flex items-center justify-between gap-2 rounded-md bg-subtle/60 px-2.5 py-1.5 text-sm">
              <div className="min-w-0 flex-1">
                <span className="mr-1.5 rounded bg-background px-1.5 py-0.5 text-[11px] text-foreground-secondary">
                  {t(KIND_LABELS[child.kind])}
                </span>
                <span className="truncate font-medium">{child.title}</span>
                <span className="ml-2 text-xs text-foreground-secondary">
                  {t(outcomeStatusLabels[child.status])}
                </span>
              </div>
              {onSelectOutcome && (
                <OutcomeButton type="button" variant="ghost" onClick={() => onSelectOutcome(child.id)}>
                  {t("Open")}
                </OutcomeButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Note editor with tags, shared-memory sync toggle, optional calendar schedule, triage retry, and archive/cancel. */
export function NotePanel({
  outcome,
  client,
  busy,
  onSaved,
  onTriageRetried,
}: {
  outcome: Extract<OutcomeDetailView, { kind: "note" }>;
  client: OutcomeClient;
  busy: boolean;
  onSaved: (outcome: OutcomeDetailView) => void;
  onTriageRetried?: () => void;
}) {
  const { t } = useI18n();
  const [description, setDescription] = useState(outcome.description);
  const [tags, setTags] = useState(outcome.tags.join(", "));
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInput(outcome.scheduledAt));
  const [syncToMemory, setSyncToMemory] = useState(outcome.kindMeta.syncToMemory !== false);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useRef(new OutcomeRequestIds());

  useEffect(() => {
    setDescription(outcome.description);
    setTags(outcome.tags.join(", "));
    setScheduledAt(toLocalInput(outcome.scheduledAt));
    setSyncToMemory(outcome.kindMeta.syncToMemory !== false);
  }, [outcome.id, outcome.revision, outcome.description, outcome.tags, outcome.scheduledAt, outcome.kindMeta.syncToMemory]);

  const initialScheduled = toLocalInput(outcome.scheduledAt);
  const dirty =
    description !== outcome.description ||
    tags !== outcome.tags.join(", ") ||
    scheduledAt !== initialScheduled ||
    syncToMemory !== (outcome.kindMeta.syncToMemory !== false);
  const terminal = OUTCOME_TERMINAL_STATUSES.includes(outcome.status);
  const archived = outcome.status === "archived";
  const triageStatus = outcome.kindMeta.triageStatus;

  async function save() {
    if (!dirty || saving) return;
    const nextScheduled = scheduledAt.trim() ? localToIso(scheduledAt) : null;
    if (scheduledAt.trim() && !nextScheduled) {
      setError(t("Choose a valid calendar date and time."));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await client.update(outcome.id, {
        description,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        scheduledAt: nextScheduled,
        syncToMemory,
        expectedRevision: outcome.revision,
        clientRequestId: crypto.randomUUID(),
      });
      onSaved(next);
    } catch (cause) {
      setError(outcomeErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function act(action: "archive" | "unarchive" | "cancel") {
    if (saving || busy) return;
    setSaving(true);
    setError(null);
    try {
      const next = await client.act(outcome.id, {
        action,
        expectedRevision: outcome.revision,
        clientRequestId: crypto.randomUUID(),
      });
      onSaved(next);
    } catch (cause) {
      setError(outcomeErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function retryTriage() {
    if (!client.plan || retrying || busy || saving) return;
    setRetrying(true);
    setError(null);
    const input = { mode: "triage" as const, expectedRevision: outcome.revision };
    const key = `triage:${outcome.id}:${outcome.revision}`;
    try {
      await client.plan(outcome.id, { ...input, clientRequestId: ids.current.for(key, input) });
      ids.current.complete(key);
      onTriageRetried?.();
    } catch (cause) {
      setError(outcomeErrorMessage(cause));
    } finally {
      setRetrying(false);
    }
  }

  return (
    <section aria-label={t("Note")} className="outcome-card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{t("Note")}</h3>
        {!terminal && (
          <div className="flex flex-wrap gap-2">
            <OutcomeButton
              type="button"
              variant="ghost"
              disabled={busy || saving}
              onClick={() => void act(archived ? "unarchive" : "archive")}
            >
              {t(archived ? "Restore note" : "Archive note")}
            </OutcomeButton>
            <OutcomeButton
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={busy || saving}
              onClick={() => void act("cancel")}
            >
              {t("Cancel note")}
            </OutcomeButton>
          </div>
        )}
      </div>

      {triageStatus === "pending" && (
        <p role="status" className="rounded-md bg-subtle/70 px-3 py-2 text-xs text-foreground-secondary">
          {t("Sorting in background…")}
        </p>
      )}
      {triageStatus === "failed" && !terminal && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          <span>{t("Automatic sorting failed. Your note and files are saved — retry or convert it manually below.")}</span>
          {client.plan && (
            <OutcomeButton type="button" variant="secondary" disabled={busy || saving || retrying} onClick={() => void retryTriage()}>
              {t(retrying ? "Retrying…" : "Retry sorting")}
            </OutcomeButton>
          )}
        </div>
      )}

      <label className="block text-sm">
        {t("Note body")}
        <textarea
          className="outcome-control mt-1 min-h-28 w-full"
          value={description}
          disabled={busy || saving || terminal}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        {t("Tags")}
        <input
          className="outcome-control mt-1 w-full"
          value={tags}
          disabled={busy || saving || terminal}
          onChange={(event) => setTags(event.target.value)}
          placeholder={t("Separate tags with commas")}
        />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          {t("Calendar time (optional)")}
          <input
            className="outcome-control mt-1 block"
            type="datetime-local"
            value={scheduledAt}
            disabled={busy || saving || terminal}
            onChange={(event) => setScheduledAt(event.target.value)}
          />
        </label>
        {scheduledAt && !terminal && (
          <OutcomeButton type="button" variant="ghost" disabled={busy || saving} onClick={() => setScheduledAt("")}>
            {t("Clear time")}
          </OutcomeButton>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={syncToMemory}
          disabled={busy || saving || terminal}
          onChange={(event) => setSyncToMemory(event.target.checked)}
        />
        {t("Keep this note in shared memory")}
      </label>
      {outcome.attachments.length > 0 && <MessageFileAttachments attachments={outcome.attachments} />}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {!terminal && (
        <OutcomeButton variant="secondary" disabled={!dirty || saving || busy} onClick={() => void save()}>
          {t(saving ? "Saving…" : "Save note")}
        </OutcomeButton>
      )}
    </section>
  );
}

/** Full to-do lifecycle controls directly inside the unified Outcome detail page. */
export function TodoDetailPanel({
  outcome,
  client,
  bots,
  busy,
  onUpdated,
}: {
  outcome: Extract<OutcomeDetailView, { kind: "todo" }>;
  client: OutcomeClient;
  bots: readonly OutcomeExecutionBot[];
  busy: boolean;
  onUpdated: (outcome: OutcomeDetailView) => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [snoozeAt, setSnoozeAt] = useState("");
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffBotId, setHandoffBotId] = useState(outcome.botId ?? bots[0]?.id ?? "");
  const [handoffInstruction, setHandoffInstruction] = useState(outcome.description || outcome.title);

  const history = outcome.status === "accepted" || outcome.status === "cancelled";
  const suggested = outcome.status === "suggested";

  async function runAction(request: TodoActionRequest) {
    if (saving || busy) return false;
    setSaving(true);
    setError(null);
    try {
      const next = await client.act(outcome.id, {
        ...request,
        expectedRevision: outcome.revision,
        clientRequestId: crypto.randomUUID(),
      } as ActOnOutcomeInput);
      onUpdated(next);
      return true;
    } catch (cause) {
      setError(outcomeErrorMessage(cause));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function snooze() {
    const iso = localToIso(snoozeAt);
    if (!iso || Date.parse(iso) <= Date.now()) {
      setError(t("Choose a future time."));
      return;
    }
    if (await runAction({ action: "snooze", payload: { snoozeUntil: iso } })) setSnoozeAt("");
  }

  async function handoff() {
    if (!handoffBotId || !handoffInstruction.trim()) return;
    if (await runAction({ action: "handoff_to_bot", payload: { botId: handoffBotId, instruction: handoffInstruction.trim() } })) {
      setHandoffOpen(false);
    }
  }

  return (
    <section aria-label={t("To-do actions")} className="outcome-card space-y-3">
      <h3 className="font-medium">{t("To-do")}</h3>
      {outcome.description && <p className="whitespace-pre-wrap break-words text-sm">{outcome.description}</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-secondary">
        {outcome.dueAt && <span>{t("Due")}: {new Date(outcome.dueAt).toLocaleString()}</span>}
        {outcome.scheduledAt && <span>{t("Scheduled")}: {new Date(outcome.scheduledAt).toLocaleString()}</span>}
        {outcome.followUpAt && <span>{t("Follow-up")}: {new Date(outcome.followUpAt).toLocaleString()}</span>}
        {outcome.snoozeUntil && <span>{t("Snoozed until")}: {new Date(outcome.snoozeUntil).toLocaleString()}</span>}
      </div>
      {history ? (
        <div className="flex flex-wrap items-center gap-2">
          <OutcomeButton type="button" variant="secondary" disabled={busy || saving} onClick={() => void runAction({ action: "restore" })}>
            {t("Restore")}
          </OutcomeButton>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {suggested && (
              <OutcomeButton type="button" variant="default" disabled={busy || saving} onClick={() => void runAction({ action: "accept_todo" })}>
                {t("Accept suggestion")}
              </OutcomeButton>
            )}
            {!suggested && (
              <OutcomeButton
                type="button"
                variant="default"
                disabled={busy || saving}
                onClick={() => void runAction({ action: "complete", ...(note.trim() ? { payload: { note: note.trim() } } : {}) })}
              >
                {t("Complete")}
              </OutcomeButton>
            )}
            {!suggested && bots.length > 0 && (
              <OutcomeButton type="button" variant="secondary" disabled={busy || saving} onClick={() => setHandoffOpen((v) => !v)}>
                {t("Hand to the bot")}
              </OutcomeButton>
            )}
            <OutcomeButton type="button" variant="ghost" className="text-destructive" disabled={busy || saving} onClick={() => void runAction({ action: "dismiss" })}>
              {t("Dismiss")}
            </OutcomeButton>
          </div>
          {!suggested && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">
                {t("Completion note")}
                <input
                  className="outcome-control mt-1 block"
                  value={note}
                  disabled={busy || saving}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t("Optional note")}
                />
              </label>
              <label className="text-xs">
                {t("Snooze until")}
                <input
                  className="outcome-control mt-1 block"
                  type="datetime-local"
                  value={snoozeAt}
                  disabled={busy || saving}
                  onChange={(event) => setSnoozeAt(event.target.value)}
                />
              </label>
              <OutcomeButton type="button" variant="secondary" disabled={busy || saving || !snoozeAt} onClick={() => void snooze()}>
                {t("Snooze")}
              </OutcomeButton>
            </div>
          )}
          {handoffOpen && bots.length > 0 && (
            <div className="space-y-2 rounded-md bg-subtle/60 p-3">
              <label className="block text-xs">
                {t("Execution Bot")}
                <select
                  className="outcome-control mt-1 block"
                  value={handoffBotId}
                  disabled={busy || saving}
                  onChange={(event) => setHandoffBotId(event.target.value)}
                >
                  {bots.map((bot) => (
                    <option key={bot.id} value={bot.id}>{bot.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                {t("Instructions for the bot")}
                <textarea
                  className="outcome-control mt-1 block w-full"
                  rows={2}
                  value={handoffInstruction}
                  disabled={busy || saving}
                  onChange={(event) => setHandoffInstruction(event.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <OutcomeButton type="button" variant="default" disabled={busy || saving || !handoffBotId || !handoffInstruction.trim()} onClick={() => void handoff()}>
                  {t("Send to bot")}
                </OutcomeButton>
                <OutcomeButton type="button" variant="ghost" disabled={busy || saving} onClick={() => setHandoffOpen(false)}>
                  {t("Cancel")}
                </OutcomeButton>
              </div>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  );
}

/** In-place Outcome kind evolution / reclassification preserving ID, history, and thread context. */
export function OutcomeEvolutionPanel({
  outcome,
  client,
  bots,
  busy,
  onConverted,
}: {
  outcome: OutcomeDetailView;
  client: OutcomeClient;
  bots: readonly OutcomeExecutionBot[];
  busy: boolean;
  onConverted: (outcome: OutcomeDetailView) => void;
}) {
  const { t } = useI18n();
  const targets = EVOLUTION_TARGETS[outcome.kind];
  const terminal = OUTCOME_TERMINAL_STATUSES.includes(outcome.status);
  const [targetKind, setTargetKind] = useState<ConversionTarget>(targets[0] ?? "standard");
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInput(outcome.scheduledAt));
  const [selectedBot, setSelectedBot] = useState(outcome.botId ?? bots[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (targets.length > 0 && !targets.includes(targetKind)) {
      setTargetKind(targets[0]!);
    }
  }, [outcome.kind, targets, targetKind]);

  useEffect(() => {
    if (!selectedBot && (outcome.botId || bots[0]?.id)) {
      setSelectedBot(outcome.botId ?? bots[0]?.id ?? "");
    }
  }, [outcome.botId, bots, selectedBot]);

  if (terminal || targets.length === 0) return null;

  const needsBot = targetKind === "standard" || targetKind === "scheduled_once";
  const needsSchedule = targetKind === "scheduled_once";

  async function convert() {
    if (saving || (needsBot && !selectedBot) || (needsSchedule && !scheduledAt)) return;
    setSaving(true);
    setError(null);
    try {
      const input = {
        targetKind,
        expectedRevision: outcome.revision,
        ...(selectedBot ? { botId: selectedBot } : {}),
        ...(needsSchedule && scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
        clientRequestId: crypto.randomUUID(),
      };
      onConverted((await client.convert(outcome.id, input)).outcome);
    } catch (cause) {
      setError(outcomeErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label={t("Evolve Outcome")} className="outcome-card space-y-3">
      <h3 className="font-medium">{t("Evolve Outcome")}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          {t("Turn into")}
          <select
            className="outcome-control mt-1 block"
            value={targetKind}
            onChange={(event) => setTargetKind(event.target.value as ConversionTarget)}
            disabled={saving || busy}
          >
            {targets.map((target) => (
              <option key={target} value={target}>
                {t(KIND_LABELS[target])}
              </option>
            ))}
          </select>
        </label>
        {needsBot && (
          <label className="text-sm">
            {t("Execution Bot")}
            <select
              className="outcome-control mt-1 block"
              value={selectedBot}
              onChange={(event) => setSelectedBot(event.target.value)}
              disabled={saving || busy}
            >
              <option value="">{t("Choose a Bot")}</option>
              {bots.map((bot) => (
                <option key={bot.id} value={bot.id}>{bot.name}</option>
              ))}
            </select>
          </label>
        )}
        {needsSchedule && (
          <label className="text-sm">
            {t("Scheduled time")}
            <input
              className="outcome-control mt-1 block"
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              disabled={saving || busy}
            />
          </label>
        )}
        <OutcomeButton
          variant="secondary"
          disabled={saving || busy || (needsBot && !selectedBot) || (needsSchedule && !scheduledAt)}
          onClick={() => void convert()}
        >
          {t("Convert")}
        </OutcomeButton>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
