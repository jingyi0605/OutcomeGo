import type { PluginDeviceLinkView } from "@outcomego/contracts";
import { useI18n } from "../../../lib/i18n";

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

/** A code the browser can safely show: a bounded PNG data URL, nothing else. */
export const deviceLinkImage = (link: Pick<PluginDeviceLinkView, "qrCodeDataUrl">): string | null =>
  typeof link.qrCodeDataUrl === "string" && link.qrCodeDataUrl.length <= 70_000 && PNG_DATA_URL.test(link.qrCodeDataUrl)
    ? link.qrCodeDataUrl
    : null;

const secondary =
  "inline-flex h-[26px] cursor-pointer items-center rounded-full bg-[#77777717] px-3 text-[12px] outline-none transition-colors hover:bg-[#7777772b] focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-default disabled:opacity-45";

/**
 * The QR approval a connector started: the code, how to use it, and a way to replace or abandon it.
 * The code rotates on its own; the settings page keeps polling, so this only renders what it is given.
 */
export function DeviceLinkPanel({
  link,
  busy,
  onNewCode,
  onCancel,
}: {
  link: PluginDeviceLinkView;
  busy: boolean;
  onNewCode: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const image = deviceLinkImage(link);
  return (
    <div className="mt-3 grid justify-items-start gap-3" data-device-link={link.sessionId}>
      <p className="text-[11px] leading-4 text-foreground-secondary">{link.instructions}</p>
      {image ? (
        <img
          alt={t("Scan to link your account")}
          className="size-[220px] rounded-[10px] bg-white p-2"
          // The code is a bitmap of modules; smoothing it makes it harder to scan.
          style={{ imageRendering: "pixelated" }}
          src={image}
        />
      ) : (
        <p className="text-[11px] leading-4 text-foreground-tertiary">
          {t("Waiting for an updated code or phone approval. You can also get a new code.")}
        </p>
      )}
      <p className="text-[10.5px] leading-4 text-foreground-tertiary">
        {t("Scan with the phone that has your account. The code refreshes by itself.")}
      </p>
      <div className="flex gap-2">
        <button className={secondary} type="button" disabled={busy} onClick={onNewCode}>
          {t("Get new code")}
        </button>
        <button className={secondary} type="button" disabled={busy} onClick={onCancel}>
          {t("Cancel linking")}
        </button>
      </div>
    </div>
  );
}
