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
  waiting = false,
}: {
  revision: ContractRevisionView;
  busy: boolean;
  comment: string;
  onComment: (value: string) => void;
  onApprove: () => void;
  /** The owner's words go to the bot as written; what to do with them is the bot's call. */
  onRequestChanges: (text: string) => void;
  /** The bot is working on an earlier message: approving now could approve a plan about to change. */
  waiting?: boolean;
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
          placeholder={t("Approve with a comment, or tell the bot what to change or ask.")}
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
          disabled={busy || waiting}
          onClick={() => {
            if (!busy && !waiting) onApprove();
          }}
        >
          {t(busy ? "Submitting…" : "Yes, approve")}
        </OutcomeButton>
        <OutcomeButton
          // Sending stays available while the bot works: a new message queues behind the running one.
          disabled={busy || !comment.trim()}
          onClick={() => {
            if (busy || !comment.trim()) return;
            onRequestChanges(comment);
          }}
        >
          {t("Send to bot")}
        </OutcomeButton>
      </div>
      {waiting && (
        <p role="status" className="outcome-approval-status">
          {t("The bot is working on your message. You can approve once it has answered.")}
        </p>
      )}
    </section>
  );
}
