import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { incomingEvent, WhatsAppInboundEvents } from "../inbound-events";

test("incoming message events skip outgoing, historical, edited, revoked and unsupported chat messages", () => {
  const base = {
    FromMe: false,
    Chat: "123456@s.whatsapp.net",
    ID: "message-1",
    Timestamp: "2026-11-19T10:00:00Z",
    Text: "hello",
  };
  expect(incomingEvent(base)).toMatchObject({
    kind: "message.received",
    resourceId: base.Chat,
    actor: base.Chat,
    messageId: base.ID,
    text: "hello",
  });
  expect(incomingEvent({ ...base, FromMe: true })).toBeUndefined();
  expect(incomingEvent({ ...base, EventType: "receipt" })).toBeUndefined();
  expect(incomingEvent({ ...base, Edited: true })).toBeUndefined();
  expect(incomingEvent({ ...base, Revoked: true })).toBeUndefined();
  expect(incomingEvent({ ...base, ReactionToID: "original" })).toBeUndefined();
  expect(incomingEvent({ ...base, Chat: "status@broadcast" })).toBeUndefined();
  expect(
    incomingEvent({ ...base, Text: "", Media: { Type: "image", Caption: "photo" } })?.text
  ).toBe("photo");
  expect(incomingEvent({ ...base, Text: "", Media: { Type: "image" } })?.text).toBe("[image]");
  expect(incomingEvent({ ...base, Text: "", Location: {} })?.text).toBe("[location]");
});

test("signed webhook stores stable deduplicated events and acknowledges the durable cursor", async () => {
  const root = await mkdtemp("/tmp/whatsapp-events-");
  const outbox = new WhatsAppInboundEvents(root);
  let restarted: WhatsAppInboundEvents | undefined;
  try {
    const args = outbox.syncArgs;
    const endpoint = args[1];
    const secret = args[6];
    if (!endpoint || !secret) throw new Error("Missing signed webhook configuration");
    const payload = JSON.stringify({
      FromMe: false,
      Chat: "123456-789@g.us",
      ID: "group-1",
      Timestamp: "2026-11-19T10:00:00Z",
      SenderJID: "123456@s.whatsapp.net",
      Text: "group message",
    });
    const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
    const post = (sig = signature) =>
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wacli-signature": sig },
        body: payload,
      });
    expect((await post(`sha256=${"0".repeat(64)}`)).status).toBe(401);
    expect((await post()).status).toBe(204);
    expect((await post()).status).toBe(204);
    await outbox.close();
    restarted = new WhatsAppInboundEvents(root);
    const first = await restarted.poll(null);
    expect(first.events).toHaveLength(1);
    expect(first.events[0]).toMatchObject({
      resourceId: "123456-789@g.us",
      actor: "123456@s.whatsapp.net",
      text: "group message",
    });
    expect(first.cursor).toBe(1);
    expect(await restarted.poll(first.cursor)).toEqual({ events: [], cursor: first.cursor });
  } finally {
    await restarted?.close();
    await outbox.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("an MCP-style long poll wakes immediately for a newly persisted message and close cancels waiters", async () => {
  const root = await mkdtemp("/tmp/whatsapp-events-wait-");
  const outbox = new WhatsAppInboundEvents(root);
  try {
    const pending = outbox.poll(null, 5_000);
    await Bun.sleep(20);
    const args = outbox.syncArgs;
    const endpoint = args[1];
    const secret = args[6];
    if (!endpoint || !secret) throw new Error("Missing signed webhook configuration");
    const payload = JSON.stringify({
      FromMe: false,
      Chat: "123456@g.us",
      ID: "group-2",
      Timestamp: "2026-11-19T10:00:00Z",
      Text: "wake",
    });
    const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
    expect(
      (
        await fetch(endpoint, {
          method: "POST",
          headers: { "x-wacli-signature": signature },
          body: payload,
        })
      ).status
    ).toBe(204);
    await expect(pending).resolves.toMatchObject({ events: [{ text: "wake" }], cursor: 1 });
    const closing = outbox.poll(1, 5_000);
    await Bun.sleep(10);
    await outbox.close();
    await expect(closing).resolves.toEqual({ events: [], cursor: 1 });
  } finally {
    await outbox.close();
    await rm(root, { recursive: true, force: true });
  }
});
