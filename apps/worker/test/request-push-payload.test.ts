import { describe, expect, test } from "bun:test";
import { requestNotificationPayload } from "@outcomego/contracts/notification-content";
import { apnsPayload } from "../src/apns";
import { fcmPayload } from "../src/fcm";

// Specs/004.10 task 4.5: an alert about a request carries its identity and a fixed text, on both push providers.
const request = { ...requestNotificationPayload({ requestId: "req-1", state: "no_follow_up", revision: 5, botId: "bot-1", channelId: "chan-1" }), notificationSequence: "42" };

describe("request alerts on the push providers", () => {
  test("FCM carries the request identity, state, revision and the fixed text", () => {
    const { message } = fcmPayload({ pushToken: "fcm-token_" + "A".repeat(40), notificationScope: "scope" }, request, 2, "key-1") as { message: { data: Record<string, string> } };
    expect(message.data).toMatchObject({ kind: "request", requestId: "req-1", state: "no_follow_up", revision: "5", botId: "bot-1", channelId: "chan-1", notificationSequence: "42", title: request.title, body: request.body });
  });

  test("APNs shows an alert with the fixed text, grouped by channel", () => {
    const payload = apnsPayload({ pushToken: "a".repeat(64), apnsTopic: "t", apnsEnvironment: "development", notificationScope: "scope" } as never, request, 2) as { aps: { alert: { title: string; body: string }; "thread-id": string } };
    expect(payload.aps.alert).toEqual({ title: request.title, body: request.body });
    expect(payload.aps["thread-id"]).toBe("chan-1");
  });

  test("the fixed text differs by state and the key names request, revision and state", () => {
    const owner = requestNotificationPayload({ requestId: "r", state: "needs_owner", revision: 1, botId: "b", channelId: "c" });
    expect(owner.body).not.toBe(request.body);
    expect(owner.factKey).toBe("request:r:1:needs_owner");
  });
});
