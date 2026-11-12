import React from "react";
import { createRoot } from "react-dom/client";
import { createOutcomeGoClient } from "@outcomego/client-core";
import { api } from "../../src/renderer/client/outcomego-api";
import ProvidersSettings from "../../src/renderer/components/outcomego/settings/providers";
import "../../src/renderer/styles.css";

// Real server and database; scripts/test-provider-settings.ts drives the UI.
const fixture = (window as any).providersFixture as { baseUrl: string; token?: string };
const client = createOutcomeGoClient({
  baseUrl: fixture.baseUrl,
  getAuthToken: () => fixture.token,
});
api.webProviders = client.webProviders;
api.updateWebProviders = client.updateWebProviders;
api.checkWebProvider = client.checkWebProvider;
createRoot(document.getElementById("root")!).render(<ProvidersSettings />);
(window as any).providersReady = true;
