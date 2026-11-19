import { expect, mock, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act } from "react";

mock.module("../src/renderer/hooks/use-feature-settings", () => ({
  useFeatureSettings: () => ({ loaded: true, outcomesEnabled: false }),
}));

test("General Settings checks Accessibility on open and on return from System Settings", async () => {
  const dom = parseHTML("<html><body></body></html>");
  const storage = { getItem: () => null };
  const listeners = new Set<(enabled: boolean) => void>();
  let granted = true;
  const check = mock(async () => granted);
  const openSettings = mock(async () => {});
  const setEnabled = mock(async (enabled: boolean) => {
    for (const listener of listeners) listener(enabled);
  });
  Object.defineProperties(dom.window, {
    location: { configurable: true, value: { href: "http://localhost/" } },
    localStorage: { configurable: true, value: storage },
    outcomego: {
      configurable: true,
      value: {
        platform: "darwin",
        botDock: {
          getEnabled: async () => true,
          setEnabled,
          onEnabledChange(listener: (enabled: boolean) => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        accessibility: { check, openSettings },
      },
    },
  });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.document,
    navigator: dom.window.navigator,
    localStorage: storage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import("react-dom/client");
  const { FeatureSettings } = await import("../src/renderer/components/outcomego/settings/general");
  const { I18nProvider } = await import("../src/renderer/lib/i18n");
  const root = createRoot(dom.document.body);
  const button = (label: string) =>
    [...dom.document.querySelectorAll("button")].find(
      (control) => control.getAttribute("aria-label") === label || control.textContent === label
    );
  const click = async (label: string) => {
    const control = button(label);
    if (!control) throw new Error(`Button not found: ${label}`);
    await act(async () => control.click());
  };
  const status = () => dom.document.querySelector('[role="status"]')?.textContent;

  try {
    await act(async () =>
      root.render(
        <I18nProvider>
          <FeatureSettings />
        </I18nProvider>
      )
    );
    const switchLabel = "Enable bot floating window";
    expect(button(switchLabel)?.getAttribute("aria-checked")).toBe("true");
    expect(check).toHaveBeenCalledTimes(1);
    expect(status()).toBe("Enabled");
    expect(button("Enable accessibility")).toBeUndefined();
    expect(button("Check again")).toBeUndefined();
    expect(openSettings).not.toHaveBeenCalled();

    await click(switchLabel);
    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(button(switchLabel)?.getAttribute("aria-checked")).toBe("false");
    expect(status()).toBeUndefined();

    granted = false;
    await click(switchLabel);
    expect(setEnabled).toHaveBeenCalledWith(true);
    expect(button(switchLabel)?.getAttribute("aria-checked")).toBe("true");
    expect(check).toHaveBeenCalledTimes(2);
    expect(button("Enable accessibility")).toBeDefined();
    expect(button("Check again")).toBeUndefined();

    await click("Enable accessibility");
    expect(openSettings).toHaveBeenCalledTimes(1);
    granted = true;
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("focus")));
    expect(check).toHaveBeenCalledTimes(3);
    expect(status()).toBe("Enabled");
    expect(button("Enable accessibility")).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
