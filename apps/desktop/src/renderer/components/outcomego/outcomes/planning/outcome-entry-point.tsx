import { useEffect, useRef, useState } from "react";
import type {
  OutcomeDetail as OutcomeDetailView,
  OutcomeListPage,
  PlanningDraftView,
} from "@outcomego/contracts/outcomes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../../ui/dialog";
import { api } from "../../../../client/outcomego-api";
import { OutcomeDetail } from "../detail/outcome-detail";
import { PlanningWizard } from "./planning-wizard";
import { outcomeErrorMessage } from "./outcome-client";

type SavedOutcome = { planId?: string; outcomeId?: string };
export default function OutcomeEntryPoint({ botId }: { botId: string }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<OutcomeListPage | null>(null);
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<PlanningDraftView | undefined>();
  const [selected, setSelected] = useState<string | null>(null);
  const [initialOutcome, setInitialOutcome] = useState<OutcomeDetailView | undefined>();
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const storageKey = ["outcome", "planning", botId].join(":");
  const remember = (value: SavedOutcome) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* Storage can be unavailable; server drafts remain readable. */
    }
  };
  useEffect(() => {
    if (!open) return;
    const generation = ++request.current;
    setError(null);
    void api.outcomes.list().then(
      (result) => {
        if (generation === request.current) setPage(result);
      },
      (e) => {
        if (generation === request.current) setError(outcomeErrorMessage(e));
      }
    );
    let saved: SavedOutcome = {};
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    } catch {
      /* Ignore malformed local navigation state. */
    }
    if (saved.outcomeId) setSelected(saved.outcomeId);
    else if (saved.planId)
      void api.outcomes.getPlan(saved.planId).then(
        (result) => {
          if (generation !== request.current) return;
          if (result.status === "ready") {
            setPlan(result);
            setPlanning(true);
          }
        },
        () => undefined
      );
    return () => {
      request.current++;
    };
  }, [open, storageKey]);
  const back = () => {
    setSelected(null);
    setPlanning(false);
    setPlan(undefined);
    setInitialOutcome(undefined);
    void api.outcomes.list().then(setPage, (e) => setError(outcomeErrorMessage(e)));
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="absolute right-3 top-2 z-10 rounded-md border bg-background/90 px-3 py-1 text-xs">
          Outcomes
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogTitle>Outcomes</DialogTitle>
        <DialogDescription>
          Plan, approve and review work in a separate Outcome thread.
        </DialogDescription>
        {(selected || planning) && (
          <button className="mr-auto rounded border px-3 py-1 text-sm" onClick={back}>
            Back to Outcomes
          </button>
        )}
        {error && <p role="alert">{error}</p>}
        {selected ? (
          <OutcomeDetail
            key={selected}
            outcomeId={selected}
            client={api.outcomes}
            initialOutcome={initialOutcome}
          />
        ) : planning ? (
          <PlanningWizard
            key={plan?.planId ?? "new"}
            botId={botId}
            client={api.outcomes}
            initialPlan={plan}
            onSaved={remember}
            onDone={(outcome) => {
              setInitialOutcome(outcome);
              setSelected(outcome.id);
              remember({ outcomeId: outcome.id });
            }}
          />
        ) : (
          <>
            <button
              className="mr-auto rounded border px-3 py-2"
              onClick={() => {
                setPlanning(true);
                setPlan(undefined);
                try {
                  localStorage.removeItem(storageKey);
                } catch {
                  /* Optional navigation state. */
                }
              }}
            >
              New Outcome
            </button>
            {page?.items.map((outcome) => (
              <button
                key={outcome.id}
                className="rounded border p-3 text-left"
                onClick={() => {
                  setSelected(outcome.id);
                  remember({ outcomeId: outcome.id });
                }}
              >
                <span className="block font-medium">{outcome.title}</span>
                <span className="text-xs text-muted-foreground">
                  {outcome.status} · revision {outcome.currentRevision ?? "—"} ·{" "}
                  {new Date(outcome.updatedAt).toLocaleString()}
                </span>
              </button>
            ))}
            {page?.items.length === 0 && <p>No Outcomes yet.</p>}
            {page?.nextCursor && (
              <button
                className="rounded border px-3 py-2"
                onClick={() =>
                  void api.outcomes.list(`cursor=${encodeURIComponent(page.nextCursor!)}`).then(
                    (next) =>
                      setPage((current) => ({
                        items: [...(current?.items ?? []), ...next.items],
                        nextCursor: next.nextCursor,
                      })),
                    (e) => setError(outcomeErrorMessage(e))
                  )
                }
              >
                Load more Outcomes
              </button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
