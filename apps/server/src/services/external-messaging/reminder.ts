import type { PrismaClient } from "@outcomego/db";
import type { ExternalDeliveryService } from "./delivery";
import { messagingOf } from "./shared";

/** Longest a reminder is still sent after its time (a restarted Server catches up, a changed time does not fire at once). */
export const REMINDER_GRACE_MINUTES = 6 * 60;
/** A reply this long after a reminder is no longer taken to be the answer to it. */
export const REMINDER_ANSWER_WINDOW_MS = 36 * 60 * 60 * 1000;
export const REMINDER_CHECK_INTERVAL_MS = 60_000;

export const REMINDER_TEXT =
  "【续期提醒】今天还没有收到你的消息。随便回复一条（比如 1）就能保持微信通道畅通，Bot 不会处理这条回复。\n" +
  "Reminder: reply with anything (e.g. 1) to keep this channel open. Your Bot will not act on that reply.";

const ACK_WORDS = new Set(["ok", "okay", "k", "好", "好的", "嗯", "嗯嗯", "收到", "在", "在的", "续期", "已读"]);

/**
 * Whether a message is only the "I'm here" answer to a reminder: anything of one or two characters
 * (a "1", "好", "ok", "你好"), a few digits, punctuation or symbols (a thumbs-up), a short
 * acknowledgement, or a WeChat emoji such as `[微笑]`. Anything longer with words in it is a real
 * message. Only ever applied while a reminder is waiting for its answer.
 */
export const isRenewalReply = (text: string): boolean => {
  const value = text.normalize("NFKC").trim().toLowerCase();
  const length = [...value].length;
  if (length <= 2) return true;
  if (length <= 4 && /^[\p{N}\p{P}\p{S}\s]+$/u.test(value)) return true;
  if (ACK_WORDS.has(value)) return true;
  return /^\[[^\[\]\s]{1,8}\]$/.test(value);
};

/** The local calendar date and minutes since midnight in a time zone. An unknown zone falls back to UTC. */
export const localTime = (at: Date, timeZone: string): { date: string; minutes: number } => {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  } catch {
    return localTime(at, "UTC");
  }
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
};

const minutesOf = (time: string): number => {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

export interface ReminderDependencies {
  prisma: PrismaClient;
  delivery: Pick<ExternalDeliveryService, "sendNotice">;
  /** The user's time zone, as set in the app. */
  timeZone: () => Promise<string>;
  now?: () => Date;
}

/**
 * The daily nudge for platforms that only accept a reply for a limited time after the person last
 * wrote (specs/009). At the chosen local time, if the person has not written today, it sends one
 * short message asking them to. At most one per binding per day: the day is claimed before sending,
 * and a failed or doubtful send is recorded, not retried.
 */
export class ExternalReminderService {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly now: () => Date;

  constructor(private readonly deps: ReminderDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    const run = () => void this.tick().catch((cause) => console.error("external reminder", cause instanceof Error ? cause.message : "failed"));
    run();
    this.timer = setInterval(run, REMINDER_CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass. Returns how many reminders it tried to send. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const { prisma } = this.deps;
      const at = this.now();
      const zone = await this.deps.timeZone();
      const today = localTime(at, zone);
      const bindings = await prisma.externalMessagingBinding.findMany({
        where: {
          enabled: true,
          status: "active",
          reminderEnabled: true,
          connection: { status: "ready", installation: { status: "installed" } },
          OR: [{ lastReminderOn: null }, { lastReminderOn: { not: today.date } }],
        },
        include: { connection: { include: { installation: true } } },
      });
      let attempted = 0;
      for (const binding of bindings) {
        if (!messagingOf(binding.connection)?.replyWindow) continue;
        const late = today.minutes - minutesOf(binding.reminderTime);
        if (late < 0 || late >= REMINDER_GRACE_MINUTES) continue;
        const mappings = await prisma.externalChannelMapping.findMany({
          where: { connectionId: binding.connectionId, botId: binding.botId, status: "active" },
        });
        // Someone who has never written cannot be answered, and someone who wrote today needs no nudge.
        const targets = mappings.filter((mapping) => mapping.lastInboundAt && localTime(mapping.lastInboundAt, zone).date !== today.date);
        if (targets.length === 0) continue;
        const claimed = await prisma.externalMessagingBinding.updateMany({
          where: { id: binding.id, enabled: true, reminderEnabled: true, OR: [{ lastReminderOn: null }, { lastReminderOn: { not: today.date } }] },
          data: { lastReminderOn: today.date, lastReminderAt: at, lastReminderOutcome: null },
        });
        if (claimed.count !== 1) continue;
        attempted += 1;
        let outcome: "sent" | "failed" | "uncertain" = "failed";
        for (const mapping of targets) {
          const result = await this.deps.delivery
            .sendNotice({ mappingId: mapping.id, text: REMINDER_TEXT, key: `reminder:${binding.id}:${today.date}:${mapping.id}` })
            .catch(() => null);
          const status = result?.status === "sent" ? "sent" : result?.status === "uncertain" ? "uncertain" : "failed";
          if (status === "sent" || (status === "uncertain" && outcome === "failed")) outcome = status;
        }
        await prisma.externalMessagingBinding.update({ where: { id: binding.id }, data: { lastReminderOutcome: outcome } });
      }
      return attempted;
    } finally {
      this.running = false;
    }
  }
}
