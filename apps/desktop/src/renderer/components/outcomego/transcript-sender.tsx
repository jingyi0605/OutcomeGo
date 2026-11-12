import type { BotView } from "@outcomego/contracts";
import { HoverCard } from "radix-ui";
import { useState, type CSSProperties } from "react";
import { groupSenderColors } from "../../lib/group-chat-presentation";
import { useI18n } from "../../lib/i18n";
import { BotAvatar } from "./avatar";

export function TranscriptSenderName({
  bot,
  name,
  onOpenChat,
}: {
  bot?: BotView;
  name: string;
  onOpenChat?: (botId: string) => void;
}) {
  const { t } = useI18n();
  const [light, dark] = groupSenderColors(bot?.color);
  const style = { "--sender-light": light, "--sender-dark": dark } as CSSProperties;
  return bot && onOpenChat ? (
    <button
      aria-label={t("Open {name}'s chat", { name })}
      className="group-sender-name"
      data-message-agent-name=""
      onClick={() => onOpenChat(bot.id)}
      style={style}
      type="button"
    >
      {name}
    </button>
  ) : (
    <span className="group-sender-name" data-message-agent-name="" style={style}>
      {name}
    </span>
  );
}

export function TranscriptSenderAvatar({
  bot,
  name,
  onOpenChat,
  onOpenProfile,
}: {
  bot?: BotView;
  name: string;
  onOpenChat?: (botId: string) => void;
  onOpenProfile?: (botId: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const avatar = <BotAvatar bot={bot} mode="still" size="sm" />;
  if (!bot || !onOpenChat) return avatar;
  return (
    <HoverCard.Root open={open} onOpenChange={setOpen} openDelay={350} closeDelay={200}>
      <HoverCard.Trigger asChild>
        <button
          aria-label={t("Open {name}'s chat", { name })}
          className="group-sender-avatar"
          onClick={() => {
            setOpen(false);
            onOpenChat(bot.id);
          }}
          type="button"
        >
          {avatar}
        </button>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          align="start"
          side="top"
          sideOffset={6}
          className="group-sender-profile floating-surface"
          aria-label={t("{name}'s profile", { name })}
          onEscapeKeyDown={() => setOpen(false)}
        >
          <div className="flex min-w-0 items-center gap-2">
            <BotAvatar bot={bot} size="md" mode="still" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium leading-[18px]">{name}</div>
            </div>
          </div>
          <div className="mt-2.5 flex gap-1.5">
            <button
              className="group-sender-profile-action"
              onClick={() => {
                setOpen(false);
                onOpenChat(bot.id);
              }}
              type="button"
            >
              {t("Open chat")}
            </button>
            {onOpenProfile && (
              <button
                className="group-sender-profile-action"
                onClick={() => {
                  setOpen(false);
                  onOpenProfile(bot.id);
                }}
                type="button"
              >
                {t("Edit Profile")}
              </button>
            )}
          </div>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
