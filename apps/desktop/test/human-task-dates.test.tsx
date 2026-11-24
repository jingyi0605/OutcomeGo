import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HumanTaskDates } from "../src/renderer/components/outcomego/outcomes/human-work/human-task-dates";
import { I18nProvider } from "../src/renderer/lib/i18n";

// Specs/004.10 task 2.7. Placeholders only. Overdue comes from the server's derived flag, not from a clock here.
const render = (props: { scheduledAt?: string | null; dueAt?: string | null; overdue?: boolean }) =>
  renderToStaticMarkup(createElement(I18nProvider, { children: createElement(HumanTaskDates, props) }));

describe("human task dates", () => {
  test("renders nothing for a task with no dates, and for an older server that sends none", () => {
    expect(render({})).toBe("");
    expect(render({ scheduledAt: null, dueAt: null, overdue: false })).toBe("");
  });

  test("shows a booked time and a deadline as labelled, readable times", () => {
    const html = render({ scheduledAt: "2026-12-01T09:00:00.000Z", dueAt: "2099-12-05T09:00:00.000Z", overdue: false });
    expect(html).toContain("Booked for");
    expect(html).toContain("Due");
    expect(html).toContain('dateTime="2026-12-01T09:00:00.000Z"');
    expect(html).toContain('dateTime="2099-12-05T09:00:00.000Z"');
  });

  test("marks an overdue task with words and an icon, not colour alone", () => {
    const html = render({ dueAt: "2001-01-01T00:00:00.000Z", overdue: true });
    expect(html).toContain("Overdue");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-overdue="true"');
  });

  test("never says overdue when the server did not say so, even for a past deadline", () => {
    const html = render({ dueAt: "2001-01-01T00:00:00.000Z", overdue: false });
    expect(html).not.toContain("Overdue");
    expect(html).not.toContain('data-overdue="true"');
  });

  test("a booked time alone, however old, never shows overdue", () => {
    const html = render({ scheduledAt: "2001-01-01T00:00:00.000Z" });
    expect(html).toContain("Booked for");
    expect(html).not.toContain("Overdue");
  });

  test("says nothing about predicting or expecting a finish", () => {
    const html = render({ scheduledAt: "2026-12-01T09:00:00.000Z", dueAt: "2099-12-05T09:00:00.000Z" }).toLowerCase();
    for (const word of ["estimated", "expected", "predicted", "forecast"]) expect(html).not.toContain(word);
  });
});

// The same dates must reach the card itself, not only the small component.
import { HumanAction } from "../src/renderer/components/outcomego/outcomes/human-work/human-action";
import { humanFixture } from "./outcome-client-fixtures";
import type { HumanWorkItemDetail } from "@outcomego/contracts/human-work";

describe("human action card shows the dates", () => {
  const card = (extra: Partial<HumanWorkItemDetail>) =>
    renderToStaticMarkup(
      createElement(I18nProvider, {
        children: createElement(HumanAction, {
          workItemId: humanFixture.id,
          client: {} as never,
          materials: {} as never,
          upload: async () => ({ assetRef: "asset:x" }),
          onReview: () => undefined,
          initialItem: { ...structuredClone(humanFixture), ...extra },
        }),
      })
    );

  test("a task with dates shows them in the card header, and an overdue one says so", () => {
    const html = card({ scheduledAt: "2026-12-01T09:00:00.000Z", dueAt: "2001-01-01T00:00:00.000Z", overdue: true });
    expect(html).toContain("Booked for");
    expect(html).toContain("Due");
    expect(html).toContain("Overdue");
  });

  test("a task with no dates shows none of them, as before", () => {
    const html = card({});
    for (const word of ["Booked for", "Overdue"]) expect(html).not.toContain(word);
  });
});
