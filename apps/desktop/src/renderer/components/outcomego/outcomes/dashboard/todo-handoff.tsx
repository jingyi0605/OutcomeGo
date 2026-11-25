import { useState } from "react";
import type { TodoItemView } from "@outcomego/contracts/todo";
import type { OutcomeClient } from "../../../../client/outcome-api";
import type { TodoClient } from "../../../../client/todo-api";
import { useI18n } from "../../../../lib/i18n";
import { OutcomeButton } from "../outcome-button";
import { NewOutcomeForm } from "../thread/new-outcome-form";

export interface TodoHandoffActions {
  bots: readonly { id: string; name: string }[];
  client: TodoClient;
  goals: Pick<OutcomeClient, "createThread">;
  change: (write: () => Promise<TodoItemView>) => Promise<boolean>;
  onOpenChannel?: (id: string) => void;
  onSelectOutcome?: (id: string) => void;
}

export function TodoHandoffProgress({ item, actions }: { item: TodoItemView; actions?: TodoHandoffActions }) {
  const { t } = useI18n();
  const progress = item.handoffProgress;
  const channelId = progress?.channelId;
  return <>
    {progress && item.status !== "done" && item.status !== "dismissed" && <div className="text-xs text-foreground-secondary">
      {progress.state === "completed" ? t("Awaiting your confirmation") : t("Handed to bot")}
      {progress.summary && <p className="whitespace-pre-wrap break-words">{progress.summary}</p>}
      {channelId && actions?.onOpenChannel && <OutcomeButton type="button" variant="ghost" onClick={() => actions.onOpenChannel?.(channelId)}>{t("Open bot conversation")}</OutcomeButton>}
    </div>}
    {item.linkedOutcomeId && actions?.onSelectOutcome && <OutcomeButton type="button" variant="ghost" onClick={() => actions.onSelectOutcome?.(item.linkedOutcomeId!)}>{t("Open linked goal")}</OutcomeButton>}
  </>;
}

export function TodoHandoffControls({ item, actions, disabled }: { item: TodoItemView; actions: TodoHandoffActions; disabled: boolean }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"send" | "upgrade" | null>(null);
  const [chosen, setChosen] = useState("");
  const [instruction, setInstruction] = useState(() => t("Please handle this to-do."));
  const [goalId, setGoalId] = useState<string | null>(null);
  const botId = actions.bots.find((bot) => bot.id === (chosen || item.handoffBotId || item.botId))?.id ?? actions.bots[0]?.id;
  const { handoff, linkOutcome } = actions.client;
  async function finishUpgrade(outcomeId: string) {
    if (linkOutcome && await actions.change(() => linkOutcome(item.id, { outcomeId, revision: item.revision }))) {
      setGoalId(null);
      setMode(null);
    }
  }
  return <div className="mt-2 space-y-2">
    {mode !== "send" && handoff && !goalId && <OutcomeButton type="button" disabled={disabled || !botId} onClick={() => setMode("send")}>{t("Hand to the bot")}</OutcomeButton>}
    {mode !== "upgrade" && linkOutcome && actions.goals.createThread && <OutcomeButton type="button" disabled={disabled || !botId} onClick={() => setMode("upgrade")}>{t("Upgrade to goal")}</OutcomeButton>}
    {mode === "send" && handoff && botId && <form className="mt-2 space-y-2" onSubmit={async (event) => {
      event.preventDefault();
      if (!disabled && await actions.change(() => handoff(item.id, { botId, revision: item.revision, instruction: instruction.trim() }))) setMode(null);
    }}>
      <label className="block">{t("Execution Bot")}
        <select className="outcome-control ml-2" value={botId} onChange={(event) => setChosen(event.target.value)} disabled={disabled}>
          {actions.bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
        </select>
      </label>
      <label className="block">{t("Instructions for the bot")}
        <textarea className="outcome-control mt-1 block w-full" value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={4000} disabled={disabled} />
      </label>
      <OutcomeButton type="submit" disabled={disabled || !instruction.trim()}>{t("Send to bot")}</OutcomeButton>
    </form>}
    {mode === "upgrade" && (goalId
      ? <OutcomeButton type="button" disabled={disabled} onClick={() => void finishUpgrade(goalId)}>{t("Link created goal")}</OutcomeButton>
      : <NewOutcomeForm client={actions.goals} bots={[...actions.bots]} initialText={[item.title, item.note].filter(Boolean).join("\n\n")}
        onCreated={(outcome) => { setGoalId(outcome.id); void finishUpgrade(outcome.id); }} />)}
    {mode && !goalId && <OutcomeButton type="button" variant="ghost" disabled={disabled} onClick={() => setMode(null)}>{t("Cancel")}</OutcomeButton>}
  </div>;
}
