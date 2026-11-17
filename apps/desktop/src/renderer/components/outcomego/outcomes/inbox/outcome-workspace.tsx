import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../ui/dialog";
import { api } from "../../../../client/outcomego-api";
import type { DesktopOutcomeTarget } from "../../../../lib/outcome-target";
import type { HumanWorkItemView } from "@outcomego/contracts/human-work";
import type { OutcomeInboxItemView } from "@outcomego/contracts/outcome-inbox";
import { OutcomeInbox } from "./outcome-inbox";
import { DecisionCard } from "./decision-card";
import { OutcomeDetail } from "../detail/outcome-detail";
import { HumanAction } from "../human-work/human-action";
import { useI18n } from "../../../../lib/i18n";
import { ExplorePanel } from "../explore/explore-panel";

type Route = { kind: "inbox" } | { kind: "explore" } | { kind: "decision"; id: string } | { kind: "outcome"; id: string; reviewRevision?: number } | { kind: "human"; id: string };
const routeFor = (target: DesktopOutcomeTarget): Route => target.decisionId ? { kind: "decision", id: target.decisionId } :
  target.outcomeId ? { kind: "outcome", id: target.outcomeId } : { kind: "inbox" };
export default function OutcomeWorkspace({ target, onClose, bots }: { target: DesktopOutcomeTarget; onClose: () => void; bots: Array<{ id: string; name: string }> }) {
  const { t } = useI18n();
  const [route, setRoute] = useState<Route>(() => routeFor(target));
  const [version, setVersion] = useState(0);
  useEffect(() => {
    setRoute(routeFor(target));
    // Reading the notification changes only its read marker, never the business state.
    if (target.channelId && target.notificationSequence) void api.markChannelRead(target.channelId, "0", target.notificationSequence).catch(() => undefined);
  }, [target]);
  const select = (item: OutcomeInboxItemView) => {
    setRoute(item.decisionId ? { kind: "decision", id: item.decisionId } : item.category === "human_action_pending" && item.workItemId ? { kind: "human", id: item.workItemId } : { kind: "outcome", id: item.outcomeId, ...(item.category === "acceptance_pending" ? { reviewRevision: item.contractRevision } : {}) });
  };
  const review = (id: string, reviewRevision?: number) => setRoute({ kind: "outcome", id, reviewRevision });
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
      <DialogTitle>{t("Outcome Inbox")}</DialogTitle>
      <DialogDescription>{t("Decide, perform human actions and review evidence from server facts.")}</DialogDescription>
      <nav aria-label={t("Outcome workspace")} className="flex gap-2"><button className="rounded border px-3 py-2" aria-pressed={route.kind === "inbox"} onClick={() => setRoute({ kind: "inbox" })}>{t("Inbox")}</button><button className="rounded border px-3 py-2" aria-pressed={route.kind === "explore"} onClick={() => setRoute({ kind: "explore" })}>{t("Explore")}</button></nav>
      {route.kind !== "inbox" && <button className="mr-auto rounded border px-3 py-2" onClick={() => { setVersion(value => value + 1); setRoute({ kind: "inbox" }); }}>{t("Back to Inbox")}</button>}
      {route.kind === "inbox" && <OutcomeInbox client={api.outcomeInbox} onSelect={select} refreshVersion={version} />}
      {route.kind === "explore" && <ExplorePanel client={api.explore} outcomes={api.outcomes} bots={bots} onOutcome={review} />}
      {route.kind === "decision" && <DecisionCard key={route.id} decisionId={route.id} client={api.outcomeInbox} outcomes={api.outcomes} onOutcome={review} />}
      {route.kind === "human" && <HumanAction key={route.id} workItemId={route.id} client={api.outcomeInbox} materials={api.humanMaterials} upload={async file => {
        const asset = await api.uploadAsset(file, file.name, file.type);
        return { assetRef: `asset:${asset.assetId}` };
      }} onReview={review} />}
      {route.kind === "outcome" && <OutcomeWithActions key={`${route.id}:${route.reviewRevision ?? "current"}`} outcomeId={route.id} reviewRevision={route.reviewRevision} onHuman={id => setRoute({ kind: "human", id })} onDecision={id => setRoute({ kind: "decision", id })} />}
    </DialogContent>
  </Dialog>;
}
function OutcomeWithActions({ outcomeId, reviewRevision, onHuman, onDecision }: { outcomeId: string; reviewRevision?: number; onHuman: (id: string) => void; onDecision: (id: string) => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<HumanWorkItemView[]>([]);
  const [inbox, setInbox] = useState<OutcomeInboxItemView[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([api.outcomeInbox.humanItems(outcomeId), api.outcomeInbox.forOutcome(outcomeId)]).then(([items, page]) => { if (active) { setItems(items); setInbox(page.items); } }, () => { if (active) setError(true); });
    return () => { active = false; };
  }, [outcomeId]);
  return <div className="space-y-4">
    {error && <p role="alert">{t("Some action links could not be loaded. Reopen this Outcome to retry.")}</p>}
    {inbox.filter(item => item.decisionId).map(item => <button className="mr-2 rounded border px-3 py-2" key={item.id} onClick={() => onDecision(item.decisionId!)}>{t("Open Decision")}: {item.title}</button>)}
    {items.map(item => <button className="mr-2 rounded border px-3 py-2" key={item.id} onClick={() => onHuman(item.id)}>{t("Human action")}: {item.title} · {item.status} · {t("Revision")} {item.contractRevision}</button>)}
    <OutcomeDetail outcomeId={outcomeId} client={api.outcomes} reviewRevision={reviewRevision} />
  </div>;
}
