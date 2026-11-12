import { Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog";
import { useI18n } from "../../../lib/i18n";

type Grant = "automation" | "contacts" | "fullDiskAccess";
const ROWS: Array<{ key: Grant; label: string; description: string }> = [
  {
    key: "automation",
    label: "Automation",
    description: "Lets OutcomeGo send texts through Messages",
  },
  { key: "contacts", label: "Contacts", description: "Lets OutcomeGo find people by name" },
  {
    key: "fullDiskAccess",
    label: "Full Disk Access",
    description: "Lets OutcomeGo search your texts",
  },
];

export const grantState = (permissions: OutcomeGoMessagesPermissions, key: Grant) =>
  key === "fullDiskAccess"
    ? permissions.fullDiskAccess
      ? "granted"
      : "notAsked"
    : permissions[key];

/** Grants still missing, in the order the dialog lists them. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Missing macOS grants, translated when a translator is supplied. */
export const missingGrants = (
  permissions: OutcomeGoMessagesPermissions | null,
  t?: Translate
) =>
  permissions
    ? ROWS.filter((row) => grantState(permissions, row.key) !== "granted").map((row) =>
        t ? t(row.label) : row.label
      )
    : [];

let messagesIcon: Promise<string | null> | undefined;
/** The Messages app's own icon, as macOS draws it. */
export function useMessagesIcon() {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    messagesIcon ??=
      window.outcomego?.computer.messagesIcon?.().catch(() => null) ?? Promise.resolve(null);
    void messagesIcon.then(setIcon);
  }, []);
  return icon;
}

/** "Allow OutcomeGo to Use Messages": the three macOS grants, each allowed in place or in System Settings. */
export function MessagesPermissionsDialog({
  open,
  onOpenChange,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange?: (permissions: OutcomeGoMessagesPermissions) => void;
}) {
  const { t } = useI18n();
  const icon = useMessagesIcon();
  const [permissions, setPermissions] = useState<OutcomeGoMessagesPermissions | null>(null);
  const [pending, setPending] = useState<Grant | null>(null);
  const [failed, setFailed] = useState<Partial<Record<Grant, string>>>({});
  const apply = useCallback(
    (value: OutcomeGoMessagesPermissions | null) => {
      if (!value) return;
      setPermissions(value);
      onChange?.(value);
    },
    [onChange]
  );
  const refresh = useCallback(() => {
    void window.outcomego?.computer
      .messagesPermissions()
      .then(apply)
      .catch(() => {});
  }, [apply]);
  useEffect(() => {
    if (!open) return;
    refresh();
    // Grants change in System Settings, outside the app.
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [open, refresh]);

  const allow = async (key: Grant) => {
    setPending(key);
    setFailed((current) => ({ ...current, [key]: undefined }));
    try {
      const before = permissions;
      const next = await window.outcomego!.computer.messagesPermissions(key);
      apply(next);
      // Automation and Contacts ask in place; an unchanged answer means macOS showed nothing.
      if (
        next &&
        key !== "fullDiskAccess" &&
        before &&
        grantState(before, key) === grantState(next, key) &&
        grantState(next, key) !== "granted"
      )
        setFailed((current) => ({
          ...current,
          [key]:
            key === "automation"
              ? t("macOS didn't show the permission prompt. Open Messages, then try again.")
              : t("macOS didn't show the permission prompt. Try again."),
        }));
    } catch {
      setFailed((current) => ({ ...current, [key]: t("Couldn't save. Try again.") }));
    } finally {
      setPending(null);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-[440px] gap-0 rounded-[14px] p-6">
        {icon ? <img alt="" className="mb-3 size-10" src={icon} /> : null}
        <DialogTitle className="text-[15px] font-semibold">
          {t("Allow OutcomeGo to Use Messages")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-[13px]">
          {t(
            "OutcomeGo needs macOS permissions to send texts, find contacts by name, and search your texts when asked"
          )}
        </DialogDescription>
        <div className="mt-4 flex flex-col">
          {ROWS.map((row) => {
            const state = permissions ? grantState(permissions, row.key) : null;
            const blocked = row.key === "automation" && state === "denied";
            const description =
              failed[row.key] ??
              (blocked
                ? t(
                    "macOS is blocking Messages Automation. Turn on Messages under OutcomeGo in Privacy & Security → Automation."
                  )
                : row.key === "contacts" && state === "denied"
                  ? t(
                      "macOS is blocking Contacts. Turn on OutcomeGo in Privacy & Security → Contacts."
                    )
                  : t(row.description));
            return (
              <div
                className="flex min-h-[52px] items-center gap-4 border-t border-black/[0.065] py-2 first:border-t-0 dark:border-white/[0.07]"
                key={row.key}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] leading-[17px] text-foreground">{t(row.label)}</div>
                  <div
                    className="mt-px text-[12px] leading-4 text-foreground-secondary"
                    role={failed[row.key] ? "alert" : undefined}
                  >
                    {description}
                  </div>
                </div>
                {state === "granted" ? (
                  <span className="inline-flex items-center gap-1 text-[12px] text-foreground-secondary">
                    <Check aria-hidden className="size-3.5" strokeWidth={2.25} />
                    {t("Done")}
                  </span>
                ) : (
                  <button
                    aria-label={
                      state === "denied"
                        ? t("Open System Settings for {name}", { name: t(row.label) })
                        : t("Allow {name}", { name: t(row.label) })
                    }
                    className="inline-flex h-7 shrink-0 items-center rounded-[8px] bg-[var(--control-accent)] px-3 text-[12px] font-medium text-white disabled:opacity-50"
                    disabled={!permissions || pending !== null}
                    onClick={() => void allow(row.key)}
                    type="button"
                  >
                    {state === "denied" ? t("Open System Settings") : t("Allow")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Any part of the app can open the permissions window with this event. */
export const OPEN_MESSAGES_PERMISSIONS_EVENT = "outcomego:open-messages-permissions";

/** Opens the permissions dialog wherever the user is when a bot needs a grant mid-task, or a setup button asks. */
export function MessagesGrantsPrompt() {
  const [open, setOpen] = useState(false);
  useEffect(() => window.outcomego?.computer.onMessagesGrantsNeeded?.(() => setOpen(true)), []);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_MESSAGES_PERMISSIONS_EVENT, show);
    return () => window.removeEventListener(OPEN_MESSAGES_PERMISSIONS_EVENT, show);
  }, []);
  return <MessagesPermissionsDialog onOpenChange={setOpen} open={open} />;
}
