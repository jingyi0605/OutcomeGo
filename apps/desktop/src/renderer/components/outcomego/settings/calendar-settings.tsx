import type { PluginSettingsView } from "@outcomego/contracts";
import type { CalendarFeedKind, CalendarFeedView, CreatedCalendarFeed, ExternalCalendarSummary } from "@outcomego/contracts/task-overview";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../client/outcomego-api";
import { useI18n } from "../../../lib/i18n";
import { settingsInput, settingsSecondaryButton, SettingsGroup, SettingsRow } from "./ui";

const STORAGE_KEY = "outcomego.goal-calendar";
const FEED_KINDS: readonly CalendarFeedKind[] = ["goal_due", "human_task", "work_item", "todo", "follow_up", "routine_run"];
const labels: Record<CalendarFeedKind, string> = {
  goal_due: "Goal deadlines",
  human_task: "Human tasks",
  work_item: "Bot tasks",
  todo: "To-dos",
  follow_up: "Follow-ups",
  routine_run: "Routines",
};

type ExternalSelection = { connectionId: string; calendarId: string; busyOnly: boolean };

function readSelection(): ExternalSelection {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<ExternalSelection>;
    return { connectionId: value.connectionId ?? "", calendarId: value.calendarId ?? "", busyOnly: value.busyOnly === true };
  } catch {
    return { connectionId: "", calendarId: "", busyOnly: false };
  }
}

function saveSelection(value: ExternalSelection) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("outcomego:external-calendar-changed"));
}

export function CalendarSettings() {
  const { t } = useI18n();
  const [feeds, setFeeds] = useState<CalendarFeedView[]>([]);
  const [created, setCreated] = useState<CreatedCalendarFeed | null>(null);
  const [name, setName] = useState("");
  const [kinds, setKinds] = useState<CalendarFeedKind[]>([...FEED_KINDS]);
  const [includeLinks, setIncludeLinks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pluginSettings, setPluginSettings] = useState<PluginSettingsView | null>(null);
  const [selection, setSelection] = useState<ExternalSelection>(() => readSelection());
  const [calendars, setCalendars] = useState<ExternalCalendarSummary[]>([]);
  const connections = useMemo(
    () => pluginSettings?.installs.flatMap((install) => install.pluginKey === "google-calendar" ? install.connections.filter((connection) => connection.connectorKey === "calendar") : []) ?? [],
    [pluginSettings],
  );

  useEffect(() => {
    void Promise.all([api.calendarFeeds.list().then((value) => setFeeds(value.items)), api.pluginSettings().then(setPluginSettings)]).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!selection.connectionId) {
      setCalendars([]);
      return;
    }
    void api.externalCalendar.calendars(selection.connectionId).then((value) => {
      setCalendars(value.calendars);
      if (!value.calendars.some((calendar) => calendar.id === selection.calendarId)) {
        const next = value.calendars[0]?.id ?? "";
        setSelection((current) => {
          const updated = { ...current, calendarId: next };
          saveSelection(updated);
          return updated;
        });
      }
    }).catch(() => setCalendars([]));
  }, [selection.connectionId, selection.calendarId]);

  const create = async () => {
    if (!name.trim() || !kinds.length) return;
    setBusy(true);
    try {
      const value = await api.calendarFeeds.create({ name: name.trim(), kinds, includeLinks });
      setCreated(value);
      setName("");
      setFeeds((current) => [...current, value]);
    } finally {
      setBusy(false);
    }
  };
  const rotate = async (feed: CalendarFeedView) => {
    if (!window.confirm(t("Rotate this subscription? The old address will stop working."))) return;
    const value = await api.calendarFeeds.rotate(feed.id);
    setCreated(value);
    setFeeds((current) => current.map((item) => item.id === feed.id ? value : item));
  };
  const revoke = async (feed: CalendarFeedView) => {
    if (!window.confirm(t("Revoke this subscription?"))) return;
    await api.calendarFeeds.revoke(feed.id);
    setFeeds((current) => current.filter((item) => item.id !== feed.id));
  };
  const toggleKind = (kind: CalendarFeedKind) => setKinds((current) => current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind]);

  return (
    <div className="space-y-3">
      <SettingsGroup>
        <SettingsRow title={t("Create an ICS subscription")} description={t("The address is shown once. External calendar events are never included.")} control={<div className="flex gap-1.5"><input aria-label={t("Subscription name")} className={settingsInput} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("Calendar name")} /><button type="button" className={settingsSecondaryButton} disabled={busy || !name.trim() || !kinds.length} onClick={() => void create()}>{t("Create")}</button></div>} />
        <div className="space-y-2 border-t border-black/[0.065] py-3 dark:border-white/[0.07]">
          <p className="text-[12px] text-foreground-secondary">{t("Subscription items")}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-[12px]">{FEED_KINDS.map((kind) => <label key={kind} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={kinds.includes(kind)} onChange={() => toggleKind(kind)} />{t(labels[kind])}</label>)}</div>
          <label className="inline-flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={includeLinks} onChange={(event) => setIncludeLinks(event.target.checked)} />{t("Include OutcomeGo links")}</label>
        </div>
        {created && <div role="status" className="border-t border-black/[0.065] py-3 text-[12px] dark:border-white/[0.07]"><p className="font-medium">{t("Save this address now. It will not be shown again.")}</p><code className="mt-1 block break-all rounded bg-background px-2 py-1">{created.url}</code></div>}
        {feeds.map((feed) => <div key={feed.id} className="flex items-center gap-2 border-t border-black/[0.065] py-2 text-[12px] dark:border-white/[0.07]"><span className="min-w-0 flex-1 truncate">{feed.name}</span><button type="button" className={settingsSecondaryButton} onClick={() => void rotate(feed)}>{t("Rotate")}</button><button type="button" className={settingsSecondaryButton} onClick={() => void revoke(feed)}>{t("Revoke")}</button></div>)}
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow title={t("External calendar overlay")} description={t("Read-only events from a connected Google Calendar. External events stay out of subscriptions and bot context.")} />
        <div className="space-y-2 border-t border-black/[0.065] py-3 dark:border-white/[0.07]">
          <select aria-label={t("Calendar account")} className={settingsInput} value={selection.connectionId} onChange={(event) => { const updated = { ...selection, connectionId: event.target.value, calendarId: "" }; setSelection(updated); saveSelection(updated); }}>
            <option value="">{t("Choose an account")}</option>
            {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.alias || connection.name}</option>)}
          </select>
          <select aria-label={t("External calendar")} className={settingsInput} value={selection.calendarId} disabled={!selection.connectionId} onChange={(event) => { const updated = { ...selection, calendarId: event.target.value }; setSelection(updated); saveSelection(updated); }}>
            <option value="">{t("Choose a calendar")}</option>
            {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={selection.busyOnly} onChange={(event) => { const updated = { ...selection, busyOnly: event.target.checked }; setSelection(updated); saveSelection(updated); }} />{t("Show only busy")}</label>
        </div>
      </SettingsGroup>
    </div>
  );
}
