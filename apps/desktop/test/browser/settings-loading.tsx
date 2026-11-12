import { createRoot } from "react-dom/client";
import { useState } from "react";
import { defaultTranscriptionSettings } from "@outcomego/contracts/transcription";
import { WEB_PROVIDER_LISTS } from "@outcomego/contracts/web-search";
import { api } from "../../src/renderer/client/outcomego-api";
import { SettingsPanel } from "../../src/renderer/components/outcomego/settings/panel";
import { TooltipProvider } from "../../src/renderer/components/ui/tooltip";
import "../../src/renderer/styles.css";

if (window.outcomego) throw new Error("Settings QA requires an isolated fixture");
window.fetch = async () => { throw new Error("External network disabled in settings fixture"); };
const calls: unknown[] = [];
let computer = {
  version: 1, machineLabel: "QA computer", machine: {machineId:"qa",label:"QA computer"},
};
let transcription = { ...defaultTranscriptionSettings(), hasApiKey: false, configured: false };
const providerStates = (tool: "search" | "fetch") => Object.fromEntries(WEB_PROVIDER_LISTS[tool].map((provider) => [provider.id, { secretSaved: false, ready: !provider.fields.some((field) => field.required), check: null }]));
let providers: any = {
  search: { selected: null, schedule: { strategy: "failover", providers: [], cursor: 0 }, providers: providerStates("search") },
  fetch: { selected: "builtin", schedule: { strategy: "failover", providers: ["builtin"], cursor: 0 }, providers: providerStates("fetch") },
};
Object.assign(window, { settingsQACalls: calls, outcomego: {
  auth: { machineStatus: async () => ({ machineId: "qa", connected: true, configured: true, error: null }) },
  computer: {
    get: async () => computer,
    update: async (input: any) => {
      calls.push({ type: "computer", input });
      computer = { ...computer, machineLabel: input.machineLabel ?? computer.machineLabel, machine: {...computer.machine,label:input.machineLabel ?? computer.machine.label} };
      return computer;
    },
  },
} });
Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: Object.assign(new EventTarget(), {
  enumerateDevices: async () => [{ deviceId: "qa-mic", kind: "audioinput", label: "QA microphone" }],
  getUserMedia: async () => { throw new Error("Physical microphone is unavailable in this fixture"); },
}) });
Object.assign(api, {
  machines: async () => [], computerDisplay: async () => ({ width: 1280, height: 800 }),
  serverSettings: async () => ({ inference: { providerId: "qa", modelId: "qa-model", reasoning: "medium" }, providers: [{ id: "qa", name: "QA provider", connected: true, authType: "api_key", authMethods: [{ type: "api_key", label: "API key", subscription: false }], custom: false, modelCount: 1 }], models: [{ providerId: "qa", modelId: "qa-model", name: "QA model", reasoning: true, contextWindow: 32000, maxTokens: 4096 }], modelProviderId: "qa" }),
  transcriptionSettings: async () => transcription,
  updateTranscriptionSettings: async (input: any) => { calls.push({ type: "transcription", input }); transcription = { ...transcription, ...input }; return transcription; },
  webProviders: async () => providers,
  updateWebProviders: async (input: any) => {
    calls.push({ type: "providers", input });
    for (const tool of ["search", "fetch"] as const) {
      const change = input[tool];
      if (!change) continue;
      const schedule = change.schedule ?? providers[tool].schedule;
      const selected = schedule.providers[0] ?? null;
      providers = {
        ...providers,
        [tool]: {
          ...providers[tool],
          selected,
          schedule: { ...providers[tool].schedule, ...schedule },
        },
      };
    }
    return providers;
  },
  checkWebProvider: async (input: any) => { calls.push({ type: "check", input }); return providers; },
  automationWebhooks: async () => [],
});
function Fixture() {
  const [open, setOpen] = useState(true);
  return <TooltipProvider><button onClick={() => setOpen(true)}>Open settings</button><SettingsPanel open={open} onOpenChange={setOpen} /></TooltipProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
