import type { BotView, ExternalMessagingView } from "@outcomego/contracts";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../client/outcomego-api";
import { useI18n } from "../../../lib/i18n";
import { inputClass, PluginField, PluginSelect } from "./plugin-ui";

/**
 * Which Bot a messaging account talks to. Every account is bound to exactly one Bot, chosen before
 * it is linked, so a message that arrives always has somewhere to go. Connections whose plugin
 * declares no `messaging` report `supported: false` and this stays empty.
 */
export function useExternalBotChoice(connectionId: string, active: boolean) {
  const [view, setView] = useState<ExternalMessagingView | null>(null);
  // False until the first answer, so a QR code is never shown before we know a Bot is required.
  const [loaded, setLoaded] = useState(false);
  const [bots, setBots] = useState<BotView[]>([]);
  const [botId, setBotId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void Promise.all([api.externalMessaging(connectionId), api.bots()])
      .then(([next, list]) => {
        if (cancelled) return;
        setView(next);
        setBots(list.filter((bot) => bot.status === "active"));
        if (next.binding) setBotId(next.binding.botId);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setView(null);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active, connectionId]);

  /** Saves the choice unless it is already what is stored. Returns whether the account is bound. */
  const save = useCallback(async (): Promise<boolean> => {
    if (!botId) return false;
    const stored = view?.binding;
    if (stored && stored.botId === botId && stored.enabled) return true;
    setSaving(true);
    setError(null);
    try {
      setView(await api.putExternalMessaging(connectionId, { enabled: true, botId }));
      return true;
    } catch {
      setError("save");
      return false;
    } finally {
      setSaving(false);
    }
  }, [botId, connectionId, view]);

  return { loaded, supported: Boolean(view?.supported), bots, botId, setBotId, save, saving, error, bound: Boolean(view?.binding) };
}

export function ExternalBotChoice({ choice, disabled }: { choice: ReturnType<typeof useExternalBotChoice>; disabled?: boolean }) {
  const { t } = useI18n();
  if (!choice.supported) return null;
  const options = choice.bots.map((bot) => ({ value: bot.id, label: bot.name }));
  // A bound Bot that is no longer active stays visible so the page never silently swaps it.
  if (choice.botId && !options.some((option) => option.value === choice.botId))
    options.unshift({ value: choice.botId, label: t("Unavailable Bot") });
  return (
    <div className="mt-3">
      <PluginField label={t("Bot for this account")} help={t("Messages sent to this account go to this Bot, and its replies come back here.")}>
        <PluginSelect
          className={inputClass}
          label={t("Bot for this account")}
          value={choice.botId}
          onChange={choice.setBotId}
          disabled={disabled || choice.saving}
          options={[{ value: "", label: t("Choose a Bot…") }, ...options]}
        />
      </PluginField>
      {choice.error ? (
        <p role="alert" className="mt-1 text-[10.5px] text-red-600 dark:text-red-400">
          {t("Could not save the Bot choice. Try again.")}
        </p>
      ) : null}
    </div>
  );
}
