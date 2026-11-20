import { expect, test } from "bun:test";
import type { PrismaClient } from "@outcomego/db";
import { ReplyPreviews } from "../src/services/reply-previews";

const preview = { runId: "run", clientId: "tool:call", content: "First part" };
const fixture = () => {
  let running = true;
  const run = {
    findFirst: async ({ where }: { where: { status?: string } }) =>
      running || !where.status ? { id: preview.runId } : null,
  } as unknown as PrismaClient["run"];
  return { store: new ReplyPreviews({ run }), endRun: () => { running = false; } };
};

test("wakes a waiting chat with a preview and isolates other channels", async () => {
  const { store } = fixture();
  const signal = new AbortController().signal;
  const pending = store.poll("dm", "", signal);
  store.publish("dm", "inbox", 1, preview);
  const first = await pending;
  expect(first.preview).toEqual(preview);
  expect(await store.poll("another-dm", first.revision, signal)).toEqual({ revision: "", preview: null });
  store.clear();
});

test("discards cancelled previews and holds committed previews for history reconciliation", async () => {
  const signal = new AbortController().signal;
  const cancelled = fixture();
  cancelled.store.publish("dm", "inbox", 1, preview);
  cancelled.endRun();
  expect((await cancelled.store.poll("dm", "", signal)).preview).toBeNull();

  const committed = fixture();
  committed.store.publish("dm", "inbox", 1, preview);
  committed.store.commit("dm", preview.runId, "call");
  committed.endRun();
  committed.store.publish("dm", "inbox", 1, { ...preview, content: "Late update" });
  committed.store.discard("dm", "inbox", 1, preview.clientId);
  expect((await committed.store.poll("dm", "", signal)).preview).toEqual(preview);
  committed.store.clear();
});
