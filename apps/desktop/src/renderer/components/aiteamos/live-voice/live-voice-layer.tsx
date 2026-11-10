import type { BotView } from "@aiteamos/contracts";
import {
  ChevronDown,
  Mic,
  MicOff,
  Minimize2,
  PhoneCall,
  PhoneOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLiveVoice } from "../../../hooks/use-live-voice";
import { useI18n } from "../../../lib/i18n";
import { translateCurrent } from "../../../lib/i18n-catalog";
import { BotAvatar } from "../avatar";
import { Button } from "../../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import "./live-voice.css";

export function LiveVoiceLayer({
  bot,
  channelId,
  compact = false,
}: {
  bot: Pick<BotView, "id" | "name" | "title" | "color" | "icon" | "hasAvatar" | "updatedAt">;
  channelId: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const voice = useLiveVoice(bot.id, channelId);
  const active = voice.state !== "idle";
  const captions = useRef<HTMLDivElement>(null);
  const followCaptions = useRef(true);

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
    void voice.start();
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
            <BotAvatar bot={bot} size="md" className="!size-full" />
          </span>
          <span className="live-voice-mini-copy">
            <strong>{bot.name}</strong>
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
          <div className="live-voice-dialog">
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
                <h2 id="live-voice-title">{bot.name}</h2>
                <p>{bot.title || t("Talk with your assistant")}</p>
              </div>
              <span aria-label={t("Call duration {elapsed}", { elapsed })} className="live-voice-duration">
                {elapsed}
              </span>
            </header>

            <div className="live-voice-main">
              <div className="live-voice-avatar-column">
                <div
                  className="live-voice-avatar-halo"
                  data-live-voice-speaking={voice.state === "speaking"}
                >
                  <div className="live-voice-avatar">
                    <BotAvatar bot={bot} size="lg" className="!size-full" />
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

              <div
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
                {voice.transcript.map((entry) => (
                  <article
                    className={`live-voice-caption live-voice-caption-${entry.role}`}
                    key={entry.id}
                  >
                    <span className="live-voice-caption-label">
                      {entry.role === "assistant" ? bot.name : t("You")}
                    </span>
                    <p>{entry.text}</p>
                  </article>
                ))}
                {voice.partialText ? (
                  <article className="live-voice-caption live-voice-caption-user live-voice-caption-partial">
                    <span className="live-voice-caption-label">{t("You · listening")}</span>
                    <p>{voice.partialText}</p>
                  </article>
                ) : null}
                {voice.error ? (
                  <p className="live-voice-error" role="alert">
                    {voice.error}
                  </p>
                ) : null}
              </div>
            </div>

            <footer className="live-voice-controls">
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
            </footer>

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
