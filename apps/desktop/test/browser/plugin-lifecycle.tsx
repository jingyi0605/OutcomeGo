import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { createOutcomeGoClient } from "@outcomego/client-core";
import {
  OUTCOMEGO_DEEP_LINK_EVENT,
  parseOutcomeGoDeepLink,
} from "../../src/renderer/lib/app-deep-links";
import "../../src/renderer/styles.css";
const origin = new URLSearchParams(location.search).get("server");
const authSession = new URLSearchParams(location.search).get("authSession");
const nativeOAuth = new URLSearchParams(location.search).get("nativeOAuth") === "fixture";
if (!origin || new URL(origin).hostname !== "127.0.0.1" || (window.outcomego && !nativeOAuth))
  throw new Error("This fixture requires a disposable local plugin test server in a browser.");
const [{ api }, { PluginDialog }, { TooltipProvider }] = await Promise.all([
  import("../../src/renderer/client/outcomego-api"),
  import("../../src/renderer/components/outcomego/plugin-settings"),
  import("../../src/renderer/components/ui/tooltip"),
]);
const nativeMethods = { authenticatePlugin: api.authenticatePlugin, cancelPluginAuthentication: api.cancelPluginAuthentication };
Object.assign(api, createOutcomeGoClient({ baseUrl: origin, getAuthToken: () => authSession }), nativeOAuth ? nativeMethods : {});
function Fixture() {
  const reviewPlugin = new URLSearchParams(location.search).get("reviewPlugin");
  const [open, setOpen] = useState(!reviewPlugin);
  const [target, setTarget] = useState<{ pluginId: string; nonce: number } | null>(null);
  useEffect(() => {
    const follow = (event: Event) => {
      const link = parseOutcomeGoDeepLink((event as CustomEvent).detail.url);
      if (link?.kind === "plugin") {
        setTarget({ pluginId: link.pluginId, nonce: Date.now() });
        setOpen(true);
      }
    };
    window.addEventListener(OUTCOMEGO_DEEP_LINK_EVENT, follow);
    return () => window.removeEventListener(OUTCOMEGO_DEEP_LINK_EVENT, follow);
  }, []);
  return (
    <TooltipProvider>
      <button onClick={() => setOpen(true)}>Open plugins</button>
      {reviewPlugin ? (
        <button onClick={() => {setTarget({pluginId:reviewPlugin,nonce:Date.now()});setOpen(true);}}>
          Open plugin setup
        </button>
      ) : null}
      <PluginDialog open={open} onOpenChange={setOpen} target={target} />
    </TooltipProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
