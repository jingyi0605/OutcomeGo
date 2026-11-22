import { useRef, useState } from "react";
import { ChevronRight, LoaderCircle, MessagesSquare } from "lucide-react";
import { useI18n } from "../../../../lib/i18n";
import { useOutcomeThread } from "../../../../lib/outcome-thread";
import type { OutcomeClient } from "../../../../client/outcome-api";
import { OutcomeRequestIds, outcomeErrorMessage } from "../planning/outcome-client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../ui/dialog";
import { OutcomeButton } from "../outcome-ui";

/**
 * The goal's own thread with its bot: what the owner said, and what the bot answered. Everything the owner
 * writes here reaches the bot unchanged; the bot decides what to do with it.
 */
export function OutcomeThreadPanel({
  outcomeId,
  client,
  closed = false,
  composer = true,
  compact = false,
}: {
  outcomeId: string;
  client: OutcomeClient;
  compact?: boolean;
  /** A finished goal keeps its record but takes no more messages. */
  closed?: boolean;
  /** False while another box on the page already sends to the bot (the approval comment): history only. */
  composer?: boolean;
}) {
  const { t } = useI18n();
  const { view, reload } = useOutcomeThread(outcomeId, client);
  const [text, setText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useRef(new OutcomeRequestIds());
  if (!client.thread || !client.sendThreadMessage) return null;
  const canWrite = composer && !closed;
  // Without a composer an empty thread has nothing to show.
  if (!canWrite && view && view.turns.length === 0 && !error) return null;
  const send = client.sendThreadMessage;
  async function submit() {
    const words = text;
    if (sending || !words.trim()) return;
    setSending(true);
    setError(null);
    try {
      await send.call(client, outcomeId, {
        text: words,
        clientRequestId: ids.current.for(`message:${outcomeId}`, { text: words }),
      });
      ids.current.complete(`message:${outcomeId}`);
      setText("");
      reload();
    } catch (e) {
      setError(outcomeErrorMessage(e));
    } finally {
      setSending(false);
    }
  }
  const purposeLabels: Record<string, string> = {
    plan: t("Plan"),
    owner_message: t("Owner message"),
    replan: t("Replan"),
    review: t("Holistic prereview"),
    review_task: t("Task review"),
  };
  return (
    <section aria-label={t(compact ? "Conversation with the planner" : "Conversation with the bot")} className="space-y-3">
      {compact && (
        <>
          <button type="button" className="outcome-execution-card" aria-haspopup="dialog" onClick={() => setHistoryOpen(true)}>
            <MessagesSquare size={15} aria-hidden="true" />
            <span className="min-w-0 flex-1 text-left">
              <span className="block">{t("Conversation with the planner")}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {view?.turns.at(-1)?.reply ?? view?.turns.at(-1)?.trigger ?? t("View conversation history")}
              </span>
            </span>
            <ChevronRight size={13} aria-hidden="true" />
          </button>
          {view?.turns.some((turn) => turn.status === "queued" || turn.status === "running") && (
            <p role="status" className="text-xs text-muted-foreground">{t("The bot is working on this…")}</p>
          )}
          {historyOpen && (
            <Dialog open onOpenChange={setHistoryOpen}>
              <DialogContent className="outcome-execution-dialog" overlayClassName="outcome-modal-overlay">
                <DialogTitle className="px-5 pt-4">{t("Conversation with the planner")}</DialogTitle>
                <DialogDescription className="sr-only">{t("View conversation history")}</DialogDescription>
                <div className="outcome-execution-scroll">
                  <OutcomeThreadPanel outcomeId={outcomeId} client={client} closed composer={false} />
                </div>
              </DialogContent>
            </Dialog>
          )}
        </>
      )}
      {!compact && view?.turns.map((turn) => (
        <div key={turn.id} className="space-y-1.5" data-turn-status={turn.status}>
          <div className="flex items-center justify-end gap-1.5 text-[11px] text-foreground-secondary">
            <span>{purposeLabels[turn.purpose] ?? turn.purpose}</span>
            {turn.model && (
              <span>
                · {turn.model.providerId}/{turn.model.modelId}
                {turn.model.fallback ? ` (${t("fallback")})` : ""}
              </span>
            )}
          </div>
          <p className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-xl bg-subtle px-3 py-2 text-[13px]">
            {turn.trigger}
          </p>
          {turn.status === "completed" && turn.reply && (
            <p className="max-w-[85%] whitespace-pre-wrap text-[13px]">{turn.reply}</p>
          )}
          {turn.status === "completed" && !turn.reply && (
            <p className="text-xs opacity-70">{t("The bot finished without a message.")}</p>
          )}
          {(turn.status === "queued" || turn.status === "running") && (
            <p role="status" className="text-xs opacity-70">
              {t("The bot is working on this…")}
            </p>
          )}
          {turn.status === "failed" && (
            <p role="alert" className="text-xs">
              {t("The bot couldn’t finish this.")} {turn.error?.message}
            </p>
          )}
        </div>
      ))}
      {!compact && view?.reviewTurns && view.reviewTurns.length > 0 && (
        <div className="space-y-2 border-t border-black/[0.06] pt-3 dark:border-white/[0.07]">
          <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-secondary">
            {t("Reviewer records")}
          </p>
          {view.reviewTurns.map((turn) => (
            <div key={turn.id} className="space-y-1 rounded-lg bg-subtle/60 p-2.5 text-[12px]" data-turn-status={turn.status}>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-foreground-secondary">
                <span className="font-medium text-foreground">{purposeLabels[turn.purpose] ?? turn.purpose}</span>
                <span>· {t(turn.status)}</span>
                {turn.workItemId && <span>· {turn.workItemId.slice(0, 8)}</span>}
                {turn.model && (
                  <span>
                    · {turn.model.providerId}/{turn.model.modelId}
                    {turn.model.fallback ? ` (${t("fallback")})` : ""}
                  </span>
                )}
              </div>
              {turn.reply && <p className="whitespace-pre-wrap">{turn.reply}</p>}
              {turn.status === "failed" && (
                <p role="alert" className="text-xs text-destructive">
                  {turn.purpose === "review"
                    ? t("Preliminary review failed.")
                    : t("Task review failed (passed as unreviewed).")}{" "}
                  {turn.error?.message}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {!compact && canWrite && view && view.turns.length === 0 && (
        <p className="text-xs opacity-70">{t("Nothing yet. Tell the bot what you want to change or ask.")}</p>
      )}
      {error && <p role="alert">{t(error)}</p>}
      {canWrite && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <textarea
            aria-label={t("Message to the bot")}
            className="outcome-control w-full"
            placeholder={t("Tell the bot what you want, change or ask…")}
            rows={2}
            maxLength={8000}
            value={text}
            disabled={sending}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <OutcomeButton variant="default" type="button" onClick={() => void submit()} disabled={sending || !text.trim()}>
            {t(sending ? "Sending…" : "Send to bot")}
          </OutcomeButton>
        </form>
      )}
    </section>
  );
}

/**
 * Compact entry on the goal page, like the execution messages: the conversation itself opens in a dialog,
 * so the page stays short. Nothing to open (no turns and nowhere to write) shows no entry at all.
 */
export function OutcomeThreadEntry({
  outcomeId,
  client,
  closed = false,
  composer = true,
}: {
  outcomeId: string;
  client: OutcomeClient;
  closed?: boolean;
  composer?: boolean;
}) {
  const { t } = useI18n();
  const { view } = useOutcomeThread(outcomeId, client);
  const [open, setOpen] = useState(false);
  if (!client.thread || !client.sendThreadMessage) return null;
  const turns = view?.turns ?? [];
  const reviewTurns = view?.reviewTurns ?? [];
  const canWrite = composer && !closed;
  if (!open && turns.length === 0 && reviewTurns.length === 0 && !canWrite) return null;
  const working =
    turns.some((turn) => turn.status === "queued" || turn.status === "running") ||
    reviewTurns.some((turn) => turn.status === "queued" || turn.status === "running");
  return (
    <>
      <button type="button" className="outcome-execution-card" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <MessagesSquare size={15} aria-hidden="true" />
        <span>{t("Conversation with the bot")}</span>
        {working && (
          <span className="outcome-execution-readonly" role="status">
            <LoaderCircle size={12} className="inline animate-spin" aria-hidden="true" /> {t("The bot is working on this…")}
          </span>
        )}
        <ChevronRight size={13} className="outcome-execution-chevron" aria-hidden="true" />
      </button>
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="outcome-execution-dialog" overlayClassName="outcome-modal-overlay">
            <DialogTitle>{t("Conversation with the bot")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("What you said to the bot about this goal, and what it answered.")}
            </DialogDescription>
            <div className="outcome-execution-scroll">
              <OutcomeThreadPanel outcomeId={outcomeId} client={client} closed={closed} composer={composer} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
