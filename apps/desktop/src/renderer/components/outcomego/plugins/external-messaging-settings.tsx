import type { BotView, ExternalMessagingView } from "@outcomego/contracts";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../client/outcomego-api";
import { useI18n } from "../../../lib/i18n";
import { PluginButton, PluginField, PluginSelect, inputClass, usePluginOperation } from "./plugin-ui";

type Translate = ReturnType<typeof useI18n>["t"];

/** Error codes the Server records on a binding, mapped to something a person can act on. */
const errorHint = (code: string, t: Translate): string | undefined => {
  switch (code) {
    case "external_target_unavailable":
      return t("The selected Bot is unavailable. Choose another Bot or restore this one, then save.");
    case "external_poll_failed":
      return t("Could not read new messages from this account. Check the account status above.");
    case "external_poll_invalid":
      return t("The connector returned data the Server could not read. Restart the connection.");
    case "external_accept_failed":
      return t("A message could not be stored and will be retried.");
    case "external_retry_exhausted":
      return t("A message failed repeatedly and was skipped.");
    case "external_connection_unavailable":
      return t("The connection is not ready. Reconnect the account.");
    default:
      return undefined;
  }
};

const rejectionLabel = (code: string, t: Translate): string => {
  switch (code) {
    case "external_sender_not_allowed":
      return t("Messages from other people");
    case "external_peer_type_unsupported":
      return t("Group or unsupported chats");
    case "external_message_invalid":
      return t("Unreadable messages");
    default:
      return code;
  }
};

const formatTime = (value: string | null, locale: string) =>
  value ? new Date(value).toLocaleString(locale) : null;

/**
 * The messaging entry for a connection: a switch, the Bot that receives the chat and diagnostics.
 * Connections whose plugin declares no `messaging` render nothing (the Server answers `supported: false`).
 */
