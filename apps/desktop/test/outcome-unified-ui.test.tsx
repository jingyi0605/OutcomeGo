import { beforeAll, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OutcomeThreadTurnView } from "@outcomego/contracts/outcome-thread";
import { I18nProvider } from "../src/renderer/lib/i18n";
import { UnifiedPlanPanel } from "../src/renderer/components/outcomego/outcomes/planning/unified-plan-panel";

mock.module("../src/renderer/client/outcomego-api", () => ({ api: { uploadAsset: async () => ({}) } }));
let GoIntakeForm: typeof import("../src/renderer/components/outcomego/outcomes/inbox/go-intake-form").GoIntakeForm;
beforeAll(async () => {
  const storage = { getItem: () => null, setItem() {} };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { href: "http://127.0.0.1/" }, localStorage: storage, navigator: { language: "en-US" } } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "en-US" } });
  ({ GoIntakeForm } = await import("../src/renderer/components/outcomego/outcomes/inbox/go-intake-form"));
});

const render = (element: ReactNode) => renderToStaticMarkup(createElement(I18nProvider, { children: element }));
const bots = [{ id: "bot-1", name: "Research Bot" }];

describe("unified Outcome desktop UI", () => {
  test("Go intake exposes text, bot mentions, files and immediate Go submission", () => {
    const html = render(createElement(GoIntakeForm, { client: {} as never, bots }));
    expect(html).toContain("Write anything.");
    expect(html).toContain('type="file"');
    expect(html).toContain("Add files");
    expect(html).toContain(">Go<");
  });

  test("Plan panel applies progressive disclosure: L1 shows summary and owner confirmations, L2 folds facts, gaps and rationale", () => {
    const turn: OutcomeThreadTurnView = {
      id: "turn-1",
      purpose: "plan",
      planMode: "advice",
      trigger: "Plan this",
      status: "completed",
      reply: null,
      error: null,
      runId: null,
      outcomeRevision: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:01Z",
      result: {
        schemaVersion: 1,
        summary: "Start with the smallest useful experiment.",
        facts: [{ statement: "The source note is available.", source: "apps/android/ChatScreen.kt:509" }],
        gaps: ["The deadline is unknown."],
        recommendations: [
          { action: "Confirm the deadline.", needsOwnerConfirm: true, reason: "Blocks contract lock." },
          { action: "Prepare isolated worktree.", needsOwnerConfirm: false, reason: "Avoids concurrent edits." },
        ],
      },
    };
    const html = render(createElement(UnifiedPlanPanel, { turns: [turn], onPlan() {} }));
    const [layer1, layer2 = ""] = html.split("<details ");
    // Layer 1 shows only core summary and owner confirmation actions.
    expect(layer1).toContain("Plan");
    expect(layer1).toContain("Start with the smallest useful experiment.");
    expect(layer1).toContain("Needs your confirmation");
    expect(layer1).toContain("Confirm the deadline.");
    expect(layer1).not.toContain("apps/android/ChatScreen.kt:509");
    expect(layer1).not.toContain("The deadline is unknown.");
    expect(layer1).not.toContain("Blocks contract lock.");
    expect(layer1).not.toContain("Prepare isolated worktree.");
    // Layer 2 is collapsed by default (no `open` attribute) and holds full facts, gaps, and recommendation details.
    expect(layer2).not.toMatch(/^[^>]*\bopen\b/);
    for (const detailText of [
      "Evidence and details",
      "1 facts",
      "1 gaps",
      "2 notes",
      "Recommendation details",
      "Blocks contract lock.",
      "Prepare isolated worktree.",
      "Gaps",
      "The deadline is unknown.",
      "Facts",
      "The source note is available.",
      "apps/android/ChatScreen.kt:509",
    ]) {
      expect(layer2).toContain(detailText);
    }
  });
});
