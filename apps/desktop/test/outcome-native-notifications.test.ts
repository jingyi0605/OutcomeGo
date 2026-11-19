import { expect, test } from "bun:test";
import { outcomeNotificationPayload } from "@outcomego/contracts/notification-content";
import { DesktopOutcomeNotificationManager, parseOutcomeNotifications, parseNotificationTarget } from "../src/main/notifications";
import { parseDesktopOutcomeLink, parseDesktopOutcomeTarget } from "../src/renderer/lib/outcome-target";
import { fixtureIds } from "./outcome-client-fixtures";

const payload = () => ({ ...outcomeNotificationPayload({ type: "outcome.decision.required", factKey: `decision:${fixtureIds.decision}`, outcomeId: fixtureIds.outcome, decisionId: fixtureIds.decision, botId: fixtureIds.bot, channelId: fixtureIds.channel, contractRevision: 1 }), notificationSequence: "42" });
test("Outcome IPC strips all business text and trusts only validated object identities", () => {
  const parsed = parseOutcomeNotifications([{ ...payload(), privateBody: "never retain", title: "private text", body: "private text", customText: "never retain" }]);
  expect(parsed).toEqual([{ factKey: `decision:${fixtureIds.decision}`, outcomeId: fixtureIds.outcome, decisionId: fixtureIds.decision, category: "decision_pending", channelId: fixtureIds.channel, notificationSequence: "42" }]);
  expect(JSON.stringify(parsed)).not.toContain("private");
  expect(parseDesktopOutcomeTarget({ outcomeId: "bad" })).toBeNull();
  expect(parseOutcomeNotifications([{ ...payload(), schemaVersion: 2 }, { ...payload(), type: "unknown" }])).toEqual([]);
});
test("strict Outcome deep links preserve old message targets and reject embedded data", () => {
  expect(parseDesktopOutcomeLink(`outcomego://app/v1/outcomes/decision?id=${fixtureIds.decision}`)).toEqual({ decisionId: fixtureIds.decision });
  expect(parseDesktopOutcomeLink("outcomego://app/v1/outcomes")).toEqual({});
  expect(parseDesktopOutcomeLink(`outcomego://app/v1/outcomes?id=${fixtureIds.outcome}&token=unsafe`)).toBeNull();
  expect(parseDesktopOutcomeLink(`outcomego://app/v1/outcomes?id=${fixtureIds.outcome}#unsafe`)).toBeNull();
  expect(parseDesktopOutcomeLink(`outcomego://user@app/v1/outcomes?id=${fixtureIds.outcome}`)).toBeNull();
  expect(parseNotificationTarget({ channelId: "legacy-chat", messageId: "legacy-message" })).toEqual({ channelId: "legacy-chat", messageId: "legacy-message" });
});
test("native Outcome banners deduplicate fact keys, suppress initial backlog, and dismiss read facts", () => {
  const delivered: string[] = []; const dismissed: string[] = [];
  let focused = false;
  const manager = new DesktopOutcomeNotificationManager({ isFocused: () => focused, isSupported: () => true, deliver: id => delivered.push(id), dismiss: id => dismissed.push(id) });
  manager.sync([]);
  const first = parseOutcomeNotifications([payload()])!;
  manager.sync(first); manager.sync(first);
  expect(delivered).toEqual([`decision:${fixtureIds.decision}`]);
  manager.sync([]); expect(dismissed).toEqual(delivered);
  focused = true; manager.sync([{ ...first[0]!, factKey: "focused" }]); focused = false;
  manager.sync([{ ...first[0]!, factKey: "focused" }]); expect(delivered).toHaveLength(1);
  manager.clear(); manager.sync(first); expect(delivered).toHaveLength(1);
});
test("failed and blocked notifications keep an Outcome deep link and parse on Desktop", () => {
  for (const [type, category, priority] of [["outcome.failed", "failed", 3], ["outcome.blocked", "blocked", 2]] as const) {
    const value = { ...outcomeNotificationPayload({ type, factKey: `${type}:${fixtureIds.outcome}`, outcomeId: fixtureIds.outcome, botId: fixtureIds.bot, channelId: fixtureIds.channel, contractRevision: 1 }), notificationSequence: "7" };
    expect(value).toMatchObject({ category, priority, deepLink: `outcomego://app/v1/outcomes?id=${fixtureIds.outcome}` });
    expect(parseOutcomeNotifications([value])).toEqual([{ factKey: `${type}:${fixtureIds.outcome}`, outcomeId: fixtureIds.outcome, category, channelId: fixtureIds.channel, notificationSequence: "7" }]);
  }
});
