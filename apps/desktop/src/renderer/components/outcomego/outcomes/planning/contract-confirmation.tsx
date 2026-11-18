import type { ContractRevisionView } from "@outcomego/contracts/outcomes";
import { useI18n } from "../../../../lib/i18n";
import { OutcomeButton } from "../outcome-ui";

export function ContractConfirmation({
  revision,
  busy,
  confirmation,
  onConfirmation,
  onApprove,
}: {
  revision: ContractRevisionView;
  busy: boolean;
  confirmation: string;
  onConfirmation: (value: string) => void;
  onApprove: () => void;
}) {
  const { t } = useI18n();
  return (
    <section aria-label={t("Contract confirmation")} className="space-y-3 outcome-card">
      <h3 className="font-medium">
        {t("Contract revision {revision}", { revision: revision.revision })} ·{" "}
        {t(revision.status)}
      </h3>
      {revision.baseRevisionId && (
        <p className="break-all text-xs">
          {t("Based on contract {id}", { id: revision.baseRevisionId })}
        </p>
      )}
      {revision.changeSummary && <p>{t("Change")}: {revision.changeSummary}</p>}
      {revision.sourceDecisionId && (
        <p className="break-all text-xs">{t("Source Decision")}: {revision.sourceDecisionId}</p>
      )}
      <div>
        <h4>{t("Goals")}</h4>
        <ul className="list-inside list-disc">
          {revision.goal.map((goal, i) => (
            <li key={i}>{goal}</li>
          ))}
        </ul>
      </div>
      <div>
        <h4>{t("Acceptance")}</h4>
        <ul className="list-inside list-disc">
          {revision.criteria.map((c) => (
            <li key={c.id}>
              {t(c.required ? "Required" : "Optional")}: {c.statement}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4>{t("Boundaries")}</h4>
        <ul className="list-inside list-disc">
          {revision.boundaries.included.map((text, i) => (
            <li key={`in${i}`}>{t("Included")}: {text}</li>
          ))}
          {revision.boundaries.excluded.map((text, i) => (
            <li key={`out${i}`}>{t("Excluded")}: {text}</li>
          ))}
        </ul>
      </div>
      <p>
        {t("Budget")}:{" "}
        {revision.budget?.timeLimitMinutes == null
          ? t("No time limit specified")
          : t("{minutes} minutes", { minutes: revision.budget.timeLimitMinutes })}
        ;{" "}
        {revision.budget?.costLimit == null
          ? t("no cost limit specified")
          : t("cost limit {cost}", { cost: revision.budget.costLimit })}
        .
      </p>
      <p className="text-xs text-muted-foreground">
        {t("Budget is execution context. Automatic stopping is not enabled.")}
      </p>
      {revision.conflicts.map((c, i) => (
        <p key={i} role={c.severity === "blocking" ? "alert" : "status"}>
          {c.severity}: {c.message}
        </p>
      ))}
      {revision.status === "pending_approval" && (
        <>
          <label className="block">
            {t("Approval confirmation")}
            <input
              aria-label={t("Approval confirmation")}
              className="mt-1 w-full outcome-control"
              maxLength={500}
              value={confirmation}
              onChange={(e) => onConfirmation(e.target.value)}
              disabled={busy}
              placeholder={t("I confirm these goals, acceptance criteria and boundaries.")}
            />
          </label>
          <OutcomeButton
            variant="default"
            disabled={busy || !confirmation.trim()}
            onClick={onApprove}
          >
            {t(busy ? "Submitting…" : "Approve contract")}
          </OutcomeButton>
        </>
      )}
      {revision.approvedAt && (
        <p>
          {t("Approved by {name} at {time}.", {
            name: revision.approvedBy,
            time: new Date(revision.approvedAt).toLocaleString(),
          })}
        </p>
      )}
    </section>
  );
}
