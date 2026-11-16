import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceLinkPanel, deviceLinkImage } from "../src/renderer/components/outcomego/plugins/device-link-panel";
import { I18nProvider } from "../src/renderer/lib/i18n";
import { translateCurrent } from "../src/renderer/lib/i18n-catalog";

// The Bot choice imports the API client, which reads `window` when loaded. Provide it only for the
// import and put the globals back, so no other test file inherits a stub or a locale.
const saved = { window: (globalThis as any).window, localStorage: (globalThis as any).localStorage };
const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
(globalThis as any).localStorage ??= storage;
(globalThis as any).window ??= { location: { href: "http://127.0.0.1/" }, localStorage: storage, navigator: { language: "en-US" } };
const { ExternalBotChoice } = await import("../src/renderer/components/outcomego/plugins/external-bot-choice");
(globalThis as any).window = saved.window;
(globalThis as any).localStorage = saved.localStorage;
if (saved.window === undefined) delete (globalThis as any).window;
if (saved.localStorage === undefined) delete (globalThis as any).localStorage;

const png = "data:image/png;base64,iVBORw0KGgo=";
const link = (qrCodeDataUrl: string | null) => ({
  sessionId: "s1",
  qrCodeDataUrl,
  expiresAt: Date.now() + 60_000,
  instructions: "Scan this code with WeChat",
});
const render = (qr: string | null) =>
  renderToStaticMarkup(
    <I18nProvider>
      <DeviceLinkPanel link={link(qr)} busy={false} onNewCode={() => {}} onCancel={() => {}} />
    </I18nProvider>
  );

describe("device link QR panel", () => {
  test("shows the code as an image with an accessible name, plus both actions", () => {
    const html = render(png);
    expect(html).toContain(`src="${png}"`);
    expect(html).toContain(`alt="${translateCurrent("Scan to link your account")}"`);
    expect(html).toContain(translateCurrent("Get new code"));
    expect(html).toContain(translateCurrent("Cancel linking"));
    expect(html).toContain("Scan this code with WeChat");
  });

  test("without a code it says it is waiting instead of showing a broken image", () => {
    const html = render(null);
    expect(html).not.toContain("<img");
    expect(html).toContain(translateCurrent("Waiting for an updated code or phone approval. You can also get a new code."));
  });

  test("only a bounded PNG data URL is ever put in an image", () => {
    expect(deviceLinkImage(link(png))).toBe(png);
    for (const bad of ["https://evil.example/x.png", "data:image/svg+xml;base64,YQ==", "data:image/png;base64,<script>", "data:image/png;base64," + "A".repeat(70_001), null])
      expect(deviceLinkImage(link(bad))).toBeNull();
    expect(render("javascript:alert(1)")).not.toContain("<img");
  });
});

describe("Bot choice for a messaging account", () => {
  const choice = (supported: boolean) =>
    ({ loaded: true, supported, bots: [], botId: "", setBotId: () => {}, save: async () => false, saving: false, error: null, bound: false }) as never;
  test("renders nothing for a connection without messaging", () => {
    expect(renderToStaticMarkup(<I18nProvider><ExternalBotChoice choice={choice(false)} /></I18nProvider>)).toBe("");
  });
  test("asks for a Bot when messaging is supported", () => {
    const html = renderToStaticMarkup(<I18nProvider><ExternalBotChoice choice={choice(true)} /></I18nProvider>);
    expect(html).toContain(translateCurrent("Bot for this account"));
  });
});
