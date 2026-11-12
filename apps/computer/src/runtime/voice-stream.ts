/** A spoken chunk is held back until it is at least this long, so tiny sentences do not each open a synthesis connection. */
export const MIN_CHUNK_CHARS = 8;

const HARD_STOPS = new Set(["。", "！", "？", "；", "\n"]);
const SOFT_STOPS = new Set([".", "!", "?"]);

/**
 * Index just past the last complete sentence in `text[from..]` that leaves at least
 * `minChars` to speak, or `from` when there is none yet. A Latin stop only counts once the
 * next character shows it is not part of a number or abbreviation, so a stop at the very end
 * of the partial text waits for more.
 */
export const sentenceEnd = (text: string, from: number, minChars = MIN_CHUNK_CHARS): number => {
  let end = from;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]!;
    const stops =
      HARD_STOPS.has(char) ||
      (SOFT_STOPS.has(char) && index + 1 < text.length && /\s/.test(text[index + 1]!));
    if (stops && index + 1 - from >= minChars) end = index + 1;
  }
  return end;
};

type SendArguments = { type?: unknown; content?: unknown; channel?: unknown; to?: unknown };

/**
 * Hands the finished sentences of a SendToUser message to the voice session while the model is
 * still writing the rest, so speech starts before the whole tool call has been generated.
 * Chunks go out one at a time in order; a failed chunk ends streaming for that call and the
 * server speaks everything after the last chunk it received once the message is saved.
 */
export class SendToUserSpeech {
  private readonly emitted = new Map<string, number>();
  private readonly broken = new Set<string>();
  private chain: Promise<void> = Promise.resolve();

  /**
   * `toRoom` is for a turn that belongs to a group call, where SendToUser already posts to the room
   * and `to: "dm"` is the private exception. Otherwise a plain message goes to the user's own chat.
   */
  constructor(
    private readonly send: (callId: string, text: string) => Promise<void>,
    private readonly options: { toRoom?: boolean } = {}
  ) {}

  observe(callId: string, args: SendArguments | undefined): void {
    if (!args || (args.type ?? "text") !== "text" || typeof args.content !== "string") return;
    // A call with one bot speaks only a plain message to the user's own chat. In a group call the
    // plain message goes to the room, so only an explicit channel or a private "dm" is left unspoken.
    const spoken = this.options.toRoom
      ? args.channel === undefined && args.to !== "dm"
      : args.channel === undefined && args.to === undefined;
    if (!spoken) return;
    if (this.broken.has(callId)) return;
    const content = args.content;
    // Inside an open code fence the text is not meant to be read out.
    if ((content.match(/```/g)?.length ?? 0) % 2 === 1) return;
    const from = this.emitted.get(callId) ?? 0;
    const end = sentenceEnd(content, from);
    if (end <= from) return;
    this.emitted.set(callId, end);
    const chunk = content.slice(from, end);
    this.chain = this.chain
      .then(() => (this.broken.has(callId) ? undefined : this.send(callId, chunk)))
      .catch(() => void this.broken.add(callId));
  }

  /** Characters of this call's message already handed over. */
  emittedChars(callId: string): number {
    return this.emitted.get(callId) ?? 0;
  }

  /** Resolves once every chunk so far has reached the server, so the saved message can be reconciled against them. */
  flush(): Promise<void> {
    return this.chain;
  }
}

/** Feeds SendToUser's partial arguments to the speaker as the model streams them. */
export function sendToUserSpeechExtension(speech: SendToUserSpeech): {
  name: string;
  hidden: boolean;
  factory: import("@earendil-works/pi-coding-agent").ExtensionFactory;
} {
  return {
    name: "outcomego-send-to-user-speech",
    hidden: true,
    factory(pi) {
      pi.on("message_update", (event) => {
        const update = event.assistantMessageEvent;
        if (update.type !== "toolcall_delta") return;
        const block = update.partial.content[update.contentIndex];
        if (block?.type === "toolCall" && block.name === "SendToUser")
          speech.observe(block.id, block.arguments);
      });
    },
  };
}
