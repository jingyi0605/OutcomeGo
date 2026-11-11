import type { BotView } from "@aiteamos/contracts";
import {
  Check,
  ChevronDown,
  Mic,
  MicOff,
  Minimize2,
  PhoneCall,
  PhoneOff,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLiveVoice } from "../../../hooks/use-live-voice";
import { useAuthSession } from "../../../hooks/use-auth-session";
import { accountPresentation } from "../../../lib/account";
import { useI18n } from "../../../lib/i18n";
import { translateCurrent } from "../../../lib/i18n-catalog";
import { BotAvatar } from "../avatar";
import { Button } from "../../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import "./live-voice.css";

export function LiveVoiceLayer({
  bot,
  bots = [bot],
  channelId,
  group = false,
  compact = false,
}: {
  bot: Pick<BotView, "id" | "name" | "title" | "color" | "icon" | "hasAvatar" | "updatedAt">;
  bots?: Array<Pick<BotView, "id" | "name" | "title" | "color" | "icon" | "hasAvatar" | "updatedAt">>;
  channelId: string;
  group?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const auth = useAuthSession();
  const account = accountPresentation(auth.user, auth.mode);
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [selectedBotIds, setSelectedBotIds] = useState(() => bots.map((member) => member.id));
  const [defaultSpeakerId, setDefaultSpeakerId] = useState(bot.id);
  const participantBotIds = useMemo(
    () => bots.filter((member) => selectedBotIds.includes(member.id)).map((member) => member.id),
    [bots, selectedBotIds]
  );
  const speakerId = participantBotIds.includes(defaultSpeakerId)
    ? defaultSpeakerId
    : participantBotIds[0] ?? bot.id;
  const voice = useLiveVoice(speakerId, channelId, group ? participantBotIds : undefined);
  const active = voice.state !== "idle";
  const activeSpeaker = bots.find((member) => member.id === voice.speakerBotId) ?? bot;
  const participants = bots.filter((member) => participantBotIds.includes(member.id));
  const captions = useRef<HTMLDivElement>(null);
  const followCaptions = useRef(true);

  useEffect(() => {
    if (!group || voice.state !== "idle") return;
    const ids = bots.map((member) => member.id);
    setSelectedBotIds(ids);
    setDefaultSpeakerId(ids[0] ?? bot.id);
  }, [bot.id, bots, group, voice.state]);

  useEffect(() => {
    if (!open || minimized || !followCaptions.current) return;
    const element = captions.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [open, minimized, voice.partialText, voice.transcript]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !minimized) {
        event.preventDefault();
        void voice.stop().finally(() => setOpen(false));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [minimized, open, voice.stop]);

  const start = () => {
    setOpen(true);
    setMinimized(false);
    if (!group) void voice.start();
  };

  const beginGroupCall = () => {
    if (participantBotIds.length === 0) return;
    setMinimized(false);
    void voice.start();
  };

  const toggleParticipant = (botId: string) => {
    setSelectedBotIds((current) =>
      current.includes(botId) ? current.filter((id) => id !== botId) : [...current, botId]
    );
    if (botId === defaultSpeakerId && selectedBotIds.includes(botId)) {
      const replacement = participantBotIds.find((id) => id !== botId);
      if (replacement) setDefaultSpeakerId(replacement);
    }
  };

  const close = () => {
    void voice.stop().finally(() => {
      setOpen(false);
      setMinimized(false);
    });
  };

  const elapsed = formatElapsed(voice.elapsedMs);
  const launcherLabel = voice.available
    ? t("Start realtime voice conversation")
    : t("Realtime voice is disabled or not configured");

  return (
    <div
      className={`live-voice-layer${compact ? " live-voice-layer-compact" : ""}`}
      data-live-voice-state={voice.state}
    >
      {!active && !open ? (
        compact ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={launcherLabel}
                className="rounded-full text-foreground-tertiary"
                onClick={start}
                size="icon-sm"
                variant="ghost"
              >
                <PhoneCall className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {voice.available
                ? t("Start realtime voice conversation")
                : t("Check realtime voice settings and start a conversation")}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Button
            aria-label={launcherLabel}
            className="live-voice-launcher gap-1.5 rounded-full px-3"
            onClick={start}
            size="sm"
            title={
              voice.available
                ? t("Start realtime voice conversation")
                : t("Check realtime voice settings and start a conversation")
            }
            variant="outline"
          >
            <PhoneCall className="size-3.5" />
            <span>{t("Talk live")}</span>
          </Button>
        )
      ) : null}

      {open && minimized && active ? (
        <div className="live-voice-minimized" role="status">
          <span className="live-voice-mini-avatar">
            <BotAvatar bot={activeSpeaker} size="md" className="!size-full" />
          </span>
          <span className="live-voice-mini-copy">
            <strong>{activeSpeaker.name}</strong>
            <span>
              {statusLabel(voice.state)} · {elapsed}
            </span>
          </span>
          <Button
            aria-label={t("Restore realtime voice")}
            className="live-voice-mini-button"
            onClick={() => setMinimized(false)}
            size="icon-sm"
            variant="ghost"
          >
            <ChevronDown className="size-4 rotate-180" />
          </Button>
          <Button
            aria-label={t("End realtime voice")}
            className="live-voice-mini-stop"
            onClick={close}
            size="icon-sm"
            variant="ghost"
          >
            <PhoneOff className="size-4" />
          </Button>
        </div>
      ) : null}

      {open && !minimized ? (
        <div
          aria-labelledby="live-voice-title"
          aria-modal="true"
          className="live-voice-overlay"
          role="dialog"
        >
          <div className={`live-voice-dialog${group ? " live-voice-dialog-group" : ""}`}>
            <header className="live-voice-header">
              <Button
                aria-label={t("Minimize realtime voice")}
                className="live-voice-minimize"
                onClick={() => setMinimized(true)}
                size="icon-sm"
                variant="ghost"
              >
                <Minimize2 className="size-4" />
              </Button>
              <div className="live-voice-heading">
                <span className="live-voice-eyebrow">{t("Realtime conversation")}</span>
                <h2 id="live-voice-title">{group ? t("Group voice conversation") : bot.name}</h2>
                <p>{group ? t("Choose who can answer and who speaks by default.") : bot.title || t("Talk with your assistant")}</p>
              </div>
              <span aria-label={t("Call duration {elapsed}", { elapsed })} className="live-voice-duration">
                {elapsed}
              </span>
            </header>

            <div className="live-voice-main">
              {group && voice.state === "idle" ? (
                <div className="flex min-w-0 flex-1 flex-col gap-4 p-5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Users className="size-4" />
                    <span>{t("Voice participants")}</span>
                  </div>
                  <div className="grid gap-2">
                    {bots.map((member) => {
                      const selectedMember = selectedBotIds.includes(member.id);
                      return (
                        <label
                          className="flex cursor-pointer items-center gap-3 rounded-xl border border-border/70 px-3 py-2.5 text-sm hover:bg-muted/50"
                          key={member.id}
                        >
                          <input
                            checked={selectedMember}
                            className="size-4 accent-primary"
                            onChange={() => toggleParticipant(member.id)}
                            type="checkbox"
                          />
                          <BotAvatar bot={member} size="sm" />
                          <span className="min-w-0 flex-1 truncate">{member.name}</span>
                          {selectedMember && member.id === speakerId ? (
                            <Check className="size-4 text-primary" />
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                  <label className="grid gap-1.5 text-sm">
                    <span className="text-muted-foreground">{t("Default speaker")}</span>
                    <select
                      className="h-9 rounded-lg border border-border bg-background px-2"
                      disabled={participantBotIds.length === 0}
                      onChange={(event) => setDefaultSpeakerId(event.target.value)}
                      value={speakerId}
                    >
                      {participantBotIds.map((id) => (
                        <option key={id} value={id}>
                          {bots.find((member) => member.id === id)?.name ?? id}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : group ? (
                <div className="live-voice-stage-column">
                  <div aria-label={t("Participants")} className="live-voice-stage" role="group">
                    <VoiceTile
                      muted={voice.microphoneMuted}
                      name={t("You")}
                      speaking={voice.userSpeaking}
                    >
                      <span className="live-voice-tile-initials">{account.initials}</span>
                    </VoiceTile>
                    {participants.map((member) => (
                      <VoiceTile
                        badge={member.id === speakerId ? t("Host") : undefined}
                        key={member.id}
                        name={member.name}
                        speaking={voice.speakerBotId === member.id}
                      >
                        <BotAvatar bot={member} size="lg" className="!size-full" />
                      </VoiceTile>
                    ))}
                  </div>
                  <div className="live-voice-state" role="status">
                    <span className="live-voice-state-dot" data-live-voice-state-dot={voice.state} />
                    {statusLabel(voice.state)}
                  </div>
                </div>
              ) : (
              <div className="live-voice-avatar-column">
                <div
                  className="live-voice-avatar-halo"
                  data-live-voice-speaking={voice.state === "speaking"}
                >
                  <div className="live-voice-avatar">
                    <BotAvatar bot={activeSpeaker} size="lg" className="!size-full" />
                  </div>
                </div>
                <div className="live-voice-state" role="status">
                  <span
                    className="live-voice-state-dot"
                    data-live-voice-state-dot={voice.state}
                  />
                  {statusLabel(voice.state)}
                </div>
              </div>
              )}

              {!(group && voice.state === "idle") ? <div
                aria-label={t("Live captions")}
                className="live-voice-captions"
                onScroll={(event) => {
                  const element = event.currentTarget;
                  followCaptions.current =
                    element.scrollHeight - element.scrollTop - element.clientHeight < 28;
                }}
                ref={captions}
                tabIndex={0}
              >
                {voice.transcript.length === 0 && !voice.partialText && !voice.error ? (
                  <div className="live-voice-empty">
                    <Mic className="size-5" />
                    <span>{t("Start speaking when you are ready.")}</span>
                  </div>
                ) : null}
                {voice.transcript.map((entry) => {
                  const speaker =
                    entry.role === "assistant"
                      ? bots.find((member) => member.id === entry.speakerBotId) ?? bot
                      : null;
                  const label = speaker ? speaker.name : t("You");
                  return (
                    <article
                      className={`live-voice-caption live-voice-caption-${entry.role}${group ? " live-voice-caption-row" : ""}`}
                      key={entry.id}
                    >
                      {group ? (
                        <span className="live-voice-caption-chip">
                          {speaker ? (
                            <BotAvatar bot={speaker} size="lg" className="!size-full" />
                          ) : (
                            account.initials
                          )}
                        </span>
                      ) : null}
                      <div className="live-voice-caption-body">
                        <span className="live-voice-caption-label">{label}</span>
                        <p>{entry.text}</p>
                      </div>
                    </article>
                  );
                })}
                {voice.partialText ? (
                  <article
                    className={`live-voice-caption live-voice-caption-user live-voice-caption-partial${group ? " live-voice-caption-row" : ""}`}
                  >
                    {group ? <span className="live-voice-caption-chip">{account.initials}</span> : null}
                    <div className="live-voice-caption-body">
                      <span className="live-voice-caption-label">{t("You · listening")}</span>
                      <p>{voice.partialText}</p>
                    </div>
                  </article>
                ) : null}
                {voice.error ? (
                  <p className="live-voice-error" role="alert">
                    {voice.error}
                  </p>
                ) : null}
              </div> : null}
            </div>

            {group && voice.state === "idle" ? (
              <footer className="live-voice-controls">
                <Button
                  className="rounded-full px-5"
                  disabled={participantBotIds.length === 0}
                  onClick={beginGroupCall}
                  variant="default"
                >
                  <PhoneCall className="mr-1.5 size-4" />
                  {t("Start group call")}
                </Button>
              </footer>
            ) : <footer className="live-voice-controls">
              <div className="live-voice-control-group">
                <Button
                  aria-label={voice.microphoneMuted ? t("Unmute microphone") : t("Mute microphone")}
                  aria-pressed={voice.microphoneMuted}
                  className="live-voice-control"
                  onClick={() => voice.setMicrophoneMuted(!voice.microphoneMuted)}
                  size="icon"
                  variant="ghost"
                >
                  {voice.microphoneMuted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
                </Button>
                <span>{voice.microphoneMuted ? t("Unmute") : t("Mute")}</span>
              </div>
              <div className="live-voice-control-group live-voice-control-stop">
                <Button
                  aria-label={t("End realtime voice")}
                  className="live-voice-control live-voice-control-hangup"
                  onClick={close}
                  size="icon"
                  variant="ghost"
                >
                  <PhoneOff className="size-5" />
                </Button>
                <span>{t("End call")}</span>
              </div>
              <div className="live-voice-control-group">
                <Button
                  aria-label={voice.speakerMuted ? t("Unmute speaker") : t("Mute speaker")}
                  aria-pressed={voice.speakerMuted}
                  className="live-voice-control"
                  onClick={() => voice.setSpeakerMuted(!voice.speakerMuted)}
                  size="icon"
                  variant="ghost"
                >
                  {voice.speakerMuted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
                </Button>
                <span>{voice.speakerMuted ? t("Unmute") : t("Speaker")}</span>
              </div>
            </footer>}

            {voice.state === "error" ? (
              <div className="live-voice-error-actions">
                <Button className="rounded-full" onClick={() => void voice.restart()} variant="secondary">
                  {t("Try again")}
                </Button>
                <Button className="rounded-full" onClick={close} variant="ghost">
                  {t("Close")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** One participant in the group call: a round face that rings and ripples while its owner speaks. */
function VoiceTile({
  name,
  speaking,
  badge,
  muted = false,
  children,
}: {
  name: string;
  speaking: boolean;
  badge?: string;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="live-voice-tile" data-live-voice-speaking={speaking}>
      <div className="live-voice-tile-avatar">
        <div className="live-voice-tile-face">{children}</div>
        {muted ? (
          <span className="live-voice-tile-muted">
            <MicOff className="size-3" />
          </span>
        ) : null}
      </div>
      <span className="live-voice-tile-name" title={name}>
        {name}
      </span>
      {badge ? <span className="live-voice-tile-badge">{badge}</span> : null}
    </div>
  );
}

/** The pill's caption. Translated here so both render sites share one catalog key. */
function statusLabel(state: string): string {
  switch (state) {
    case "connecting":
      return translateCurrent("Connecting");
    case "listening":
    case "interrupted":
      return translateCurrent("Listening");
    case "processing":
      return translateCurrent("Thinking");
    case "speaking":
      return translateCurrent("Speaking");
    case "error":
      return translateCurrent("Connection problem");
    default:
      return translateCurrent("Ready");
  }
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
