import { useEffect, useRef, useState } from "react";
import type { KnowledgeDocument, KnowledgeReference } from "@outcomego/contracts/knowledge";
import type { HumanMaterialClient } from "./human-api";
import { responseCode } from "../inbox/decision-state";
import { useI18n } from "../../../../lib/i18n";

export function KnowledgeReferences({ outcomeId, references, client, onRead }: {
  outcomeId: string; references: KnowledgeReference[]; client: HumanMaterialClient; onRead: (id: string) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeReference[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, [outcomeId]);
  const all = [...new Map([...references, ...results].map(reference => [reference.id, reference])).values()];
  return <section aria-label={t("Knowledge references")} className="space-y-3">
    <h3 className="font-medium">{t("Knowledge references")}</h3>
    <p className="text-sm text-muted-foreground">{t("Sources open only when requested. Source text is not added to your receipt.")}</p>
    <form className="flex gap-2" onSubmit={event => {
      event.preventDefault(); if (busy) return;
      const request = ++generation.current; setBusy(true); setError(null);
      void client.search(outcomeId, query).then(value => { if (request === generation.current) setResults(value); },
        () => { if (request === generation.current) setError("Could not search sources. Try again."); })
        .finally(() => { if (request === generation.current) setBusy(false); });
    }}>
      <label className="flex-1">{t("Search sources")}<input className="mt-1 w-full rounded border bg-background p-2" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button disabled={busy} className="self-end rounded border px-3 py-2">{t(busy ? "Searching…" : "Search")}</button>
    </form>
    {error && <p role="alert">{t(error)}</p>}
    {!all.length && <p>{t("No source references.")}</p>}
    {all.map(reference => <KnowledgeReferenceView key={`${reference.id}:${reference.version}`} reference={reference} outcomeId={outcomeId} client={client} onRead={onRead} />)}
  </section>;
}

function KnowledgeReferenceView({ reference, outcomeId, client, onRead }: {
  reference: KnowledgeReference; outcomeId: string; client: HumanMaterialClient; onRead: (id: string) => void;
}) {
  const { t } = useI18n();
  const [document, setDocument] = useState<KnowledgeDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, [reference.id, outcomeId]);
  const read = async () => {
    const request = ++generation.current; setBusy(true); setError(null);
    try {
      const document = await client.read(outcomeId, reference);
      if (request === generation.current) { setDocument(document); onRead(reference.id); }
    } catch (cause) {
      if (request === generation.current) setError(
        responseCode(cause) === "knowledge_source_stale" ? "This source changed. Refresh the action card or search for its current version." :
          responseCode(cause) === "knowledge_source_forbidden" ? "This source is not available in this Outcome." : "This source could not be read. Retry when available.");
    } finally { if (request === generation.current) setBusy(false); }
  };
  return <details className="rounded border p-3">
    <summary>{reference.title}{reference.stale ? ` · ${t("Stale source")}` : ""}</summary>
    <dl className="my-2 break-all text-sm"><dt>{t("Source")}</dt><dd>{reference.sourceType}: {reference.sourceRef}</dd><dt>{t("Version")}</dt><dd>{reference.version} · {reference.updatedAt}</dd><dt>{t("Scope")}</dt><dd>{reference.projectScope} · {reference.permissionSummary}</dd>{reference.digest && <><dt>{t("Digest")}</dt><dd>{reference.digest}</dd></>}</dl>
    {reference.excerpt && <p className="whitespace-pre-wrap">{reference.excerpt}</p>}
    {reference.stale && <p role="status">{t("This source changed. Refresh the action card or search for its current version.")}</p>}
    <button className="rounded border px-3 py-2" disabled={busy || reference.stale} onClick={() => void read()}>{t(busy ? "Loading source…" : document ? "Read source again" : "Read source")}</button>
    {error && <p role="alert">{t(error)}</p>}
    {document && <div><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm">{document.text}</pre><p className="break-all text-xs">{t("Digest")}: {document.digest}</p><button onClick={() => setDocument(null)}>{t("Close source")}</button></div>}
  </details>;
}