export function ExternalMessagingSettings({
  connectionId,
  refresh,
}: {
  connectionId: string;
  refresh: () => Promise<unknown>;
}) {
  const { locale, t } = useI18n();
  const [view, setView] = useState<ExternalMessagingView | null>(null);
  const [bots, setBots] = useState<BotView[]>([]);
  const [botId, setBotId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [reminderOn, setReminderOn] = useState(false);
  const [reminderTime, setReminderTime] = useState("20:00");
  const load = useCallback(async () => {
    const next = await api.externalMessaging(connectionId);
    setView(next);
    if (next.binding) {
      setBotId(next.binding.botId);
      setEnabled(next.binding.enabled);
      setReminderOn(next.binding.reminder.enabled);
      setReminderTime(next.binding.reminder.time);
    }
    return next;
  }, [connectionId]);
  const operation = usePluginOperation(async () => {
    await Promise.all([refresh(), load()]);
  });

  useEffect(() => {
    let cancelled = false;
    setView(null);
    void Promise.all([api.externalMessaging(connectionId), api.bots()])
      .then(([next, list]) => {
        if (cancelled) return;
        setView(next);
        setBots(list.filter((bot) => bot.status === "active"));
        if (next.binding) {
          setBotId(next.binding.botId);
          setEnabled(next.binding.enabled);
          setReminderOn(next.binding.reminder.enabled);
          setReminderTime(next.binding.reminder.time);
        }
      })
      .catch(() => {
        if (!cancelled) setView(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  if (!view?.supported) return null;
  const binding = view.binding;
  const options = bots.map((bot) => ({ value: bot.id, label: bot.name }));
  // A bound Bot that is no longer active stays selectable so the page does not silently change it.
  if (botId && !options.some((option) => option.value === botId))
    options.unshift({ value: botId, label: t("Unavailable Bot") });
  const windowHours = view.replyWindowHours;
  const timeValid = /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(reminderTime);
  const dirty =
    !binding ||
    binding.botId !== botId ||
    binding.enabled !== enabled ||
    (windowHours !== null && (binding.reminder.enabled !== reminderOn || binding.reminder.time !== reminderTime));
  const needsAttention = binding?.status === "needs_attention";
  const hint = binding?.lastErrorCode ? errorHint(binding.lastErrorCode, t) : undefined;
  const rejected = Object.entries(binding?.rejectedCounts ?? {}).filter(([, count]) => count > 0);

  return (
    <section className="grid gap-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <h4 className="text-[13px] font-medium">{t("Chat with a Bot from this account")}</h4>
      <p className="text-xs text-foreground-secondary">
        {t("Messages you send to this account are delivered to the Bot you choose, and its replies are sent back.")}
      </p>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          aria-label={t("Enable chat with a Bot")}
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        {t("Enable chat with a Bot")}
      </label>
      <PluginField label={t("Bot that receives messages")}>
        <PluginSelect
          className={inputClass}
          label={t("Bot that receives messages")}
          value={botId}
          onChange={setBotId}
          options={[{ value: "", label: t("Choose a Bot…") }, ...options]}
        />
      </PluginField>
      {windowHours !== null && (
        <div className="grid gap-2 rounded-lg bg-black/[0.03] p-3 dark:bg-white/[0.04]">
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              aria-label={t("Daily keep-alive reminder")}
              checked={reminderOn}
              onChange={(event) => setReminderOn(event.target.checked)}
            />
            {t("Daily keep-alive reminder")}
          </label>
          <p className="text-xs text-foreground-secondary">
            {t(
              "This service only lets your Bot reply for about {hours} hours after you last wrote. If you have not written today by the time below, a short reminder is sent. Reply with anything, such as 1, to keep it open; your Bot does not act on that reply.",
              { hours: windowHours }
            )}
          </p>
          <PluginField label={t("Reminder time")}>
            <input
              type="time"
              aria-label={t("Reminder time")}
              className={inputClass}
              disabled={!reminderOn}
              value={reminderTime}
              onChange={(event) => setReminderTime(event.target.value)}
            />
          </PluginField>
        </div>
      )}
      <div>
        <PluginButton
          primary
          disabled={operation.busy || !botId || !dirty || (windowHours !== null && !timeValid)}
          loading={operation.busy}
          onClick={() =>
            void operation.run(
              () =>
                api.putExternalMessaging(connectionId, {
                  enabled,
                  botId,
                  ...(windowHours !== null ? { reminder: { enabled: reminderOn, time: reminderTime } } : {}),
                }),
              t("Chat settings saved.")
            )
          }
        >
          {t("Save")}
        </PluginButton>
      </div>
      {needsAttention && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {t("Receiving is paused. Choose an available Bot and save to resume.")}
        </p>
      )}
      {binding && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-foreground-secondary">
          <dt>{t("Last checked")}</dt>
          <dd>{formatTime(binding.lastPolledAt, locale) ?? t("Never")}</dd>
          <dt>{t("Last message received")}</dt>
          <dd>{formatTime(binding.lastAcceptedAt, locale) ?? t("Never")}</dd>
          {windowHours !== null && binding.reminder.lastSentAt && (
            <>
              <dt>{t("Last reminder")}</dt>
              <dd>
                {formatTime(binding.reminder.lastSentAt, locale)}
                {binding.reminder.lastOutcome === "failed" ? ` · ${t("Not delivered")}` : null}
                {binding.reminder.lastOutcome === "uncertain" ? ` · ${t("Delivery unconfirmed")}` : null}
              </dd>
            </>
          )}
          {binding.consecutiveFailures > 0 && (
            <>
              <dt>{t("Consecutive failures")}</dt>
              <dd>{binding.consecutiveFailures}</dd>
            </>
          )}
          {binding.lastErrorCode && (
            <>
              <dt>{t("Last error")}</dt>
              <dd>
                <span className="break-all">{binding.lastErrorCode}</span>
                {hint ? <span className="block">{hint}</span> : null}
              </dd>
            </>
          )}
          {rejected.map(([code, count]) => (
            <div key={code} className="contents">
              <dt>{t("Ignored")}</dt>
              <dd>
                {rejectionLabel(code, t)}: {count}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {operation.feedback}
    </section>
  );
}
