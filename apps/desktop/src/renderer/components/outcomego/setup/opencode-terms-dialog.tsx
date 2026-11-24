import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../../lib/i18n";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { settingsPrimaryButton, settingsSecondaryButton } from "../settings/ui";

/**
 * Risk and terms confirmation required before connecting OpenCode Zen with the public key.
 */
export function OpenCodeFreeTermsDialog({
  onAccept,
  onClose,
}: {
  onAccept: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [agreed, setAgreed] = useState(false);
  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t("OpenCode Zen free-model terms")}</DialogTitle>
          <DialogDescription>
            {t("OpenCode offers selected models at no charge for a limited time, intended for OpenCode client traffic.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm text-muted-foreground">
          <p>{t("To use free models here, you will enter the public key manually. Requests use OpenCode client headers and environment context.")}</p>
          <p>{t("OpenCode sets the quotas and rate limits. The free allowance and request rate can change by model or network, and busy models may return rate-limit errors.")}</p>
          <p>{t("You choose whether to use OpenCode Zen. Prompts and metadata you send are subject to OpenCode’s terms and the model’s data policy.")}</p>
          <a
            className="inline-flex w-fit items-center gap-1 underline underline-offset-4"
            href="https://opencode.ai/docs/zen/"
            rel="noopener noreferrer"
            target="_blank"
          >
            {t("OpenCode pricing and data policies")} <ExternalLink aria-hidden="true" className="size-3" />
          </a>
          <label className="mt-1 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/80 bg-muted/40 p-3 text-xs leading-relaxed text-foreground">
            <input
              checked={agreed}
              className="mt-0.5 size-4 shrink-0 accent-foreground"
              onChange={(event) => setAgreed(event.target.checked)}
              type="checkbox"
            />
            <span>
              {t("I understand the risks, usage limits, and data policies, and agree to connect OpenCode Zen.")}
            </span>
          </label>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <button className={settingsSecondaryButton} type="button">
              {t("Cancel")}
            </button>
          </DialogClose>
          <button
            className={settingsPrimaryButton}
            disabled={!agreed}
            onClick={onAccept}
            type="button"
          >
            {t("Agree & continue")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
