import {
  type AddInferenceProviderInput,
  CUSTOM_PROVIDER_API_LABELS,
  CUSTOM_PROVIDER_APIS,
  GENERIC_PROTOCOL_ICONS,
  type CustomProviderApi,
  type InferenceProviderPreset,
  type InferenceProviderPresetGroup,
  presetDefaultApi,
} from "@outcomego/contracts";
import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../client/outcomego-api";
import { requestErrorMessage } from "../../../lib/request-errors";
import { ProviderIcon } from "../setup/provider-icon";
import { useI18n } from "../../../lib/i18n";
import { LoadingOrb } from "../../ui/loading-orb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Select, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { SettingsSelectContent } from "./select-content";
import { settingsInput, settingsPrimaryButton, settingsSecondaryButton, settingsSelect } from "./ui";

const CUSTOM = "__custom__";
const GROUP_ORDER: InferenceProviderPresetGroup[] = ["vendor", "cloud", "relay", "local"];
const GROUP_LABEL: Record<InferenceProviderPresetGroup, string> = {
  vendor: "Model makers",
  cloud: "Cloud platforms",
  relay: "Hosts and gateways",
  local: "On this server",
};

const field = "grid gap-1.5";
const label = "text-[12px] text-foreground-secondary";

export function AddProviderDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves to the new provider's id, or to why it couldn't be added. */
  onAdd: (
    input: AddInferenceProviderInput,
    apiKey: string
  ) => Promise<{ providerId: string } | { error: string }>;
}) {
  const { t } = useI18n();
  const [presets, setPresets] = useState<InferenceProviderPreset[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState(CUSTOM);
  const [protocol, setProtocol] = useState<CustomProviderApi>("openai-completions");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setChoice(CUSTOM);
    setProtocol("openai-completions");
    setName("");
    setBaseUrl("");
    setApiKey("");
    setError(null);
    setLoadError(null);
    api
      .inferenceProviderPresets()
      .then((next) => active && setPresets(next))
      .catch((cause) => {
        if (active)
          setLoadError(requestErrorMessage(cause, t("Couldn't load the provider list.")));
      });
    return () => {
      active = false;
    };
  }, [open, t]);

  const preset = presets.find((candidate) => candidate.id === choice);
  const protocols = useMemo(
    () =>
      preset
        ? CUSTOM_PROVIDER_APIS.filter((candidate) => preset.endpoints[candidate])
        : [...CUSTOM_PROVIDER_APIS],
    [preset]
  );

  const pick = (id: string) => {
    setChoice(id);
    setError(null);
    const next = presets.find((candidate) => candidate.id === id);
    if (!next) {
      setBaseUrl("");
      return;
    }
    const api = presetDefaultApi(next);
    setProtocol(api);
    setName(next.name);
    setBaseUrl(next.endpoints[api] ?? "");
  };

  const pickProtocol = (value: CustomProviderApi) => {
    setProtocol(value);
    // A preset documents an address per protocol; a typed address stays as it is.
    if (preset?.endpoints[value]) setBaseUrl(preset.endpoints[value]);
  };

  const keyless = Boolean(preset?.noKey);
  // A key that may stay empty: empty means the server needs none (a local server).
  const withoutKey = keyless || (Boolean(preset?.keyOptional) && apiKey.trim().length === 0);
  const ready =
    name.trim().length > 0 && baseUrl.trim().length > 0 && (withoutKey || apiKey.trim().length > 0);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const result = await onAdd(
      {
        ...(preset ? { presetId: preset.id } : {}),
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        api: protocol,
        ...(withoutKey ? { noAuth: true } : {}),
      },
      apiKey.trim()
    );
    setBusy(false);
    if ("error" in result) setError(result.error);
    else onOpenChange(false);
  };

  return (
    <Dialog onOpenChange={(next) => !busy && onOpenChange(next)} open={open}>
      <DialogContent className="max-w-[440px] gap-4 p-5" data-testid="add-provider-dialog">
        <DialogHeader>
          <DialogTitle className="text-[15px]">{t("Add provider")}</DialogTitle>
          <DialogDescription className="text-[12px] leading-4">
            {t(
              "Connect any service that speaks OpenAI Chat, OpenAI Responses or Anthropic Messages. The key stays on your server."
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className={field}>
            <span className={label}>{t("Service")}</span>
            <Select disabled={busy} onValueChange={pick} value={choice}>
              <SelectTrigger aria-label={t("Service")} className={`${settingsSelect} w-full`}>
                <SelectValue />
              </SelectTrigger>
              <SettingsSelectContent>
                <SelectItem value={CUSTOM}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="grid size-3.5 shrink-0 place-items-center">
                      <ProviderIcon name={GENERIC_PROTOCOL_ICONS[protocol]} />
                    </span>
                    {t("Custom endpoint")}
                  </span>
                </SelectItem>
                {GROUP_ORDER.map((group) => {
                  const members = presets.filter((candidate) => candidate.group === group);
                  if (!members.length) return null;
                  return (
                    <div key={group}>
                      <div className="px-2 pb-1 pt-2 text-[11px] text-foreground-tertiary">
                        {t(GROUP_LABEL[group])}
                      </div>
                      {members.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="grid size-3.5 shrink-0 place-items-center">
                              <ProviderIcon name={member.icon} />
                            </span>
                            <span className="truncate">
                              {member.name}
                              {member.note && member.group !== "local" ? (
                                <span className="ml-1.5 text-foreground-tertiary">{member.note}</span>
                              ) : null}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </div>
                  );
                })}
              </SettingsSelectContent>
            </Select>
            {loadError ? (
              <span className="text-[12px] text-red-600 dark:text-red-400">{loadError}</span>
            ) : null}
          </div>
          <div className={field}>
            <span className={label}>{t("Protocol")}</span>
            <Select
              disabled={busy || protocols.length < 2}
              onValueChange={(value) => pickProtocol(value as CustomProviderApi)}
              value={protocol}
            >
              <SelectTrigger aria-label={t("Protocol")} className={`${settingsSelect} w-full`}>
                <SelectValue />
              </SelectTrigger>
              <SettingsSelectContent>
                {protocols.map((candidate) => (
                  <SelectItem key={candidate} value={candidate}>
                    {CUSTOM_PROVIDER_API_LABELS[candidate]}
                  </SelectItem>
                ))}
              </SettingsSelectContent>
            </Select>
          </div>
          <label className={field}>
            <span className={label}>{t("Name")}</span>
            <input
              aria-label={t("Name")}
              className={`${settingsInput} w-full`}
              disabled={busy}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
          <label className={field}>
            <span className={label}>{t("API base URL")}</span>
            <input
              aria-label={t("API base URL")}
              autoCapitalize="off"
              autoCorrect="off"
              className={`${settingsInput} w-full font-mono`}
              disabled={busy}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              spellCheck={false}
              value={baseUrl}
            />
          </label>
          {keyless ? null : (
            <label className={field}>
              <span className="flex items-center justify-between">
                <span className={label}>
                  {t("API key")}
                  {preset?.keyOptional ? ` · ${t("optional")}` : ""}
                </span>
                {preset?.keysUrl ? (
                  <a
                    className="inline-flex items-center gap-1 text-[12px] text-foreground underline underline-offset-2 hover:opacity-80"
                    href={preset.keysUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {t("Get a key")} <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </span>
              <input
                aria-label={t("API key")}
                autoComplete="off"
                className={`${settingsInput} w-full font-mono`}
                disabled={busy}
                onChange={(event) => setApiKey(event.target.value)}
                spellCheck={false}
                type="password"
                value={apiKey}
              />
            </label>
          )}
          {(preset?.group === "local" || preset?.keyOptional) && preset?.note ? (
            <p className="text-[12px] leading-4 text-foreground-secondary">{t(preset.note)}</p>
          ) : null}
          {error ? (
            <div className="text-[12px] text-red-600 dark:text-red-400" role="alert">
              {error}
            </div>
          ) : null}
          <DialogFooter className="mt-1 flex-row justify-end gap-2">
            <button
              className={settingsSecondaryButton}
              disabled={busy}
              onClick={() => onOpenChange(false)}
              type="button"
            >
              {t("Cancel")}
            </button>
            <button className={settingsPrimaryButton} disabled={!ready || busy} type="submit">
              {busy ? <LoadingOrb aria-hidden size={14} /> : null}
              {busy ? t("Checking the key…") : t("Add")}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
