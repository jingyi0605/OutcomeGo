import { useEffect, useRef, useState } from "react";
import type { HumanWorkItemDetail } from "@outcomego/contracts/human-work";
import type { InboxClient } from "../inbox/inbox-api";
import type { HumanMaterialClient } from "./human-api";
import { KnowledgeReferences } from "./knowledge-references";
import { ReceiptForm } from "./receipt-form";
import { OutcomeRequestIds } from "../planning/outcome-client";
import { responseStatus } from "../inbox/decision-state";
import { useI18n } from "../../../../lib/i18n";
import { OutcomeAsset } from "../outcome-asset";

export function HumanAction({
  workItemId,
  client,
  materials,
  upload,
  onReview,
  initialItem,
}: {
  workItemId: string;
  client: InboxClient;
  materials: HumanMaterialClient;
  upload: (file: File) => Promise<{ assetRef: string }>;
  onReview: (outcomeId: string, revision: number) => void;
  initialItem?: HumanWorkItemDetail;
}) {
  const { t } = useI18n();
  const [item, setItem] = useState<HumanWorkItemDetail | null>(initialItem ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState(initialItem?.card?.draft?.draftSummary ?? "");
  const [currentStep, setCurrentStep] = useState<string | null>(
    initialItem?.card?.draft?.currentStepId ?? null
  );
  const [readRefs, setReadRefs] = useState<string[]>(
    initialItem?.card?.draft?.readReferenceIds ?? []
  );
  const [pauseReason, setPauseReason] = useState(initialItem?.card?.draft?.reason ?? "");
  const generation = useRef(0);
  const ids = useRef(new OutcomeRequestIds());
  const mutation = useRef(false);
  async function refresh(restore = false) {
    if (mutation.current) return;
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await client.humanItem(workItemId);
      if (generation.current !== request) return;
      setItem(result);
      if (restore) {
        setSummary(result.card?.draft?.draftSummary ?? "");
        setCurrentStep(result.card?.draft?.currentStepId ?? null);
        setReadRefs(result.card?.draft?.readReferenceIds ?? []);
        setPauseReason(result.card?.draft?.reason ?? "");
      }
    } catch {
      if (generation.current === request) setError("Could not load the action card. Try again.");
    } finally {
      if (generation.current === request) setBusy(false);
    }
  }
  useEffect(() => {
    void refresh(true);
    const reconnect = () => {
      void refresh();
    };
    window.addEventListener("online", reconnect);
    return () => {
      generation.current++;
      window.removeEventListener("online", reconnect);
    };
  }, [client, workItemId]);
  async function mutate(action: "start" | "pause") {
    if (!item?.card || mutation.current) return;
    mutation.current = true;
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    const input = { expectedContractRevision: item.card.contractRevision };
    const pause = {
      ...input,
      currentStepId: currentStep,
      draftSummary: summary.slice(0, 2000),
      readReferenceIds: readRefs,
      reason: pauseReason,
    };
    const content = action === "pause" ? pause : input;
    try {
      const clientRequestId = ids.current.for(action, content);
      const result =
        action === "start"
          ? await client.startHuman(workItemId, { ...input, clientRequestId })
          : await client.pauseHuman(workItemId, { ...pause, clientRequestId });
      if (generation.current !== request) return;
      ids.current.complete(action);
      setItem(result);
    } catch (cause) {
      if (generation.current !== request) return;
      setError(
        responseStatus(cause) === 409
          ? "The action changed. Your materials were kept. Refresh before continuing."
          : "The action could not be confirmed. Retry the same request."
      );
      if (responseStatus(cause) === 409) {
        try {
          const result = await client.humanItem(workItemId);
          if (generation.current === request) setItem(result);
        } catch {
          /* Keep the last card and the explicit conflict. */
        }
      }
    } finally {
      mutation.current = false;
      if (generation.current === request) setBusy(false);
    }
  }
  const card = item?.card;
  return (
    <article aria-label={t("Human action")} aria-busy={busy} className="space-y-4">
      <header className="flex justify-between gap-3">
        <h2 className="text-[15px] font-medium tracking-[-0.015em]">
          {card?.title ?? t("Human action")}
        </h2>
        <button className="outcome-control" disabled={busy} onClick={() => void refresh()}>
          {t("Refresh from server")}
        </button>
      </header>
      {error && <p role="alert">{t(error)}</p>}
      {!item && busy && <p role="status">{t("Loading action card…")}</p>}
      {item && !card && <p role="status">{t("This WorkItem has no human action card.")}</p>}
      {item && card && (
        <>
          <p role="status">
            {t("Status")}: {t(item.status)} · {t("Revision")} {card.contractRevision}
          </p>
          {card.startedAt && (
            <p className="text-sm">
              {t("Started by")}: {card.startedBy ?? "—"} · {card.startedAt}
            </p>
          )}
          {card.draft && (
            <section aria-label={t("Saved progress")} className="outcome-card">
              <h3 className="font-medium">{t("Saved progress")}</h3>
              <p>
                {t("Current step")}:{" "}
                {card.steps.find((step) => step.id === card.draft!.currentStepId)?.text ?? "—"}
              </p>
              <p>
                {t("Pause reason")}: {card.draft.reason}
              </p>
              <p className="whitespace-pre-wrap">{card.draft.draftSummary}</p>
            </section>
          )}
          <section>
            <h3 className="font-medium">{t("Purpose")}</h3>
            <p className="whitespace-pre-wrap">{card.purpose}</p>
          </section>
          <section>
            <h3 className="font-medium">{t("Prerequisites")}</h3>
            {card.prerequisites.length ? (
              <ul>
                {card.prerequisites.map((prerequisite, index) => (
                  <li key={index}>
                    {prerequisite.completed ? "✓" : "○"} {prerequisite.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t("No additional prerequisites.")}</p>
            )}
          </section>
          <section>
            <h3 className="font-medium">{t("Steps")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("These instructions are performed by a person. They do not run automatically.")}
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              {card.steps.map((step) => (
                <li key={step.id}>
                  {step.text}
                  {step.optional && ` · ${t("Optional")}`}
                </li>
              ))}
            </ol>
          </section>
          <KnowledgeReferences
            outcomeId={item.outcomeId}
            references={card.references}
            client={materials}
            onRead={(id) => {
              if (card.references.some((reference) => reference.id === id))
                setReadRefs((current) => (current.includes(id) ? current : [...current, id]));
            }}
          />
          <section>
            <h3 className="font-medium">{t("Evidence requirements")}</h3>
            <ul className="space-y-2">
              {card.evidenceRequirements.map((requirement, index) => (
                <li key={`${requirement.criterionId}:${index}`}>
                  {requirement.label} · {t(requirement.required ? "Required" : "Optional")} ·{" "}
                  {requirement.acceptedTypes.join(", ")}
                </li>
              ))}
            </ul>
          </section>
          <div className="flex flex-wrap gap-2">
            {["pending", "ready", "paused", "rejected"].includes(card.status) && (
              <button
                disabled={busy}
                className="outcome-control"
                onClick={() => void mutate("start")}
              >
                {t(
                  card.status === "paused" || card.status === "rejected"
                    ? "Resume action"
                    : "Start action"
                )}
              </button>
            )}
            <button
              className="outcome-control"
              onClick={() => onReview(item.outcomeId, card.contractRevision)}
            >
              {t("Open Outcome and acceptance review")}
            </button>
          </div>
          {card.status === "in_progress" && (
            <fieldset disabled={busy} className="space-y-2 outcome-card">
              <legend>{t("Pause and save progress")}</legend>
              <label className="block">
                {t("Current step")}
                <select
                  className="ml-2 outcome-control"
                  value={currentStep ?? ""}
                  onChange={(event) => setCurrentStep(event.target.value || null)}
                >
                  <option value="">{t("Not selected")}</option>
                  {card.steps.map((step) => (
                    <option key={step.id} value={step.id}>
                      {step.ordinal}. {step.text}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                {t("Pause reason")}
                <input
                  maxLength={1000}
                  className="mt-1 w-full outcome-control"
                  value={pauseReason}
                  onChange={(event) => setPauseReason(event.target.value)}
                />
              </label>
              <p className="text-sm">
                {t(
                  "The current step, read references, pause reason and first 2,000 summary characters are saved to the server."
                )}
              </p>
              <button
                className="outcome-control"
                disabled={!pauseReason.trim()}
                onClick={() => void mutate("pause")}
              >
                {t("Pause action")}
              </button>
            </fieldset>
          )}
          {card.status === "rejected" && (
            <p role="alert">
              {t(
                "The receipt was rejected. Review the feedback, resume the action and submit corrected materials."
              )}
            </p>
          )}
          {["submitted", "review_pending"].includes(card.status) && (
            <p role="status">{t("Receipt submitted. Acceptance review is still required.")}</p>
          )}
          {card.status === "accepted" && (
            <p role="status">
              {t("Human action accepted.")} {card.acceptedAt}
            </p>
          )}
          <ReceiptForm
            card={card}
            client={materials}
            upload={upload}
            summary={summary}
            onSummary={setSummary}
            onConflict={() => void refresh()}
            onSubmitted={(receipt) => {
              setItem((current) =>
                current
                  ? {
                      ...current,
                      receipts: [
                        ...(current.receipts ?? []).filter((item) => item.id !== receipt.id),
                        receipt,
                      ],
                    }
                  : current
              );
              void refresh();
            }}
          />
          <section aria-label={t("Receipt history")} className="space-y-3">
            <h3 className="font-medium">{t("Receipt history")}</h3>
            {!item.receipts?.length && <p>{t("No submitted receipts.")}</p>}
            {item.receipts?.map((receipt) => (
              <details
                key={receipt.id}
                className="outcome-card"
                open={receipt.status === "rejected" || receipt.missingRequirements.length > 0}
              >
                <summary>
                  #{receipt.sequence} · {t(receipt.status)} · {receipt.submittedAt}
                </summary>
                <p>
                  {t("Submitted by")}: {receipt.submittedBy}
                </p>
                {receipt.reviewComment && (
                  <p className="whitespace-pre-wrap">{receipt.reviewComment}</p>
                )}
                {receipt.missingRequirements.length > 0 && (
                  <div role="status">
                    <h4>{t("Missing materials")}</h4>
                    <ul>
                      {receipt.missingRequirements.map((gap, index) => (
                        <li key={index}>
                          {gap.label} · {gap.kind} · {gap.criterionId}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="whitespace-pre-wrap">{receipt.payload.text}</p>
                <p>{receipt.payload.comment}</p>
                {receipt.payload.assetRefs.map((ref) => (
                  <div key={ref} className="space-y-2">
                    <p className="break-all text-xs">
                      {t("Asset")}: {ref}
                    </p>
                    <OutcomeAsset sourceRef={ref} />
                  </div>
                ))}
                {receipt.payload.sourceRefs.map((ref, index) => (
                  <p key={index} className="break-all text-xs">
                    {t("Source")}: {ref.type} · {ref.ref}
                  </p>
                ))}
                {receipt.payload.observations.map((observation, index) => (
                  <p key={index}>
                    {observation.criterionId}: {observation.value}
                  </p>
                ))}
                <p className="break-all text-xs">
                  Receipt {receipt.id} · {t("Evidence")}: {receipt.evidenceIds.join(", ")}
                </p>
              </details>
            ))}
          </section>
        </>
      )}
    </article>
  );
}
