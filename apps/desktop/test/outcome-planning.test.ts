import { describe, expect, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OutcomeClient } from "../src/renderer/client/outcome-api";
import { createOutcomeApi } from "../src/renderer/client/outcome-api";
import { ContractConfirmation } from "../src/renderer/components/outcomego/outcomes/planning/contract-confirmation";
import { OutcomeRequestIds } from "../src/renderer/components/outcomego/outcomes/planning/outcome-client";
import { outcomeFixture } from "./outcome-fixture";
import { I18nProvider } from "../src/renderer/lib/i18n";

const render = (element: ReactNode) =>
  renderToStaticMarkup(createElement(I18nProvider, { children: element }));

describe("Outcome approval components and request IDs", () => {
  test("approval buttons disable in flight and retain comments", () => {
    const html = render(
      createElement(ContractConfirmation, {
        revision: {
          ...outcomeFixture.currentRevisionView!,
          status: "pending_approval",
          approvedAt: null,
        },
        busy: true,
        comment: "Keep my comments after a failed request",
        onComment() {},
        onApprove() {},
        onRequestChanges() {},
      })
    );
    expect(html).toContain("Keep my comments after a failed request");
    expect(html).toContain("Send to bot");
    expect(html).toContain("Submitting");
    expect(html).toContain("disabled");
    expect(html).not.toContain("No time limit specified");
    expect(html).not.toContain('type="text"');
  });
  test("ambiguous retries retain IDs, edited selections create a new intent", () => {
    const ids = new OutcomeRequestIds();
    const id = ids.for("approve", { revision: 1, confirmation: "I confirm" });
    expect(ids.for("approve", { revision: 1, confirmation: "I confirm" })).toBe(id);
    expect(ids.for("approve", { revision: 2, confirmation: "I confirm" })).not.toBe(id);
    const message = ids.for("message", { text: "取消目标" });
    expect(ids.for("message", { text: "取消目标" })).toBe(message);
    ids.complete("message");
    expect(ids.for("message", { text: "取消目标" })).not.toBe(message);
  });
  test("API adapter uses frozen endpoints and forwards client IDs without an actor", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client = createOutcomeApi(async <T>(path: string, init?: RequestInit) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      return {} as T;
    });
    await client.approve("o/1", 2, {
      expectedRevision: 2,
      confirmationText: "I confirm",
      clientRequestId: "approve:retry-key",
    });
    await client.list("limit=20");
    await client.get("o1");
    await client.transcript("o1", "work/1");
    await client.sendThreadMessage!("o/1", { text: "取消目标", clientRequestId: "message:retry-key" });
    await client.createThread!({ text: "做一个记账工具", botId: "bot-1", clientRequestId: "create:retry-key" });
    await client.thread!("o/1");
    expect(calls[0]).toEqual({
      path: "/api/outcomes/o%2F1/revisions/2/approve",
      body: {
        expectedRevision: 2,
        confirmationText: "I confirm",
        clientRequestId: "approve:retry-key",
      },
    });
    expect(calls[1]?.path).toBe("/api/outcomes?limit=20");
    expect(calls[3]?.path).toBe("/api/outcomes/o1/work-items/work%2F1/transcript");
    // The owner's words travel as written, with no wrapper.
    expect(calls[4]).toEqual({ path: "/api/outcomes/o%2F1/thread/messages", body: { text: "取消目标", clientRequestId: "message:retry-key" } });
    expect(calls[5]?.path).toBe("/api/outcomes/threads");
    expect(calls[6]?.path).toBe("/api/outcomes/o%2F1/thread");
  });
});
