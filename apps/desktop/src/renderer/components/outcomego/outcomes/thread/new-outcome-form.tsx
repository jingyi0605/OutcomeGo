import { useRef, useState } from "react";
import { toast } from "sonner";
import type { OutcomeDetail } from "@outcomego/contracts/outcomes";
import type { OutcomeClient } from "../../../../client/outcome-api";
import { useI18n } from "../../../../lib/i18n";
import { OutcomeRequestIds, outcomeErrorMessage } from "../planning/outcome-client";
import { OutcomeButton } from "../outcome-ui";

/**
 * A new goal in the owner's own words. The chosen bot plans it in the goal's thread; this returns at once
 * so the window can close while the bot works.
 */
export function NewOutcomeForm({
  client,
  bots,
  botId: fixedBotId,
  exploreIdeaId,
  initialText = "",
  onCreated,
}: {
  client: OutcomeClient;
  bots: Array<{ id: string; name: string }>;
  /** A fixed bot (for example the one in the open chat); otherwise the owner picks. */
  botId?: string;
  exploreIdeaId?: string;
  initialText?: string;
  onCreated: (outcome: OutcomeDetail) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(initialText);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useRef(new OutcomeRequestIds());
  const botId = fixedBotId ?? (bots.some((bot) => bot.id === chosen) ? chosen : (bots[0]?.id ?? ""));
  const create = client.createThread;
  if (!create) return null;
  async function submit() {
    if (busy || !text.trim() || !botId) return;
    setBusy(true);
    setError(null);
    try {
      const input = { text, botId, ...(exploreIdeaId ? { exploreIdeaId } : {}) };
      const result = await create!.call(client, {
        ...input,
        clientRequestId: ids.current.for("create-thread", input),
      });
      ids.current.complete("create-thread");
      const name = bots.find((bot) => bot.id === botId)?.name ?? "";
      toast.success(t("Handed to {bot}. You’ll be told when it replies.", { bot: name }));
      onCreated(result.outcome);
    } catch (e) {
      setError(outcomeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="outcome-form space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {!fixedBotId && (
        <label className="block text-xs text-foreground-secondary">
          {t("Execution Bot")}
          <select
            aria-label={t("Execution Bot")}
            className="outcome-control mt-2 block w-full max-w-sm"
            value={botId}
            onChange={(event) => setChosen(event.target.value)}
            disabled={bots.length === 0 || busy}
          >
            {bots.length === 0 && <option value="">{t("No Bots available")}</option>}
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        {t("What do you want to get done?")}
        <textarea
          className="outcome-control mt-1 min-h-28 w-full"
          maxLength={8000}
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      {error && <p role="alert">{t(error)}</p>}
      <OutcomeButton variant="default" type="button" onClick={() => void submit()} disabled={busy || !text.trim() || !botId}>
        {t(busy ? "Handing over…" : "Hand to the bot")}
      </OutcomeButton>
    </form>
  );
}
