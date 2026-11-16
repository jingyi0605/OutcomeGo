import type { ExternalDeliveryState } from "@outcomego/contracts";
import { useI18n } from "../../lib/i18n";

const STATUSES = new Set<ExternalDeliveryState["status"]>(["pending", "sending", "sent", "failed", "uncertain"]);

/** Reads the delivery state the Server mirrors onto a Bot message; anything malformed counts as absent. */
export function externalDeliveryOf(metadata: unknown): ExternalDeliveryState | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).externalDelivery;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { id, status, code } = value as Record<string, unknown>;
  if (typeof id !== "string" || typeof status !== "string") return null;
  if (!STATUSES.has(status as ExternalDeliveryState["status"])) return null;
  return {
    id,
    status: status as ExternalDeliveryState["status"],
    code: typeof code === "string" ? code : null,
  };
}

type Translate = ReturnType<typeof useI18n>["t"];

/** A display name for the platform id a connector declares, e.g. `wechat` becomes `WeChat`. */
export const externalPlatformLabel = (platform: string | undefined, t: Translate): string =>
  !platform
    ? t("an external service")
    : platform === "wechat"
      ? t("WeChat")
      : platform.charAt(0).toUpperCase() + platform.slice(1);

const reasonFor = (code: string | null, t: Translate): string | null => {
  switch (code) {
    case null:
      return null;
    case "external_delivery_timeout":
      return t("The chat service did not answer in time.");
    case "external_delivery_transport":
      return t("The connection to the chat service failed.");
    case "external_delivery_unsupported":
      return t("This kind of content cannot be sent to that chat.");
    case "external_delivery_unreadable":
      return t("The reply could not be read for sending.");
    case "external_connection_unavailable":
      return t("The account is not connected.");
    default:
      return code;
  }
};

/** Shows whether a Bot reply reached the external chat. "Sent" means handed over, not read. */
export function ExternalDeliveryStatus({ state }: { state: ExternalDeliveryState }) {
  const { t } = useI18n();
  const reason = reasonFor(state.code, t);
  const label =
    state.status === "sent"
      ? t("Sent")
      : state.status === "failed"
        ? t("Not delivered")
        : state.status === "uncertain"
          ? t("Delivery unconfirmed")
          : t("Sending…");
  const tone =
    state.status === "failed"
      ? "text-red-600 dark:text-red-400"
      : state.status === "uncertain"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  return (
    <div
      className={`ml-2.5 mt-0.5 self-start text-xs ${tone}`}
      data-external-delivery={state.status}
      role={state.status === "failed" || state.status === "uncertain" ? "status" : undefined}
    >
      <span className="font-medium">{label}</span>
      {state.status === "uncertain" ? (
        <span>{` · ${t("It may have arrived and will not be sent again.")}`}</span>
      ) : null}
      {reason && (state.status === "failed" || state.status === "uncertain") ? (
        <span>{` · ${reason}`}</span>
      ) : null}
    </div>
  );
}
