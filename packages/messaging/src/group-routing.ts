export const GROUP_MAX_MEMBERS = 6;
export const GROUP_MAX_ROUNDS = 3;
export const GROUP_MAX_MEMBER_TURNS = 10;
export const GROUP_MAX_MESSAGES_PER_TURN = 3;
export const EVERYONE_MENTION_ID = "__everyone__";

export interface GroupMentionMember {
  id: string;
  name: string;
}

export interface GroupRoutingMessage {
  sender: "user" | "agent" | "system";
  content: string;
}

export interface GroupVisibilityWindow {
  rootSequence: bigint;
  triggerSequence: bigint;
  lastTargetSequence: bigint | null;
  earlierRunIds: readonly string[];
}

/**
 * Keep the round's original room snapshot frozen at the trigger while admitting
 * only outputs authored by members that have already held this round's baton.
 */
export const groupVisibilityClauses = ({
  triggerSequence,
  lastTargetSequence,
  earlierRunIds,
}: GroupVisibilityWindow) => [
  {
    sequence: {
      ...(lastTargetSequence === null ? {} : { gt: lastTargetSequence }),
      lte: triggerSequence,
    },
  },
  ...(earlierRunIds.length > 0
    ? [
        {
          sender: "agent" as const,
          sourceRunId: { in: [...new Set(earlierRunIds)] },
          sequence: { gt: triggerSequence },
        },
      ]
    : []),
];

const normalizeHandle = (value: string) => value.toLocaleLowerCase("en-US");

export const groupMemberMentionHandles = (name: string): string[] => {
  const normalized = normalizeHandle(name.trim());
  if (!normalized) return [];
  const compact = normalized.replace(/\s+/g, "");
  const first = normalized.split(/\s+/)[0] ?? "";
  return [...new Set([normalized, compact, first].filter(Boolean))];
};

const hasMention = (text: string, handle: string): boolean => {
  const needle = `@${handle}`;
  for (let index = text.indexOf(needle); index >= 0; index = text.indexOf(needle, index + 1)) {
    const before = text[index - 1],
      after = text[index + needle.length];
    if (!(before && /[a-z0-9]/.test(before)) && !(after && /[a-z0-9]/.test(after))) return true;
  }
  return false;
};

export const parseGroupMentions = (
  text: string,
  members: readonly GroupMentionMember[]
): { isEveryone: boolean; memberIds: string[] } => {
  const lower = normalizeHandle(text);
  const isEveryone = /(?:^|[^a-z0-9])@(everyone|all)\b/.test(lower);
  const memberIds = members
    .filter((member) =>
      groupMemberMentionHandles(member.name).some((handle) => hasMention(lower, handle))
    )
    .map((member) => member.id);
  return { isEveryone, memberIds };
};

export const resolveGroupResponderIds = (
  members: readonly GroupMentionMember[],
  history: readonly GroupRoutingMessage[],
  options: { attachmentOnlyFirstRound?: boolean } = {}
): string[] => {
  if (options.attachmentOnlyFirstRound) return members.map((member) => member.id);
  let lastUserIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.sender === "user") {
      lastUserIndex = index;
      break;
    }
  }
  const routingText = history
    .slice(lastUserIndex < 0 ? 0 : lastUserIndex)
    .map((message) => message.content)
    .join("\n");
  const mentions = parseGroupMentions(routingText, members);
  if (mentions.isEveryone || mentions.memberIds.length === 0) {
    return members.map((member) => member.id);
  }
  return mentions.memberIds;
};

