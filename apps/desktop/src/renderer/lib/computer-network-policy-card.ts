import type { RichMessageWidget } from "@outcomego/contracts";
import type { Locale } from "@outcomego/contracts/localization";
import { translate } from "./i18n-catalog";

/** Localize stored server cards without changing their approval payloads or rule labels. */
export function localizeComputerNetworkPolicyCard(widget: RichMessageWidget, locale: Locale): RichMessageWidget {
  if (locale === "en-US") return widget;
  const verification = /^Verify this exact cloud computer firewall policy in (lan|allowlist) mode\.$/.exec(widget.prompt);
  const approval = /^Approve this cloud computer firewall change to (lan|allowlist) mode\?$/.exec(widget.prompt);
  const mode = (verification ?? approval)?.[1];
  if (!mode) return widget;
  const t = (key: string, values?: Record<string, string>) => translate(locale, key, values);
  const impact = mode === "lan"
    ? "LAN access permits all private TCP destinations."
    : "Only the listed private TCP destinations, model endpoints, and system management exceptions remain reachable.";
  const publicTraffic = "Public traffic continues through the managed exit.";
  const notice = verification
    ? "Verification does not apply the policy; a separate approval card follows."
    : "Approval authorizes only this exact policy. Existing connections may be interrupted.";
  let helpText = widget.helpText;
  const details = /^(.*?) Revision (\d+); expires at (\S+)\. (.*?) Rules:\n([\s\S]*)$/.exec(helpText ?? "");
  if (details && details[1] === `${impact} ${publicTraffic}` && details[4] === notice) {
    const expiresAt = new Date(details[3]!);
    const expiry = Number.isNaN(expiresAt.getTime()) ? details[3]! : new Intl.DateTimeFormat(locale, {
      dateStyle: "medium", timeStyle: "medium",
    }).format(expiresAt);
    const rules = details[5] === "- none" ? t("No manual TCP rules.") : details[5]!;
    helpText = [
      t(impact), t(publicTraffic),
      t("Revision {revision}; expires at {expiry}.", { revision: details[2]!, expiry }),
      t(notice), `${t("TCP rules:")}\n${rules}`,
    ].join("\n");
  }
  const labels = new Map([
    ["Verify policy", t("Verify policy")],
    ["Cancel", t("Cancel")],
    ["Approve firewall change", t("Approve firewall change")],
    ["Deny", t("Deny")],
  ]);
  return {
    ...widget,
    prompt: verification
      ? t("Verify this exact cloud computer firewall policy in {mode} mode.", { mode: mode === "lan" ? t("LAN access") : t("Allowlist") })
      : t("Approve this cloud computer firewall change to {mode} mode?", { mode: mode === "lan" ? t("LAN access") : t("Allowlist") }),
    helpText,
    options: widget.options.map((option) => ({
      ...option,
      value: option.value ?? option.label,
      label: labels.get(option.label) ?? option.label,
    })),
  };
}
