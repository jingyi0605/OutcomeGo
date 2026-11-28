import { expect, test } from "bun:test";
import { eventPredatesRoutineRevision } from "../src/routines";

const revisionCreatedAt = new Date("2026-11-19T10:00:00.000Z");

test("WhatsApp events received before the current routine revision do not enter its new subscription", () => {
  const event = (receivedAt: string) => ({
    id: "plugin:whatsapp:connection:event",
    source: "plugin" as const,
    plugin: "whatsapp",
    kind: "message.received",
    text: "new message",
    receivedAt,
  });
  expect(eventPredatesRoutineRevision(event("2026-11-19T09:59:59.999Z"), revisionCreatedAt)).toBe(
    true
  );
  expect(eventPredatesRoutineRevision(event("2026-11-19T10:00:00.000Z"), revisionCreatedAt)).toBe(
    false
  );
  expect(eventPredatesRoutineRevision(event("2026-11-19T10:00:00.001Z"), revisionCreatedAt)).toBe(
    false
  );
  expect(
    eventPredatesRoutineRevision(
      { ...event("2026-11-19T09:00:00.000Z"), plugin: "dsh-web" },
      revisionCreatedAt
    )
  ).toBe(false);
  expect(
    eventPredatesRoutineRevision(
      { ...event("2026-11-19T09:00:00.000Z"), receivedAt: undefined },
      revisionCreatedAt
    )
  ).toBe(false);
});
