import { useRef, useState } from "react";
import type { HumanActionCardView, HumanReceiptView } from "@outcomego/contracts/human-work";
import type { HumanMaterialClient } from "./human-api";
import { OutcomeRequestIds } from "../planning/outcome-client";
import { responseCode, responseStatus } from "../inbox/decision-state";
import { receiptObservations, uploadReceiptAssets, type ReceiptAsset } from "./receipt-state";
import { useI18n } from "../../../../lib/i18n";

export function ReceiptForm({ card, client, upload, summary, onSummary, onSubmitted, onConflict }: {
  card: HumanActionCardView; client: HumanMaterialClient;
  upload: (file: File) => Promise<{ assetRef: string }>;
  summary: string; onSummary: (value: string) => void;
  onSubmitted: (receipt: HumanReceiptView) => void; onConflict: () => void;
}) {
  const { t } = useI18n();
  const [comment, setComment] = useState("");
  const [external, setExternal] = useState("");
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [observations, setObservations] = useState<Record<string, string>>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [assets, setAssets] = useState<ReceiptAsset[]>([]);
  const [phase, setPhase] = useState<"editing" | "uploading" | "submitting" | "error">("editing");
  const [error, setError] = useState<string | null>(null);
  const ids = useRef(new OutcomeRequestIds());
  const inFlight = useRef(false);
  const busy = phase === "uploading" || phase === "submitting";
  const editable = card.status === "in_progress";
  async function submit() {
    if (inFlight.current || !editable) return;
    inFlight.current = true; setError(null); setPhase("uploading");
    try {
      const assetRefs = await uploadReceiptAssets(assets, upload, (key, changes) => setAssets(current => current.map(asset => asset.key === key ? { ...asset, ...changes } : asset)));
      const text = [summary, ...card.inputFields.filter(field => inputs[field.id]?.trim()).map(field => `${field.label}: ${inputs[field.id]}`)].filter(Boolean).join("\n");
      const input = {
        expectedContractRevision: card.contractRevision, text, comment, assetRefs,
        sourceRefs: [
          ...referenceIds.map(ref => ({ type: "knowledge" as const, ref })),
          ...external.split("\n").filter(ref => ref.trim()).map(ref => ({ type: "external" as const, ref: ref.trim() })),
        ],
        observations: receiptObservations(observations),
      };
      setPhase("submitting");
      const receipt = await client.receipt(card.workItemId, { ...input, clientRequestId: ids.current.for("receipt", input) });
      ids.current.complete("receipt"); setPhase("editing"); onSubmitted(receipt);
    } catch (cause) {
      setPhase("error");
      const code = responseCode(cause);
      setError(code === "review_revision_conflict" ? "The Contract revision changed. Your materials were kept. Refresh before continuing." :
        code === "receipt_asset_not_found" || code === "receipt_asset_conflict" ? "An uploaded asset is unavailable or already used by another task. Replace it and retry." :
          code === "human_evidence_missing" ? "Required materials are missing. Add the requested evidence and retry." :
            responseStatus(cause) === 409 ? "The action changed. Your materials were kept. Refresh before continuing." :
              "Submission failed. Your text and uploaded assets were kept. Retry the same request.");
      if (responseStatus(cause) === 409) onConflict();
    } finally { inFlight.current = false; }
  }
  return <section aria-label={t("Execution receipt")} aria-busy={busy} className="space-y-3">
    <h3 className="font-medium">{t("Execution receipt")}</h3>
    <p>{t("Submit actual results. A receipt waits for acceptance review and does not complete the task automatically.")}</p>
    {!editable && <p role="status">{t("Start or resume this action before submitting a receipt.")}</p>}
    {error && <p role="alert">{t(error)}</p>}
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={busy || !editable} className="space-y-3">
        <legend className="sr-only">{t("Receipt materials")}</legend>
        <label className="block">{t("Execution summary")}<textarea className="mt-1 min-h-24 w-full rounded border bg-background p-2" value={summary} maxLength={10000} onChange={event => onSummary(event.target.value)} /></label>
        {card.inputFields.map(field => <label key={field.id} className="block">{field.label}{field.required && " *"}
          {field.type === "boolean" ? <select className="m-2 rounded border bg-background p-2" required={field.required} value={inputs[field.id] ?? ""} onChange={event => setInputs(current => ({ ...current, [field.id]: event.target.value }))}><option value="">{t("Choose")}</option><option value="true">{t("Yes")}</option><option value="false">{t("No")}</option></select> :
            field.type === "asset" ? <span className="block text-sm">{t("Attach the requested file below.")}</span> :
              <input type={field.type === "number" ? "number" : "text"} step={field.type === "number" ? "any" : undefined} className="mt-1 w-full rounded border bg-background p-2" required={field.required} maxLength={2000} value={inputs[field.id] ?? ""} onChange={event => setInputs(current => ({ ...current, [field.id]: event.target.value }))} />}
        </label>)}
        {[...new Map(card.evidenceRequirements.map(requirement => [requirement.criterionId, requirement])).values()].map(requirement => <label key={requirement.criterionId} className="block">{t("Observation")}: {requirement.label}<textarea className="mt-1 w-full rounded border bg-background p-2" maxLength={4000} value={observations[requirement.criterionId] ?? ""} onChange={event => setObservations(current => ({ ...current, [requirement.criterionId]: event.target.value }))} /></label>)}
        <label className="block">{t("Files, photos or logs")}<input className="mt-1 block" type="file" multiple onChange={event => {
          const files = [...(event.target.files ?? [])];
          setAssets(current => [...current, ...files.map(file => ({ key: crypto.randomUUID(), file, status: "pending" as const }))].slice(0, 20));
          event.target.value = "";
        }} /></label>
        {assets.map(asset => <div key={asset.key} className="flex flex-wrap items-center gap-2 rounded border p-2"><span>{asset.file.name} · {t(asset.status)}</span>{asset.assetRef && <span className="break-all text-xs">{asset.assetRef}</span>}<button type="button" className="rounded border px-2 py-1" onClick={() => setAssets(current => current.filter(item => item.key !== asset.key))}>{t("Remove")}</button></div>)}
        <fieldset><legend>{t("Reference sources to include")}</legend>{card.references.map(reference => <label key={reference.id} className="block"><input type="checkbox" checked={referenceIds.includes(reference.id)} disabled={reference.stale} onChange={event => setReferenceIds(current => event.target.checked ? [...current, reference.id] : current.filter(id => id !== reference.id))} /> {reference.title} · {reference.version}</label>)}</fieldset>
        <label className="block">{t("External records (one per line)")}<textarea className="mt-1 w-full rounded border bg-background p-2" value={external} maxLength={12000} onChange={event => setExternal(event.target.value)} /></label>
        <p className="text-sm">{t("External records remain unverified until reviewed.")}</p>
        <label className="block">{t("Receipt comment")}<textarea className="mt-1 w-full rounded border bg-background p-2" value={comment} maxLength={4000} onChange={event => setComment(event.target.value)} /></label>
        <button className="rounded border px-3 py-2" type="submit">{t(phase === "uploading" ? "Uploading materials…" : phase === "submitting" ? "Submitting receipt…" : phase === "error" ? "Retry receipt submission" : "Submit receipt")}</button>
      </fieldset>
    </form>
  </section>;
}
