import type { ContractRevisionView } from "@outcomego/contracts/outcomes";
import { useI18n } from "../../../../lib/i18n";
import { OutcomeButton } from "../outcome-ui";

export function ContractConfirmation({
  revision,
  busy,
  comment,
  onComment,
  onApprove,
  onRequestChanges,
}: {
  revision: ContractRevisionView;
  busy: boolean;
  comment: string;
  onComment: (value: string) => void;
  onApprove: () => void;
  onRequestChanges: (text: string) => void;
}) {
  const { t } = useI18n();
  if (revision.status !== "pending_approval")
    return (
      <p className="outcome-approval-status">
        {t(revision.status === "approved" ? "Plan approved" : revision.status)}
      </p>
    );
  return (
    <section aria-label={t("Plan decision")} className="outcome-approval">
      <label className="outcome-approval-comment">
        {t("Your comments")}
        <textarea
          aria-label={t("Approval comments")}
          className="outcome-control"
          placeholder={t("Add comments or tell us what to change (optional).")}
          maxLength={400}
          rows={1}
          value={comment}
          disabled={busy}
          onChange={(event) => onComment(event.target.value)}
        />
      </label>
      <div className="outcome-direct-buttons">
        <OutcomeButton
          variant="default"
          disabled={busy}
          onClick={() => {
            if (!busy) onApprove();
          }}
        >
          {t(busy ? "Submitting…" : "Yes, approve")}
        </OutcomeButton>
        <OutcomeButton
          disabled={busy}
          onClick={() => {
            if (busy) return;
            onRequestChanges(
              comment.trim() || t("I do not approve this plan. Suggest an alternative.")
            );
          }}
        >
          {t("Modify")}
        </OutcomeButton>
      </div>
    </section>
  );
}
