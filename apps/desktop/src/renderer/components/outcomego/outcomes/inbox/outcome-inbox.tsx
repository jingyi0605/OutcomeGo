import { useEffect, useRef, useState } from "react";
import type { OutcomeInboxCategory, OutcomeInboxItemView, OutcomeInboxPage } from "@outcomego/contracts/outcome-inbox";
import type { InboxClient } from "./inbox-api";
import { responseStatus } from "./decision-state";
import { useI18n } from "../../../../lib/i18n";

export const inboxCategoryLabels: Record<OutcomeInboxCategory, string> = {
  decision_pending: "Decisions", acceptance_pending: "Acceptance review", human_action_pending: "Human actions", completed: "Completed",
};
export function mergeInboxItems(previous: OutcomeInboxItemView[], next: OutcomeInboxItemView[]) {
  return [...new Map([...previous, ...next].map(item => [item.id, item])).values()];
}
export function OutcomeInbox({ client, onSelect, refreshVersion = 0, initialPage }: {
  client: InboxClient; onSelect: (item: OutcomeInboxItemView) => void; refreshVersion?: number; initialPage?: OutcomeInboxPage;
}) {
  const { t } = useI18n();
  const [category, setCategory] = useState<OutcomeInboxCategory | "pending">("pending");
  const [page, setPage] = useState<OutcomeInboxPage | null>(initialPage ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const generation = useRef(0);
  async function load(cursor?: string) {
    const request = ++generation.current; setBusy(true); setError(null);
    try {
      const result = await client.list({
        status: category === "completed" ? "completed" : "pending",
        ...(category === "pending" ? {} : { category }),
        ...(cursor ? { cursor } : {}),
      });
      if (request !== generation.current) return;
      setPage(current => cursor ? { items: mergeInboxItems(current?.items ?? [], result.items), nextCursor: result.nextCursor } : result);
      setUnavailable(false);
    } catch (cause) {
      if (request !== generation.current) return;
      if (responseStatus(cause) === 404) { setUnavailable(true); setPage(null); }
      else setError("Could not load the Inbox. Try again.");
    } finally { if (request === generation.current) setBusy(false); }
  }
  useEffect(() => { setPage(null); void load(); return () => { generation.current++; }; }, [client, category, refreshVersion]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 30_000);
    return () => { window.removeEventListener("focus", refresh); window.clearInterval(interval); };
  }, [client, category]);
  return <section aria-label={t("Outcome Inbox")} aria-busy={busy} className="space-y-4">
    <header className="flex justify-between gap-3"><h2 className="text-lg font-semibold">{t("Outcome Inbox")}</h2><button disabled={busy} className="rounded border px-3 py-2" onClick={() => void load()}>{t("Refresh from server")}</button></header>
    <nav aria-label={t("Inbox categories")} className="flex flex-wrap gap-2">
      {(["pending", ...Object.keys(inboxCategoryLabels)] as const).map(value => <button key={value} aria-pressed={category === value} className="rounded border px-3 py-2 text-sm aria-pressed:bg-muted" onClick={() => setCategory(value as typeof category)}>{t(value === "pending" ? "Needs attention" : inboxCategoryLabels[value as OutcomeInboxCategory])}</button>)}
    </nav>
    {busy && !page && <p role="status">{t("Loading Inbox…")}</p>}
    {error && <p role="alert">{t(error)} <button onClick={() => void load()}>{t("Retry")}</button></p>}
    {unavailable && <p role="status">{t("This server does not support the Outcome Inbox.")}</p>}
    {page?.items.length === 0 && <p role="status">{t("No items in this category.")}</p>}
    <ul className="space-y-3">{page?.items.map(item => <li key={item.id}><button className="w-full space-y-2 rounded border p-4 text-left hover:bg-muted/40" onClick={() => onSelect(item)}>
      <span className="block font-medium">{item.title}</span>
      <span className="block text-xs text-muted-foreground">{t(inboxCategoryLabels[item.category] ?? "Outcome")} · {t("Revision")} {item.contractRevision}</span>
      <span className="block"><span className="font-medium">{t("Completed")}: </span>{item.completed}</span>
      <span className="block"><span className="font-medium">{t("Current problem")}: </span>{item.problem || t("No unresolved problem.")}</span>
      <span className="block"><span className="font-medium">{t("Next step")}: </span>{item.next}</span>
    </button></li>)}</ul>
    {page?.nextCursor && <button className="rounded border px-3 py-2" disabled={busy} onClick={() => void load(page.nextCursor!)}>{t("Load more")}</button>}
  </section>;
}
