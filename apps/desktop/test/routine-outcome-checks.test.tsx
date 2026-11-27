import { expect, test } from "bun:test";
import type { ActivityItem } from "@outcomego/contracts/task-overview";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../src/renderer/lib/i18n";
import { translateCurrent } from "../src/renderer/lib/i18n-catalog";
import type { RoutineView } from "../src/renderer/lib/routines";

// The summary imports the API client, which reads `window` when loaded. Provide it only for the import and put the
// globals back, so no other test file inherits a stub.
const globals = globalThis as unknown as Record<string, unknown>;
const saved = { window: globals.window, localStorage: globals.localStorage };
const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globals.localStorage ??= storage;
globals.window ??= { location: { href: "http://127.0.0.1/" }, localStorage: storage, navigator: { language: "en-US" } };
const { pendingOutcomeChecks, RoutineRows } = await import("../src/renderer/components/outcomego/routine-summary");
for (const [name, value] of Object.entries(saved)) {
  if (value === undefined) delete globals[name];
  else globals[name] = value;
}

const item = (id: string, extra: Partial<ActivityItem> = {}): ActivityItem => ({
  id, type: "request", botId: "bot", title: `Ask ${id}`, state: "waiting", reason: null, doing: null, progress: null,
  lastActivityAt: "2026-11-27T01:00:00.000Z", nextCheckAt: "2026-11-27T06:00:00.000Z", needsOwner: false,
  link: { type: "channel", id: "channel" }, ...extra,
});
const routine = (id: string, enabled: boolean) =>
  ({ id, name: `Routine ${id}`, enabled, trigger: {}, schedules: [], scheduleKind: "event" }) as unknown as RoutineView;

test("only requests with a saved check are listed, soonest first", () => {
  const checks = pendingOutcomeChecks([
    item("later", { nextCheckAt: "2026-11-28T06:00:00.000Z" }),
    item("no-check", { nextCheckAt: null }),
    item("routine", { type: "routine" }),
    item("scheduled", { type: "scheduled_once" }),
    item("sooner"),
  ]);
  expect(checks.map((check) => check.id)).toEqual(["sooner", "later"]);
});

test("a check reads as an Outcome entry named after its to-do, between enabled and paused routines", () => {
  const markup = renderToStaticMarkup(
    <I18nProvider>
      <RoutineRows
        routines={[routine("on", true), routine("off", false)]}
        checks={[
          item("linked", { relatedOutcome: { id: "t", title: "Reconcile <figures>" } }),
          item("unlinked", { state: "check_not_fired" }),
        ]}
        onOpen={() => {}}
      />
    </I18nProvider>
  );
  expect(markup.match(/>Outcome</g)).toHaveLength(2);
  expect(markup).toContain("Reconcile &lt;figures&gt;");
  expect(markup).toContain("Ask unlinked");
  expect(markup).toContain(`${translateCurrent("Next check")}: `);
  expect(markup).toContain(translateCurrent("Check did not fire"));
  const order = ["Routine on", "Reconcile", "Ask unlinked", "Routine off"].map((text) => markup.indexOf(text));
  expect(order).toEqual([...order].sort((left, right) => left - right));
  // Only saved routines open an editor.
  expect(markup.match(/<button/g)).toHaveLength(2);
});
