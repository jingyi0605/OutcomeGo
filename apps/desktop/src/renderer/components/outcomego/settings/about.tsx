import { X } from "lucide-react";
import appIcon from "../../../assets/outcomego-icon.png?url";
import { useI18n } from "../../../lib/i18n";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../ui/dialog";

function OutcomeGoAppIcon() {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="size-16 rounded-[16px] shadow-[0_12px_24px_rgba(0,0,0,0.18)]"
      src={appIcon}
    />
  );
}

export default function AboutPanel({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const { t } = useI18n();
  const version = window.outcomego?.versions.app ?? "0.0.0";
  const copyVersion = () =>
    void navigator.clipboard?.writeText(
      `OutcomeGo ${version}\nElectron ${window.outcomego?.versions.electron ?? "unknown"}\nChrome ${window.outcomego?.versions.chrome ?? "unknown"}`
    );
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="h-[272px] w-[360px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-[15px] border-black/10 bg-background p-0 shadow-[0_22px_70px_rgba(0,0,0,0.2)]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t("About OutcomeGo")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("OutcomeGo version and copyright information.")}
        </DialogDescription>
        <DialogClose asChild>
          <button
            aria-label={t("Close About")}
            className="absolute right-3.5 top-3.5 z-10 grid size-8 place-items-center rounded-full text-foreground-tertiary outline-none transition-colors hover:bg-black/[0.045] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35 dark:hover:bg-white/[0.06]"
            type="button"
          >
            <X className="size-4" strokeWidth={1.7} />
          </button>
        </DialogClose>
        <div className="flex h-full flex-col items-center pt-[34px] text-center">
          <OutcomeGoAppIcon />
          <h2 className="mt-3 text-[20px] font-semibold leading-6 tracking-[-0.02em]">OutcomeGo</h2>
          <div className="mt-0.5 text-[12px] leading-4 text-foreground-tertiary">
            {t("Version {version}", { version })}
          </div>
          <div className="mt-3 text-[12px] leading-4 text-foreground-tertiary">
            {t("Copyright © 2026 OutcomeGo contributors")}
          </div>
          <button
            className="mt-6 inline-flex h-8 items-center rounded-[8px] border border-black/[0.055] bg-black/[0.035] px-3 text-[12px] shadow-[0_1px_1px_rgba(0,0,0,0.02)] hover:bg-black/[0.06] dark:border-white/[0.07] dark:bg-white/[0.07] dark:hover:bg-white/[0.1]"
            onClick={copyVersion}
            type="button"
          >
            {t("Copy version info")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
