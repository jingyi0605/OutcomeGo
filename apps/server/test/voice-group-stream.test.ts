import { describe, expect, test } from "bun:test";
import { VoiceService } from "../src/services/voice-service";

type Spoken = { text: string; speakerBotId: string; onAudible: () => void; generation: number };

/**
 * A voice service wired to a hand-made database and one fake connection, so the
 * room-reply flow can be driven without a server, a socket or a speech provider.
 */
function fixture() {
  const sent: Array<Record<string, unknown>> = [];
  const spoken: Spoken[] = [];
  const generation = { current: 3 };
  const message = { id: "m1", clientId: "tool:call-1", content: "我站正方。AI 让能力变便宜。@小菲 到你了。", senderBotId: "man", senderBot: { id: "man", voice: "v-man" } };
  const turn = { id: "turn", sessionId: "session", assistantMessageIds: [] as string[], generation: 0 };
  const prisma = {
    run: {
      findUnique: async () => ({
        id: "run",
        botId: "man",
        bot: { voice: "v-man" },
        delivery: { roundId: "round", round: { id: "round", channelId: "room", rootMessageId: "root" } },
      }),
    },
    channelMessage: {
      findUnique: async () => ({ metadata: { voice: { sessionId: "session", turnId: "turn" } } }),
      findMany: async () => [message],
    },
    bot: { findMany: async () => [{ name: "小满" }, { name: "小菲" }] },
    voiceTurn: { findUnique: async () => turn, update: async () => turn },
  };
  const service = new VoiceService(prisma as never, {} as never, {} as never) as any;
  service.connections.set("session", {
    media: { get currentGeneration() { return generation.current; } },
    send: (message: Record<string, unknown>) => void sent.push(message),
  });
  service.groupAnswerSinks.set("session", async (input: Spoken) => void spoken.push(input));
  return { service, sent, spoken, generation, message };
}

describe("a room reply spoken while it is being written", () => {
  test("each sentence is spoken at once, with the speaker's voice and no @ mention", async () => {
    const { service, spoken } = fixture();
    expect(await service.speakChunk("run", "call-1", "我站正方。")).toBe(true);
    expect(await service.speakChunk("run", "call-1", "AI 让能力变便宜。@小菲 到你了。")).toBe(true);
    expect(spoken.map((item) => item.text)).toEqual(["我站正方。", "AI 让能力变便宜。 到你了。"]);
    expect(spoken.every((item) => item.speakerBotId === "man")).toBe(true);
  });

  test("the caption appears with the first sentence's voice, not with each one", async () => {
    const { service, sent, spoken } = fixture();
    await service.speakChunk("run", "call-1", "我站正方。");
    await service.speakChunk("run", "call-1", "AI 让能力变便宜。");
    expect(sent).toEqual([]);
    spoken[0]!.onAudible();
    spoken[1]!.onAudible();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "reply.message", text: "我站正方。", speakerBotId: "man" });
  });

  test("once the reply is saved, only the part not yet spoken is read and the caption is replaced", async () => {
    const { service, sent, spoken } = fixture();
    await service.speakChunk("run", "call-1", "我站正方。");
    await service.speakChunk("run", "call-1", "AI 让能力变便宜。");
    spoken.length = 0;
    await service.onGroupDeliverySettled({ runId: "run", roundId: "round" });
    expect(spoken.map((item) => item.text)).toEqual([" 到你了。".trim()]);
    spoken[0]!.onAudible();
    expect(sent.at(-1)).toMatchObject({ type: "reply.message", messageId: "m1", replaces: "stream:run:call-1", text: expect.stringContaining("到你了") });
  });

  test("a reply that was never streamed is read in full as before", async () => {
    const { service, spoken } = fixture();
    await service.onGroupDeliverySettled({ runId: "run", roundId: "round" });
    expect(spoken.map((item) => item.text)).toEqual(["我站正方。AI 让能力变便宜。 到你了。"]);
  });

  test("after the user cuts in, the rest of the reply is neither streamed nor re-read", async () => {
    const { service, spoken, generation } = fixture();
    await service.speakChunk("run", "call-1", "我站正方。");
    generation.current += 1;
    expect(await service.speakChunk("run", "call-1", "AI 让能力变便宜。")).toBe(false);
    spoken.length = 0;
    await service.onGroupDeliverySettled({ runId: "run", roundId: "round" });
    expect(spoken).toEqual([]);
  });

  test("a run outside a voice call is not spoken", async () => {
    const { service } = fixture();
    service.groupRunOwners.set("other", null);
    expect(await service.speakChunk("other", "call-1", "我站正方。")).toBe(false);
  });
});
