/** The message a search result or a notification opened, when the chat was entered through one. */
export interface ChannelReadSearchTarget {
  messageId: string;
  /** The sequence of the message a notification announced, when it names one. */
  readThroughSequence?: string;
  /** True when a notification, not a search, opened the chat. */
  fromNotification?: boolean;
}

export interface ChannelReadTargetInput {
  channelKind: string | undefined;
  search: ChannelReadSearchTarget | undefined;
  /** Messages the open transcript shows, oldest first. */
  transcript: ReadonlyArray<{ id: string; sequence?: string | null }> | undefined;
  /** Sequence of the newest message in the snapshot for this channel. */
  newestKnown: string | undefined;
  lastReadNotificationSequence?: string;
  notificationCursor?: string;
}

export interface ChannelReadTarget {
  throughSequence: string;
  throughNotificationSequence: string;
}

const numeric = (value: string | null | undefined): string | undefined =>
  value && /^\d+$/.test(value) ? value : undefined;

/**
 * The highest sequence among a channel's known messages. The snapshot does not keep messages in
 * sequence order once a history window is loaded, so the last one is not necessarily the newest.
 */
export const newestSequence = (
  messages: ReadonlyArray<{ sequence?: string | null }> | undefined
): string | undefined => {
  let newest: bigint | undefined;
  for (const message of messages ?? []) {
    const sequence = numeric(message.sequence);
    if (sequence === undefined) continue;
    const value = BigInt(sequence);
    if (newest === undefined || value > newest) newest = value;
  }
  return newest?.toString();
};

/**
 * How far a visit to a channel marks it read.
 *
 * A Bot chat is read through its newest message when it is entered or opened from a notification.
 * The server's read marker also drives the floating window's badge, and a marker that stops at the
 * announced message leaves a later settled reply counted there while the chat is already open. A
 * search jump into older history, and every other channel, keep the older mark: the user has not
 * seen what came after.
 */
export const channelReadTarget = (input: ChannelReadTargetInput): ChannelReadTarget | null => {
  const { search, transcript } = input;
  const toNewest = input.channelKind === "bot_dm" && (!search || search.fromNotification === true);
  const newest = numeric(input.newestKnown);
  const shown = transcript?.at(-1)?.sequence;
  const notified =
    !toNewest && search
      ? (transcript?.find((message) => message.id === search.messageId)?.sequence ??
        search.readThroughSequence)
      : undefined;
  const throughSequence = numeric(toNewest ? (newest ?? shown) : (notified ?? shown));
  if (!throughSequence) return null;
  const notifiedSequence = numeric(notified);
  const viewingOlder =
    notifiedSequence !== undefined &&
    newest !== undefined &&
    BigInt(notifiedSequence) < BigInt(newest);
  return {
    throughSequence,
    throughNotificationSequence: viewingOlder
      ? (input.lastReadNotificationSequence ?? "0")
      : (input.notificationCursor ?? "0"),
  };
};
