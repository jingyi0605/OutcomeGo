import { useEffect, useRef, useState } from "react";
import type { ExploreIdeaPage, ExploreIdeaView, ExploreProposal } from "@outcomego/contracts/explore";
import type { ExploreClient } from "./explore-api";
import type { OutcomeClient } from "../../../../client/outcome-api";
import { PlanningWizard } from "../planning/planning-wizard";
import { OutcomeRequestIds } from "../planning/outcome-client";
import { responseStatus } from "../inbox/decision-state";
import { useI18n } from "../../../../lib/i18n";
import { isExplorePlanningFailure, proposeExploreIdea } from "./explore-state";

const control = "rounded border bg-background px-3 py-2";
export function ExplorePanel({ client, outcomes, bots, onOutcome, initialPage }: {
  client: ExploreClient; outcomes: OutcomeClient; bots: Array<{ id: string; name: string }>;
  onOutcome: (id: string) => void; initialPage?: ExploreIdeaPage;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState<ExploreIdeaPage | null>(initialPage ?? null);
  const [selected, setSelected] = useState<ExploreIdeaView | null>(null);
  const [proposal, setProposal] = useState<ExploreProposal | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [references, setReferences] = useState("");
  const [sourceOutcomeId, setSourceOutcomeId] = useState("");
  const [botId, setBotId] = useState("");
  const [time, setTime] = useState("");
  const [cost, setCost] = useState("");
  const [status, setStatus] = useState<"draft" | "exploring">("draft");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const ids = useRef(new OutcomeRequestIds());
  const budget = !time && !cost ? null : { timeLimitMinutes: time ? Number(time) : null, costLimit: cost ? Number(cost) : null };
  const validBudget = (!time || Number.isInteger(Number(time)) && Number(time) > 0) && (!cost || Number.isFinite(Number(cost)) && Number(cost) > 0);
  const merge = (idea: ExploreIdeaView) => {
    setSelected(idea);
    setPage(current => current ? { ...current, items: [idea, ...current.items.filter(item => item.id !== idea.id)] } : { items: [idea], nextCursor: null });
  };
  async function load(cursor?: string) {
    const request = ++generation.current; setBusy(true); setError(null);
    try {
      const result = await client.list(cursor);
      if (request === generation.current) setPage(current => cursor ? { items: [...new Map([...(current?.items ?? []), ...result.items].map(item => [item.id, item])).values()], nextCursor: result.nextCursor } : result);
    } catch (cause) {
      if (request === generation.current) setError(responseStatus(cause) === 404 ? "This server does not support Explore." : "Could not load Explore. Try again.");
    } finally { if (request === generation.current) setBusy(false); }
  }
  useEffect(() => { void load(); return () => { generation.current++; }; }, [client]);
  async function mutate(action: "create" | "propose" | "discard") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); const request = ++generation.current;
    try {
      if (action === "create") {
        const input = {
          title, note, botId: botId || null, sourceOutcomeId: sourceOutcomeId || null,
          sourceReferences: references.split("\n").map(sourceRef => sourceRef.trim()).filter(Boolean).map(sourceRef => ({ sourceRef })),
          budget, status,
        };
        const idea = await client.create({ ...input, clientRequestId: ids.current.for("create", input) });
        if (request !== generation.current) return;
        ids.current.complete("create"); merge(idea); setCreating(false);
      } else if (selected) {
        const input = action === "propose" ? { botId: botId || selected.botId || undefined } : {};
        const key = `${action}:${selected.id}`;
        if (action === "propose") {
          const result = await proposeExploreIdea(client, ids.current, selected.id, input);
          if (request !== generation.current) return;
          merge(result.idea); setProposal(result);
        } else {
          const result = await client.discard(selected.id, { clientRequestId: ids.current.for(key, input) });
          if (request !== generation.current) return;
          merge(result); setProposal(null);
        }
        if (action === "discard") ids.current.complete(key);
      }
    } catch (cause) {
      if (request !== generation.current) return;
      setError(action === "propose" && isExplorePlanningFailure(cause) ? "Planning generation failed. Your idea was kept. Retry to generate a new planning draft." :
        responseStatus(cause) === 409 ? "This idea changed or is read-only. Refresh its current state." :
        responseStatus(cause) === 422 ? "Choose an execution Bot before proposing delivery." : "Could not confirm this Explore action. Your input was kept. Retry the same request.");
      if (responseStatus(cause) === 409 && selected) {
        try { const idea = await client.get(selected.id); if (request === generation.current) merge(idea); } catch { /* The conflict and previous history remain visible. */ }
      }
    } finally { inFlight.current = false; if (request === generation.current) setBusy(false); }
  }
  const select = async (idea: ExploreIdeaView) => {
    const request = ++generation.current; setBusy(true); setError(null); setSelected(idea); setProposal(null); setBotId(idea.botId ?? "");
    try { const latest = await client.get(idea.id); if (request === generation.current) merge(latest); }
    catch { if (request === generation.current) setError("Could not refresh this idea. Retry before making changes."); }
    finally { if (request === generation.current) setBusy(false); }
  };
  if (proposal) return <section aria-label={t("Explore delivery proposal")} className="space-y-4">
    <h2 className="font-semibold">{proposal.idea.title}</h2>
    <p>{t("This proposal is a planning draft. Confirm goals, acceptance and boundaries before approving a new Outcome.")}</p>
    <button className={control} onClick={() => { setProposal(null); void select(proposal.idea); }}>{t("Back to idea")}</button>
    <PlanningWizard key={proposal.plan.planId} botId={proposal.plan.botId} client={outcomes} initialPlan={proposal.plan} initialBudget={proposal.idea.budget} onDone={outcome => onOutcome(outcome.id)} onSaved={value => {
      if (value.outcomeId) merge({ ...proposal.idea, status: "converted", proposedOutcomeId: value.outcomeId });
    }} />
  </section>;
  return <section aria-label={t("Explore ideas")} aria-busy={busy} className="space-y-4">
    <header className="flex justify-between gap-3"><h2 className="text-lg font-semibold">{t("Explore ideas")}</h2><button disabled={busy} className={control} onClick={() => void load()}>{t("Refresh from server")}</button></header>
    <p>{t("Capture ideas without expanding approved work. Proposing delivery creates a separate planning draft.")}</p>
    {error && <p role="alert">{t(error)}</p>}
    {(selected || creating) && <button disabled={busy} className={control} onClick={() => { setSelected(null); setCreating(false); void load(); }}>{t("Back to ideas")}</button>}
    {!selected && !creating && <>
      <button className={control} onClick={() => setCreating(true)}>{t("New idea")}</button>
      {!page && busy && <p role="status">{t("Loading ideas…")}</p>}
      {page?.items.length === 0 && <p>{t("No ideas yet.")}</p>}
      <ul className="space-y-2">{page?.items.map(idea => <li key={idea.id}><button className={`${control} w-full text-left`} onClick={() => void select(idea)}><span className="block font-medium">{idea.title}</span><span>{t(idea.status)} · {idea.updatedAt}</span></button></li>)}</ul>
      {page?.nextCursor && <button className={control} disabled={busy} onClick={() => void load(page.nextCursor!)}>{t("Load more")}</button>}
    </>}
    {creating && <form onSubmit={event => { event.preventDefault(); void mutate("create"); }}><fieldset disabled={busy} className="space-y-3">
      <legend>{t("Capture a new idea")}</legend>
      <label className="block">{t("Title")}<input required className={`${control} mt-1 w-full`} value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label>
      <label className="block">{t("Notes")}<textarea className={`${control} mt-1 w-full`} maxLength={8000} value={note} onChange={event => setNote(event.target.value)} /></label>
      <label className="block">{t("Source references (one per line)")}<textarea className={`${control} mt-1 w-full`} maxLength={12000} value={references} onChange={event => setReferences(event.target.value)} /></label>
      <label className="block">{t("Source Outcome ID (optional)")}<input className={`${control} mt-1 w-full`} pattern="[0-9a-fA-F-]{36}" value={sourceOutcomeId} onChange={event => setSourceOutcomeId(event.target.value)} /></label>
      <label className="block">{t("Execution Bot (optional)")}<select className={`${control} ml-2`} value={botId} onChange={event => setBotId(event.target.value)}><option value="">{t("Choose later")}</option>{bots.map(bot => <option value={bot.id} key={bot.id}>{bot.name}</option>)}</select></label>
      <label className="block">{t("Time limit in minutes (optional)")}<input className={`${control} ml-2`} type="number" min={1} step={1} value={time} onChange={event => setTime(event.target.value)} /></label>
      <label className="block">{t("Cost limit (optional)")}<input className={`${control} ml-2`} type="number" min={0.01} step="any" value={cost} onChange={event => setCost(event.target.value)} /></label>
      <label className="block">{t("Status")}<select className={`${control} ml-2`} value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="draft">{t("Draft")}</option><option value="exploring">{t("Exploring")}</option></select></label>
      <button className={control} disabled={!title.trim() || !validBudget}>{t("Save idea")}</button>
    </fieldset></form>}
    {selected && <ExploreIdeaDetails idea={selected} busy={busy} bots={bots} botId={botId} onBot={setBotId} onPropose={() => void mutate("propose")} onDiscard={() => void mutate("discard")} onOutcome={onOutcome} />}
  </section>;
}
export function ExploreIdeaDetails({ idea, busy, bots, botId, onBot, onPropose, onDiscard, onOutcome }: {
  idea: ExploreIdeaView; busy: boolean; bots: Array<{ id: string; name: string }>; botId: string;
  onBot: (id: string) => void; onPropose: () => void; onDiscard: () => void; onOutcome: (id: string) => void;
}) {
  const { t } = useI18n();
  const actionable = ["draft", "exploring", "proposed_for_delivery"].includes(idea.status);
  return <article className="space-y-3">
    <h3 className="font-semibold">{idea.title}</h3><p role="status">{t(idea.status)}</p>
    <p className="whitespace-pre-wrap">{idea.note}</p>
    <p>{t("Time budget")}: {idea.budget?.timeLimitMinutes ?? "—"} · {t("Cost budget")}: {idea.budget?.costLimit ?? "—"}</p>
    <details><summary>{t("Source references and history")}</summary>{idea.sourceReferences.map((reference, index) => <p className="break-all" key={index}>{reference.title ?? reference.sourceRef} · {reference.sourceType ?? "—"} · {reference.version ?? "—"} · {reference.sourceRef}</p>)}
      <p className="break-all">Idea {idea.id} · {t("Created")}: {idea.createdAt} · {t("Updated")}: {idea.updatedAt}</p>
      <p>PlanningDraft {idea.planningDraftId ?? "—"}</p><p>Outcome {idea.proposedOutcomeId ?? "—"}</p>
      {idea.sourceOutcomeId && <button className={control} onClick={() => onOutcome(idea.sourceOutcomeId!)}>{t("Open source Outcome")}</button>}
    </details>
    {!actionable && <p>{t("This idea is read-only. Its notes, sources and conversion history are preserved.")}</p>}
    {actionable && <fieldset disabled={busy} className="space-y-3"><legend>{t("Propose delivery")}</legend>
      <label>{t("Execution Bot")}<select className={`${control} ml-2`} value={botId || idea.botId || ""} onChange={event => onBot(event.target.value)}><option value="">{t("Choose a Bot")}</option>{bots.map(bot => <option value={bot.id} key={bot.id}>{bot.name}</option>)}</select></label>
      <div className="flex gap-2"><button className={control} disabled={!botId && !idea.botId} onClick={onPropose}>{t(idea.planningDraftId ? "Continue planning draft" : "Propose delivery")}</button><button className={control} onClick={onDiscard}>{t("Discard idea")}</button></div>
    </fieldset>}
    {idea.proposedOutcomeId && <button className={control} onClick={() => onOutcome(idea.proposedOutcomeId!)}>{t("Open converted Outcome")}</button>}
  </article>;
}
