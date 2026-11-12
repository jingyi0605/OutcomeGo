import React from "react";
import { createRoot } from "react-dom/client";
import { createOutcomeGoClient } from "@outcomego/client-core";
import { api } from "../../src/renderer/client/outcomego-api";
import { TranscriptionSettingsPanel } from "../../src/renderer/components/outcomego/settings/transcription";
import { SettingsPanel } from "../../src/renderer/components/outcomego/settings/panel";
import { TooltipProvider } from "../../src/renderer/components/ui/tooltip";
import "../../src/renderer/styles.css";

const fixture = (window as any).transcriptionFixture as { baseUrl: string };
const client = createOutcomeGoClient({ baseUrl: fixture.baseUrl });
api.transcriptionSettings = client.transcriptionSettings;
api.updateTranscriptionSettings = client.updateTranscriptionSettings;
api.checkTranscription = client.checkTranscription;
const full = new URLSearchParams(location.search).has("full");

createRoot(document.getElementById("root")!).render(
  full ? (
    <TooltipProvider>
      <SettingsPanel open onOpenChange={() => {}} />
    </TooltipProvider>
  ) : (
    <TranscriptionSettingsPanel />
  )
);
