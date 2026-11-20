import { expect, test } from "bun:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { SEND_TO_USER_TOOL } from "@outcomego/contracts";
import { routeEvent } from "../../src/runtime/events";
import { ReplyPreviewPublisher, RICH_REPLY_TOOL } from "../../src/runtime/reply-preview";
import type { ActiveTurn } from "../../src/runtime/types";

const toolDelta = (name: string, content: string, previousCall = false) => ({
  type: "message_update",
  assistantMessageEvent: {
    type: "toolcall_delta",
    contentIndex: previousCall ? 1 : 0,
    partial: { content: [
      ...(previousCall ? [{ type: "toolCall", id: "earlier", name: "SendToUser" }] : []),
      { type: "toolCall", id: "reply", name, arguments: { content } },
    ] },
  },
}) as unknown as AgentSessionEvent;

test("publishes only the fixed-destination reply before the tool executes", () => {
  const sent: Array<[string, string | null]> = [];
  const publisher = new ReplyPreviewPublisher(async (id, content) => { sent.push([id, content]); });
  const active = { replyPreview: publisher, currentAssistantId: null } as ActiveTurn;
  routeEvent(undefined, active, toolDelta(RICH_REPLY_TOOL, "A possibly external reply"));
  routeEvent(undefined, active, toolDelta(SEND_TO_USER_TOOL.name, "A later call", true));
  expect(sent).toEqual([]);
  routeEvent(undefined, active, toolDelta(SEND_TO_USER_TOOL.name, "The first part"));
  expect(sent).toEqual([["reply", "The first part"]]);
  publisher.stop();
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
