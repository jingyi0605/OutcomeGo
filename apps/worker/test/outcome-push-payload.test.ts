import { expect, test } from "bun:test";
import { outcomeNotificationPayload } from "@outcomego/contracts/notification-content";
import { apnsPayload } from "../src/apns";
import { fcmPayload } from "../src/fcm";
const id = "11111111-1111-4111-8111-111111111111";
test("APNs and FCM retain Outcome identity, fixed text and deep link", () => {
  const payload = outcomeNotificationPayload({ type: "outcome.decision.required", outcomeId: id, decisionId: id, factKey: `decision.required:${id}`, channelId: id, botId: id, contractRevision: 1 });
  const apns = apnsPayload({ pushToken: "ab".repeat(32), apnsEnvironment: "sandbox", apnsTopic: "test.outcomego", notificationScope: "scope" }, payload, 2);
  expect(apns).toMatchObject({ aps: { alert: { title: payload.title, body: payload.body }, badge: 2, sound: "default", "thread-id": id }, data: { kind: "outcome", type: payload.type, outcomeId: id, decisionId: id, factKey: payload.factKey, deepLink: payload.deepLink, schemaVersion: 1 } });
  expect(fcmPayload({ pushToken: "token".repeat(10), notificationScope: "scope" }, payload, 2, "delivery").message.data).toEqual({ schemaVersion: "1", kind: "outcome", notificationScope: "scope", badgeCount: "2", type: payload.type, factKey: payload.factKey, outcomeId: id, decisionId: id, category: "decision_pending", contractRevision: "1", priority: "3", botId: id, channelId: id, notificationSequence: "0", title: payload.title, body: payload.body, deepLink: payload.deepLink });
  expect(Buffer.byteLength(JSON.stringify(apns))).toBeLessThan(4096);
});
