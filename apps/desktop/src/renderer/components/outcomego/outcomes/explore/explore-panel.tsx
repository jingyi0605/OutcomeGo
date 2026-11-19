import { useEffect, useRef, useState } from "react";
import type { ExploreIdeaPage, ExploreIdeaView } from "@outcomego/contracts/explore";
import type { ExploreClient } from "./explore-api";
import type { OutcomeClient } from "../../../../client/outcome-api";
import { OutcomeRequestIds } from "../planning/outcome-client";
import { responseStatus } from "../inbox/decision-state";
import { useI18n } from "../../../../lib/i18n";
import { toast } from "sonner";
import { ChevronRight, Lightbulb, Plus } from "lucide-react";
import { OutcomeButton, OutcomeEmptyState, OutcomeRefresh } from "../outcome-ui";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import { QuickIdeaForm } from "./quick-idea-form";

const control = "outcome-control";
export function ExplorePanel({
  client,
  outcomes,
  bots,
  onOutcome,
  initialPage,
}: {
  client: ExploreClient;
  outcomes: OutcomeClient;
  bots: OutcomeExecutionBot[];
  onOutcome: (id: string) => void;
  initialPage?: ExploreIdeaPage;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState<ExploreIdeaPage | null>(initialPage ?? null);
  const [selected, setSelected] = useState<ExploreIdeaView | null>(null);
  const [creating, setCreating] = useState(false);
  const [botId, setBotId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const ids = useRef(new OutcomeRequestIds());
  const merge = (idea: ExploreIdeaView) => {
    setSelected(idea);
    setPage((current) =>
      current
        ? { ...current, items: [idea, ...current.items.filter((item) => item.id !== idea.id)] }
        : { items: [idea], nextCursor: null }
    );
  };
  async function load(cursor?: string) {
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await client.list(cursor);
      if (request === generation.current)
        setPage((current) =>
          cursor
            ? {
                items: [
                  ...new Map(
                    [...(current?.items ?? []), ...result.items].map((item) => [item.id, item])
                  ).values(),
                ],
                nextCursor: result.nextCursor,
              }
            : result
        );
    } catch (cause) {
      if (request === generation.current)
        setError(
          responseStatus(cause) === 404
            ? "This server does not support Explore."
            : "Could not load Explore. Try again."
        );
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [client]);
  async function mutate(action: "propose" | "discard") {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const request = ++generation.current;
    try {
      if (selected) {
        const input = action === "propose" ? { botId: botId || selected.botId || undefined } : {};
        const key = `${action}:${selected.id}`;
        if (action === "propose") {
          // The bot plans it in the goal's own thread; the idea's words go to it as they are.
          const create = outcomes.createThread;
          const target = botId || selected.botId;
          if (!create || !target) throw new Error("Choose an execution Bot before proposing delivery.");
          const text = [selected.title, selected.note].filter((part) => part && part.trim()).join("\n\n");
          const created = await create.call(outcomes, {
            text,
            botId: target,
            exploreIdeaId: selected.id,
            clientRequestId: ids.current.for(key, { text, botId: target }),
          });
          ids.current.complete(key);
          if (request !== generation.current) return;
          merge({ ...selected, status: "converted", proposedOutcomeId: created.outcome.id });
          toast.success(t("Handed to the bot. You’ll be told when it replies."));
          onOutcome(created.outcome.id);
        } else {
          const result = await client.discard(selected.id, {
            clientRequestId: ids.current.for(key, input),
          });
          if (request !== generation.current) return;
          merge(result);
        }
        if (action === "discard") ids.current.complete(key);
      }
    } catch (cause) {
      if (request !== generation.current) return;
      setError(
        responseStatus(cause) === 409
            ? "This idea changed or is read-only. Refresh its current state."
            : responseStatus(cause) === 422
              ? "Choose an execution Bot before proposing delivery."
              : "Could not confirm this Explore action. Your input was kept. Retry the same request."
      );
      if (responseStatus(cause) === 409 && selected) {
        try {
          const idea = await client.get(selected.id);
          if (request === generation.current) merge(idea);
        } catch {
          /* The conflict and previous history remain visible. */
        }
      }
    } finally {
      inFlight.current = false;
      if (request === generation.current) setBusy(false);
    }
  }
  const select = async (idea: ExploreIdeaView) => {
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    setSelected(idea);
    setBotId(idea.botId ?? "");
    try {
      const latest = await client.get(idea.id);
      if (request === generation.current) merge(latest);
    } catch {
      if (request === generation.current)
        setError("Could not refresh this idea. Retry before making changes.");
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  return (
    <section aria-label={t("Explore ideas")} aria-busy={busy} className="space-y-4">
      <header className="outcome-toolbar">
        <p className="outcome-toolbar-description">
          {t("A place for ideas before they become goals.")}
        </p>
        <div className="outcome-toolbar-controls">
          {!selected && !creating && (
            <OutcomeButton onClick={() => setCreating(true)}>
              <Plus className="size-3.5" />
              {t("New idea")}
            </OutcomeButton>
          )}
          <OutcomeRefresh busy={busy} onRefresh={() => void load()} />
        </div>
      </header>
      {error && <p role="alert">{t(error)}</p>}
      {(selected || creating) && (
        <button
          disabled={busy}
          className={control}
          onClick={() => {
            setSelected(null);
            setCreating(false);
            void load();
          }}
        >
          {t("Back to ideas")}
        </button>
      )}
      {!selected && !creating && (
        <>
          {!page && busy && <p role="status">{t("Loading ideas…")}</p>}
          {page?.items.length === 0 && (
            <OutcomeEmptyState
              icon={Lightbulb}
              title="No ideas yet."
              description="Save a thought, a question or a possibility. Turn it into a goal when you're ready."
            >
              <OutcomeButton onClick={() => setCreating(true)}>
                <Plus className="size-3.5" />
                {t("Capture an idea")}
              </OutcomeButton>
            </OutcomeEmptyState>
          )}
          <ul className={page?.items.length ? "outcome-rows" : undefined}>
            {page?.items.map((idea) => (
              <li key={idea.id}>
                <button className="outcome-row" onClick={() => void select(idea)}>
                  <span className="outcome-row-icon">
                    <Lightbulb aria-hidden="true" className="size-4" strokeWidth={1.6} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="outcome-row-title">{idea.title}</span>
                    <span className="outcome-row-meta">
                      {t(idea.status)} · {new Date(idea.updatedAt).toLocaleString()}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-3.5 text-foreground-tertiary" />
                </button>
              </li>
            ))}
          </ul>
          {page?.nextCursor && (
            <button className={control} disabled={busy} onClick={() => void load(page.nextCursor!)}>
              {t("Load more")}
            </button>
          )}
        </>
      )}
      {creating && (
        <div className="outcome-form">
          <QuickIdeaForm
            client={client}
            bots={bots}
            onSaved={(idea) => {
              merge(idea);
              setCreating(false);
              setSelected(null);
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}
      {selected && (
        <div className="outcome-form">
          <ExploreIdeaDetails
            idea={selected}
            busy={busy}
            bots={bots}
            botId={botId}
            onBot={setBotId}
            onPropose={() => void mutate("propose")}
            onDiscard={() => void mutate("discard")}
            onOutcome={onOutcome}
          />
        </div>
      )}
    </section>
  );
}
export function ExploreIdeaDetails({
  idea,
  busy,
  bots,
  botId,
  onBot,
  onPropose,
  onDiscard,
  onOutcome,
}: {
  idea: ExploreIdeaView;
  busy: boolean;
  bots: Array<{ id: string; name: string }>;
  botId: string;
  onBot: (id: string) => void;
  onPropose: () => void;
  onDiscard: () => void;
  onOutcome: (id: string) => void;
}) {
  const { t } = useI18n();
  const actionable = ["draft", "exploring", "proposed_for_delivery"].includes(idea.status);
  return (
    <article className="space-y-3">
      <h3 className="font-semibold">{idea.title}</h3>
      <p role="status">{t(idea.status)}</p>
      <p className="whitespace-pre-wrap">{idea.note}</p>
      <p>
        {t("Time budget")}: {idea.budget?.timeLimitMinutes ?? "—"} · {t("Cost budget")}:{" "}
        {idea.budget?.costLimit ?? "—"}
      </p>
      <details>
        <summary>{t("Source references and history")}</summary>
        {idea.sourceReferences.map((reference, index) => (
          <p className="break-all" key={index}>
            {reference.title ?? reference.sourceRef} · {reference.sourceType ?? "—"} ·{" "}
            {reference.version ?? "—"} · {reference.sourceRef}
          </p>
        ))}
        <p className="break-all">
          Idea {idea.id} · {t("Created")}: {idea.createdAt} · {t("Updated")}: {idea.updatedAt}
        </p>
        <p>PlanningDraft {idea.planningDraftId ?? "—"}</p>
        <p>Outcome {idea.proposedOutcomeId ?? "—"}</p>
        {idea.sourceOutcomeId && (
          <button className={control} onClick={() => onOutcome(idea.sourceOutcomeId!)}>
            {t("Open source Outcome")}
          </button>
        )}
      </details>
      {!actionable && (
        <p>
          {t("This idea is read-only. Its notes, sources and conversion history are preserved.")}
        </p>
      )}
      {actionable && (
        <fieldset disabled={busy} className="space-y-3">
          <legend>{t("Propose delivery")}</legend>
          <label>
            {t("Execution Bot")}
            <select
              className={`${control} ml-2`}
              value={botId || idea.botId || ""}
              onChange={(event) => onBot(event.target.value)}
            >
              <option value="">{t("Choose a Bot")}</option>
              {bots.map((bot) => (
                <option value={bot.id} key={bot.id}>
                  {bot.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button className={control} disabled={!botId && !idea.botId} onClick={onPropose}>
              {t("Hand to a bot to plan")}
            </button>
            <button className={control} onClick={onDiscard}>
              {t("Discard idea")}
            </button>
          </div>
        </fieldset>
      )}
      {idea.proposedOutcomeId && (
        <button className={control} onClick={() => onOutcome(idea.proposedOutcomeId!)}>
          {t("Open converted Outcome")}
        </button>
      )}
    </article>
  );
}
