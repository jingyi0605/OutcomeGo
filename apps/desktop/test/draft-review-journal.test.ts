import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelMessageView } from "@outcomego/contracts";
import { DurableSendJournalStore } from "../src/main/durable-send-journal-store";
import { DraftReviewJournal, draftReviewState } from "../src/renderer/lib/draft-review-journal";

const card = (state = "pending"): ChannelMessageView => ({
  id: "draft", channelId: "channel", sender: "agent", senderBotId: "bot",
  sourceRunId: null, content: "draft", createdAt: "2026-11-17T00:00:00Z",
  metadata: {
    type: "external-draft", cardState: state,
    draft: { platform: "email", providerIdentifier: "gmail", from: "me@example.com",
      to: ["you@example.com"], body: "original", replyToMessageId: "reply",
      attachments: [{ assetId: "pdf", fileName: "report.pdf" }] },
  },
});

for (const action of ["send", "cancel"] as const) {
  test(`${action} intent and receipt survive host and renderer restart without replay`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "outcomego-draft-review-"));
    const scope = "draft-review:server:account:card";
    const create = () => {
      const store = new DurableSendJournalStore(directory);
      return new DraftReviewJournal({
        read: () => store.read(scope), write: (record) => store.write(scope, record),
      }, card(), { body: "original" });
    };
    try {
      const first = create();
      await first.restore();
      await first.edit({ body: "edited", to: "you@example.com" });
      expect(await first.begin(action)).toBe(true);
      const restarted = create();
      await restarted.restore();
      expect(restarted.record.pending).toBe(true);
      expect(restarted.record.action).toBe(action);
      expect(await restarted.begin(action)).toBe(false);
      const receipt = card(action === "send" ? "sent" : "dismissed");
      (receipt.metadata as any).draft.body = "edited";
      await restarted.acknowledge(receipt);
      const again = create();
      await again.restore();
      expect(draftReviewState(again.record.message)).toBe(action === "send" ? "sent" : "dismissed");
      expect(again.record.pending).toBe(false);
      expect(await again.begin("send")).toBe(false);
      expect(again.record.fields.body).toBe("edited");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("a failed send preserves edited recipients, reply references and attachment metadata", async () => {
  let stored: unknown;
  const journal = new DraftReviewJournal({
    read: async () => stored, write: async (record) => { stored = structuredClone(record); },
  }, card());
  await journal.edit({ body: "edited", to: "other@example.com" });
  await journal.begin("send");
  const failure = card();
  failure.metadata = { ...(failure.metadata as object), sendError: "not submitted" };
  await journal.acknowledge(failure);
  expect(journal.record.fields).toEqual({ body: "edited", to: "other@example.com", subject: "", cc: "", from: "me@example.com" });
  expect((journal.record.message.metadata as any).draft).toMatchObject({
    replyToMessageId: "reply", attachments: [{ assetId: "pdf", fileName: "report.pdf" }],
  });
  expect(await journal.begin("send")).toBe(true);
});

test("stale events cannot reopen a settled receipt", async () => {
  const journal = new DraftReviewJournal({ read: async () => null, write: async () => {} }, card());
  await journal.acknowledge(card("sent"));
  journal.observe(card("sending"));
  await journal.acknowledge(card());
  expect(draftReviewState(journal.record.message)).toBe("sent");
  expect(journal.record.pending).toBe(false);
});

test("storage failure prevents dispatch and keeps the action unresolved", async () => {
  const journal = new DraftReviewJournal({
    read: async () => null, write: async () => { throw new Error("disk full"); },
  }, card());
  await expect(journal.begin("send")).rejects.toThrow("disk full");
  expect(journal.record.pending).toBe(true);
  expect(journal.running).toBe(false);
  expect(await journal.begin("send")).toBe(false);
});

test("a journal from another card or channel cannot be restored", async () => {
  const foreign = { version: 1, pending: true, fields: { body: "private" }, message: card("sent") };
  foreign.message.channelId = "another-channel";
  const journal = new DraftReviewJournal({ read: async () => foreign, write: async () => {} }, card());
  await journal.restore();
  expect(journal.record.pending).toBe(false);
  expect(journal.record.fields).toEqual({});
});

test("an offline restart cannot replace failed-send edits with a stale bootstrap", async () => {
  let stored: unknown;
  const storage = { read: async () => stored, write: async (record: unknown) => { stored = structuredClone(record); } };
  const journal = new DraftReviewJournal(storage, card());
  await journal.edit({ body: "Keep this edit", to: "other@example.com" });
  const failure = card();
  (failure.metadata as any).draft.body = "Keep this edit";
  (failure.metadata as any).draft.to = ["other@example.com"];
  await journal.acknowledge(failure);
  const restarted = new DraftReviewJournal(storage, card());
  await restarted.restore();
  expect(restarted.record.fields.body).toBe("Keep this edit");
  expect(restarted.record.fields.to).toBe("other@example.com");
});

test("a sent receipt shows the server's confirmed recipient and body", async () => {
  const journal = new DraftReviewJournal({ read: async () => null, write: async () => {} }, card());
  await journal.edit({ body: "Local edit", to: "old@example.com" });
  const sent = card("sent");
  (sent.metadata as any).draft.to = ["confirmed@example.com"];
  (sent.metadata as any).draft.body = "Actually sent";
  await journal.acknowledge(sent);
  expect(journal.record.fields.to).toBe("confirmed@example.com");
  expect(journal.record.fields.body).toBe("Actually sent");
});

test("a response for another target cannot settle or unlock the current send", async () => {
  const journal = new DraftReviewJournal({ read: async () => null, write: async () => {} }, card());
  await journal.begin("send");
  const foreign = card("sent");
  foreign.id = "another-card";
  journal.observe(foreign);
  await expect(journal.acknowledge(foreign)).rejects.toThrow("another message");
  expect(journal.record.message.id).toBe("draft");
  expect(journal.record.pending).toBe(true);
  expect(await journal.begin("send")).toBe(false);
});
