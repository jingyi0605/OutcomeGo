import { clientErrorMessage } from "@outcomego/product-core/redaction";
import { ExternalLink } from "lucide-react";
import { type ComponentProps, useCallback, useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import "../../ai-elements/message-response/streamdown.css";
import "./release-notes.css";
import { useI18n } from "../../../lib/i18n";
import { LoadingOrb } from "../../ui/loading-orb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { settingsPrimaryButton, settingsSecondaryButton } from "./ui";

const PULL_REQUEST_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:pull|issues)\/(\d+)$/;

type NotesLinkProps = ComponentProps<"a"> & { node?: unknown };

/** A real external link: the main process opens https targets in the system browser. */
function NotesLink({ children, href, node: _node, className: _className, ...props }: NotesLinkProps) {
  // GitHub's generated notes link every change by its full pull request URL; show "#123" instead.
  const reference =
    href && children === href ? (PULL_REQUEST_URL.exec(href)?.[1] ?? null) : null;
  return (
    <a {...props} className="release-notes-link" href={href} rel="noreferrer noopener" target="_blank">
      {reference ? `#${reference}` : children}
    </a>
  );
}

const notesComponents = { a: NotesLink };

/** Release notes as Markdown. Raw HTML and images in a release body are dropped. */
export function ReleaseNotesMarkdown({ children }: { children: string }) {
  return (
    <Streamdown
      className="release-notes"
      components={notesComponents}
      controls={false}
      disallowedElements={["img"]}
      lineNumbers={false}
      mode="static"
      skipHtml
      unwrapDisallowed
    >
      {children}
    </Streamdown>
  );
}

type NotesState =
  | { status: "loading" }
  | { status: "ready"; notes: OutcomeGoReleaseNotes }
  | { status: "error"; error: unknown };

export function ReleaseNotesDialog({
  version,
  open,
  onOpenChange,
}: {
  version: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<NotesState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: "loading" });
    const load = window.outcomego?.updates.releaseNotes(version);
    if (!load) {
      setState({ status: "error", error: null });
      return;
    }
    load.then(
      (notes) => {
        if (!cancelled) setState({ status: "ready", notes });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: "error", error });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [open, version, attempt]);

  const openRelease = useCallback(() => {
    if (state.status === "ready") window.open(state.notes.url, "_blank", "noopener");
  }, [state]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 max-h-[min(680px,calc(100vh-4rem))] max-w-[640px]"
      >
        <DialogHeader className="gap-1 border-b border-border px-6 pb-4 pr-12 pt-5">
          <DialogTitle>{t("Release notes")}</DialogTitle>
          <DialogDescription>{t("Version {version}", { version })}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-6 py-5" data-release-notes-body>
          {state.status === "loading" ? (
            <div
              aria-live="polite"
              className="flex items-center gap-2 py-6 text-[13px] text-foreground-secondary"
              role="status"
            >
              <LoadingOrb aria-hidden size={14} />
              {t("Loading…")}
            </div>
          ) : state.status === "error" ? (
            <div className="flex flex-col items-start gap-3 py-2" role="alert">
              <p className="text-[13px] text-destructive">
                {clientErrorMessage(state.error, t("Could not load the release notes"))}
              </p>
              <button
                className={settingsSecondaryButton}
                onClick={() => setAttempt((count) => count + 1)}
                type="button"
              >
                {t("Try again")}
              </button>
            </div>
          ) : state.notes.markdown ? (
            <ReleaseNotesMarkdown>{state.notes.markdown}</ReleaseNotesMarkdown>
          ) : (
            <p className="py-6 text-[13px] text-foreground-secondary">
              {t("This release has no published notes.")}
            </p>
          )}
        </div>
        <DialogFooter className="border-t border-border px-6 py-3">
          <button
            className={settingsSecondaryButton}
            disabled={state.status !== "ready"}
            onClick={openRelease}
            type="button"
          >
            <ExternalLink aria-hidden className="size-3.5" />
            {t("View on GitHub")}
          </button>
          <button
            className={settingsPrimaryButton}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            {t("Close")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The "View release notes" button together with the dialog it opens. */
export function ReleaseNotesButton({ version }: { version: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={settingsSecondaryButton}
        onClick={() => setOpen(true)}
        type="button"
      >
        {t("View release notes")}
      </button>
      {open ? <ReleaseNotesDialog onOpenChange={setOpen} open version={version} /> : null}
    </>
  );
}