export const rotateGroupResponders = (
  memberIds: readonly string[],
  roundIndex: number
): string[] => {
  if (memberIds.length < 2) return [...memberIds];
  const offset = ((roundIndex % memberIds.length) + memberIds.length) % memberIds.length;
  return [...memberIds.slice(offset), ...memberIds.slice(0, offset)];
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const containsAsciiWord = (text: string, phrase: string): boolean => {
  const pattern = new RegExp(
    `(?:^|[^a-z0-9])${escapeRegExp(phrase)}(?=$|[^a-z0-9])`,
    "i"
  );
  return pattern.test(text);
};

/**
 * Speech recognition writes a name by sound, so 小菲 may come back as 小飞. Characters that
 * are commonly confused for each other fold to one before names are compared.
 */
const HOMOPHONE_GROUPS = ["飞菲非妃绯啡", "满曼蛮瞒", "小晓", "明名鸣", "李里理", "张章", "王汪", "林琳霖"];
const HOMOPHONES = new Map(HOMOPHONE_GROUPS.flatMap((group) => [...group].map((char) => [char, group[0]!] as const)));
const foldHomophones = (value: string) => [...value].map((char) => HOMOPHONES.get(char) ?? char).join("");

/** Spoken ways of addressing every participant, which a transcript never writes as @everyone. */
const COLLECTIVE_PHRASES_ZH = ["所有人", "大家", "你们", "你俩", "两位", "各位", "诸位"];
const COLLECTIVE_PHRASES_EN = ["everyone", "everybody", "you two", "you both", "both of you", "you all", "all of you", "y'all"];

export const resolveVoiceResponders = (
  text: string,
  participants: readonly GroupMentionMember[],
  defaultBotId: string
): string[] => {
  const normalized = normalizeHandle(text);
  if (
    COLLECTIVE_PHRASES_ZH.some((phrase) => normalized.includes(phrase)) ||
    COLLECTIVE_PHRASES_EN.some((phrase) => containsAsciiWord(normalized, phrase))
  ) {
    return participants.map((participant) => participant.id);
  }

  const compactText = foldHomophones(normalized.replace(/\s+/g, ""));
  const matched = participants
    .map((participant) => {
      const name = normalizeHandle(participant.name.trim());
      const compactName = foldHomophones(name.replace(/\s+/g, ""));
      const found = /[^\x00-\x7f]/.test(name)
        ? compactText.includes(compactName)
        : containsAsciiWord(normalized, name);
      return found ? { participant, name, compactName } : null;
    })
    .filter((match): match is { participant: GroupMentionMember; name: string; compactName: string } => Boolean(match));
  const longestMatches = matched.filter(
    (match) => !matched.some((other) => other !== match && other.compactName.includes(match.compactName) && other.compactName.length > match.compactName.length)
  );
  return longestMatches.length > 0
    ? participants.filter((participant) => longestMatches.some((match) => match.participant.id === participant.id)).map((participant) => participant.id)
    : [defaultBotId];
};

/**
 * Members a voice reply hands the floor to: those it names with @, minus its author.
 * A reply that names nobody ends the relay. A model may still know a member by an old
 * name, so one @ that matches nobody, in a room with a single other member, still reaches them.
 */
export const resolveRelayResponders = (
  text: string,
  participants: readonly GroupMentionMember[],
  authorBotId: string | null
): string[] => {
  const others = participants.filter((participant) => participant.id !== authorBotId);
  const named = parseGroupMentions(text, others);
  if (named.isEveryone) return others.map((participant) => participant.id);
  if (named.memberIds.length > 0) return named.memberIds;
  return others.length === 1 && /(?:^|[^a-z0-9])@\S/i.test(text) ? [others[0]!.id] : [];
};

/**
 * Whether a room turn calls on this bot directly, so staying silent would leave the caller
 * without an answer. Every responder of a voice round was picked by name or as the default
 * speaker. In a text room only a user's @ names the bot.
 */
export const isAddressedTurn = (
  turn: { rootIsVoice: boolean; triggerIsUser: boolean; triggerContent: string },
  bot: GroupMentionMember
): boolean => {
  if (turn.rootIsVoice) return true;
  if (!turn.triggerIsUser) return false;
  const mentions = parseGroupMentions(turn.triggerContent, [bot]);
  return mentions.isEveryone || mentions.memberIds.length > 0;
};
