import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ExternalDeliveryStatus,
  externalDeliveryOf,
  externalPlatformLabel,
  externalSourceOf,
} from "../src/renderer/components/outcomego/external-delivery-status";
import { I18nProvider } from "../src/renderer/lib/i18n";
import { translateCurrent } from "../src/renderer/lib/i18n-catalog";

const render = (state: Parameters<typeof ExternalDeliveryStatus>[0]["state"]) =>
  renderToStaticMarkup(
    <I18nProvider>
      <ExternalDeliveryStatus state={state} />
    </I18nProvider>
  );

describe("external delivery state parsing", () => {
  test("reads the state the Server mirrors onto a message", () => {
    expect(externalDeliveryOf({ externalDelivery: { id: "d1", status: "failed", code: "external_delivery_timeout" } })).toEqual({
      id: "d1",
      status: "failed",
      code: "external_delivery_timeout",
    });
    expect(externalDeliveryOf({ externalDelivery: { id: "d1", status: "sent", code: null } })?.code).toBeNull();
  });

  test("treats missing or malformed metadata as no delivery", () => {
    for (const metadata of [null, undefined, "x", [], {}, { externalDelivery: "x" }, { externalDelivery: { id: "d" } }])
      expect(externalDeliveryOf(metadata)).toBeNull();
    expect(externalDeliveryOf({ externalDelivery: { id: "d", status: "bogus", code: null } })).toBeNull();
    expect(externalDeliveryOf({ externalDelivery: { id: 1, status: "sent", code: null } })).toBeNull();
  });
});

describe("external delivery status display", () => {
  test("sent, failed and uncertain render distinguishable states", () => {
    const sent = render({ id: "d", status: "sent", code: null });
    const failed = render({ id: "d", status: "failed", code: "external_delivery_timeout" });
    const uncertain = render({ id: "d", status: "uncertain", code: "external_delivery_transport" });
    expect(sent).toContain('data-external-delivery="sent"');
    expect(failed).toContain('data-external-delivery="failed"');
    expect(uncertain).toContain('data-external-delivery="uncertain"');
    expect(new Set([sent, failed, uncertain]).size).toBe(3);
  });

  test("failed and uncertain explain the reason, sent does not", () => {
    const timeout = translateCurrent("The chat service did not answer in time.");
    const transport = translateCurrent("The connection to the chat service failed.");
    const wontResend = translateCurrent("It may have arrived and will not be sent again.");
    expect(render({ id: "d", status: "failed", code: "external_delivery_timeout" })).toContain(timeout);
    const uncertain = render({ id: "d", status: "uncertain", code: "external_delivery_transport" });
    expect(uncertain).toContain(transport);
    expect(uncertain).toContain(wontResend);
    expect(render({ id: "d", status: "sent", code: "external_delivery_timeout" })).not.toContain(timeout);
    expect(render({ id: "d", status: "failed", code: null })).not.toContain(wontResend);
  });

  test("an unknown code is shown as is instead of being dropped", () => {
    expect(render({ id: "d", status: "failed", code: "wechat_text_too_long" })).toContain("wechat_text_too_long");
  });

  test("failed and uncertain are announced, in-flight states are not", () => {
    expect(render({ id: "d", status: "failed", code: null })).toContain('role="status"');
    expect(render({ id: "d", status: "uncertain", code: null })).toContain('role="status"');
    expect(render({ id: "d", status: "pending", code: null })).not.toContain("role=");
  });
});

describe("platform label", () => {
  const t = (key: string) => key;
  test("names known platforms and capitalizes others", () => {
    expect(externalPlatformLabel("wechat", t)).toBe("WeChat");
    expect(externalPlatformLabel("signal", t)).toBe("Signal");
    expect(externalPlatformLabel(undefined, t)).toBe("an external service");
  });
});

describe("where a user message came from", () => {
  test("names the platform a message was written on", () => {
    expect(externalSourceOf({ type: "text", external: { platform: "wechat", occurredAt: "2026-11-16T00:00:00Z" } })).toBe("wechat");
  });
  test("a message typed in the app, or with odd metadata, has no source", () => {
    for (const metadata of [null, undefined, {}, [], "x", { external: "wechat" }, { external: { platform: 1 } }, { external: { platform: "We Chat!" } }, { external: { platform: "x".repeat(40) } }])
      expect(externalSourceOf(metadata)).toBeNull();
  });
});
