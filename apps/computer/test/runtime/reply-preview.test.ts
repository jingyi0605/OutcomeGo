import { expect, test } from "bun:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { routeEvent } from "../../src/runtime/events";
import { ReplyPreviewPublisher, RICH_REPLY_TOOL } from "../../src/runtime/reply-preview";
import { SendToUserSpeech } from "../../src/runtime/voice-stream";
import type { ActiveTurn } from "../../src/runtime/types";

const textDelta = (content: string) => ({
  type: "message_update",
  assistantMessageEvent: {
    type: "text_delta",
    delta: content,
    partial: { content: [{ type: "text", text: content }] },
  },
}) as unknown as AgentSessionEvent;

function fixture(directTextReply = true) {
  const sent: Array<[string, string | null]> = [];
  const delivered: Array<{ id: string; content: string; endTurn: boolean }> = [];
  const active = {
    directTextReply, runId: "run", assistantOrdinal: 0,
    replyPreview: new ReplyPreviewPublisher(async (id, content) => { sent.push([id, content]); }),
    startedItems: new Set(), queue: { push() {} },
    pluginAbortController: new AbortController(),
  } as unknown as ActiveTurn;
  const route = (event: unknown) => routeEvent(undefined, active, event as AgentSessionEvent, async (id, content, endTurn) => {
    delivered.push({ id, content, endTurn });
  });
  const start = () => route({ type: "message_start", message: { role: "assistant" } });
  const end = (stopReason: string, text?: string, tool = false) => route({
    type: "message_end",
    message: {
      role: "assistant", stopReason, content: [
        ...(text === undefined ? [] : [{ type: "text", text }]),
        ...(tool ? [{ type: "toolCall", id: "widget", name: RICH_REPLY_TOOL, arguments: {} }] : []),
      ],
    },
  });
  return { active, start, end, route, sent, delivered };
}

test("previews only assistant text before message end and uses the same id for delivery", () => {
  const { active, sent, delivered, start, end, route } = fixture();
  start();
  route({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta" } });
  expect(sent).toEqual([]);
  route(textDelta("The first part"));
  expect(sent).toEqual([["text:assistant:run:1", "The first part"]]);
  expect(delivered).toEqual([]);
  end("stop", "The first part of the reply.");
  expect(delivered).toEqual([{ id: "text:assistant:run:1", content: "The first part of the reply.", endTurn: true }]);
  active.replyPreview!.stop();
});

test.each(["length", "aborted", "error", "cancelled"])("%s retracts the partial preview without delivery", async (reason) => {
  const { active, sent, delivered, start, end, route } = fixture();
  start();
  route(textDelta("An incomplete reply"));
  if (reason === "cancelled") active.pluginAbortController!.abort();
  end(reason === "cancelled" ? "stop" : reason, "An incomplete reply");
  await Bun.sleep(0);
  expect(sent).toEqual([["text:assistant:run:1", "An incomplete reply"], ["text:assistant:run:1", null]]);
  expect(delivered).toEqual([]);
  active.replyPreview!.stop();
});

test("text with tools continues, a tools-only response sends nothing, and later text has a fresh id", () => {
  const { start, end, delivered } = fixture();
  start();
  end("toolUse", "I am checking.", true);
  start();
  end("toolUse", undefined, true);
  start();
  end("stop", "Done.");
  expect(delivered).toEqual([
    { id: "text:assistant:run:1", content: "I am checking.", endTurn: false },
    { id: "text:assistant:run:3", content: "Done.", endTurn: true },
  ]);
});

test("speech uses the delivery id without a text preview and drops queued chunks after truncation", async () => {
  const { active, start, end, route, sent } = fixture();
  const spoken: Array<[string, string]> = [];
  const firstChunk = Promise.withResolvers<void>();
  active.replyPreview = undefined;
  active.speech = new SendToUserSpeech(async (id, content) => {
    spoken.push([id, content]);
    await firstChunk.promise;
  });
  start();
  route(textDelta("A complete sentence. "));
  await Bun.sleep(0);
  route(textDelta("A complete sentence. Another complete sentence. "));
  end("length", "A complete sentence. Another complete sentence.");
  firstChunk.resolve();
  await active.speech.flush();
  expect(spoken).toEqual([["text:assistant:run:1", "A complete sentence."]]);
  expect(sent).toEqual([]);
});

test("disabled mode retains internal assistant text without preview or delivery", () => {
  const { start, end, route, sent, delivered } = fixture(false);
  start();
  route(textDelta("A private draft."));
  end("stop", "A private draft.");
  expect(sent).toEqual([]);
  expect(delivered).toEqual([]);
});

test("coalesces updates and retracts a failed reply after its in-flight update", async () => {
  const sent: Array<string | null> = [];
  const publisher = new ReplyPreviewPublisher(async (_id, content) => { sent.push(content); });
  publisher.observe("reply", "First");
  publisher.observe("reply", "First and");
  publisher.observe("reply", "First and second");
  await Bun.sleep(300);
  expect(sent).toEqual(["First", "First and second"]);
  publisher.finish("reply", true);
  await Bun.sleep(0);
  expect(sent).toEqual(["First", "First and second", null]);
});
