import {
  PI_REASONING_LEVELS,
  type InferenceModelSelection,
  type PiReasoningLevel,
  type ServerSettingsView,
} from "@outcomego/contracts/inference";
import { useEffect, useState } from "react";
import { api } from "../../../client/outcomego-api";
import { cn } from "../../../lib/cn";
import { useI18n } from "../../../lib/i18n";
import { providerName } from "../../../lib/provider-names";
import { Select, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { ModelPicker } from "../setup/model-picker";
import { SettingsSelectContent } from "./select-content";
import { settingsSelect } from "./ui";

const DEFAULT_VALUE = "__default__";

const reasoningLabel = (value: string): string =>
  value === "off"
    ? "Off"
    : value === "xhigh"
      ? "Extra high"
      : `${value[0]?.toUpperCase()}${value.slice(1)}`;

/**
 * Shared provider/model/reasoning picker used by Outcome role overrides (6.1)
 * and per-bot model settings (6.5). Empty selection resets to `null`.
 */
export function ModelOverrideSelect({
  ariaLabel,
  className,
  defaultLabel,
  value,
  effectiveModel,
  fallbackWarning,
  disabled = false,
  onChange,
}: {
  ariaLabel: string;
  className?: string;
  defaultLabel: string;
  value: InferenceModelSelection | null | undefined;
  effectiveModel?: { providerId: string; modelId: string; reasoning?: PiReasoningLevel } | null;
  fallbackWarning?: string | null;
  disabled?: boolean;
  onChange: (next: InferenceModelSelection | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const [serverData, setServerData] = useState<ServerSettingsView | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeProviderId = value?.providerId ?? "";

  useEffect(() => {
    let active = true;
    api
      .serverSettings(activeProviderId || undefined)
      .then((next) => {
        if (active) setServerData(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeProviderId]);

  const providers = (serverData?.providers ?? []).filter((p) => p.connected);
  const selectedProvider = providers.find((p) => p.id === activeProviderId);
  const models = serverData?.models ?? [];
  const configuredUnavailable =
    Boolean(value) &&
    serverData !== null &&
    (!selectedProvider ||
      (serverData.inference.providerId === value!.providerId &&
        models.length > 0 &&
        !models.some((m) => m.modelId === value!.modelId)) ||
      (value!.providerId &&
        selectedProvider &&
        models.length > 0 &&
        !models.some((m) => m.modelId === value!.modelId)));

  const applySelection = async (next: InferenceModelSelection | null) => {
    setSaving(true);
    setError(null);
    try {
      await onChange(next);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("Could not update model."));
    } finally {
      setSaving(false);
    }
  };

  const handleProviderChange = async (providerId: string) => {
    if (providerId === DEFAULT_VALUE) {
      await applySelection(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const catalog = await api.serverSettings(providerId);
      setServerData(catalog);
      const firstModel =
        catalog.models.find((m) => m.recommended)?.modelId ?? catalog.models[0]?.modelId ?? "";
      if (!firstModel) {
        setError(t("No configured models available for this provider."));
        return;
      }
      const details = catalog.models.find((m) => m.modelId === firstModel);
      await onChange({
        providerId,
        modelId: firstModel,
        reasoning: details?.defaultReasoningLevel ?? catalog.inference.reasoning,
      });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("Could not update model."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn("grid w-[250px] max-w-full grid-cols-1 gap-1.5", className)}>
      <div className="grid min-w-0 grid-cols-1 justify-items-end gap-1.5">
        <Select
          disabled={disabled || saving}
          value={value ? value.providerId : DEFAULT_VALUE}
          onValueChange={(next) => void handleProviderChange(next)}
        >
          <SelectTrigger aria-label={ariaLabel} className={`${settingsSelect} w-full [&>span:first-child]:truncate`}>
            <SelectValue placeholder={defaultLabel} />
          </SelectTrigger>
          <SettingsSelectContent>
            <SelectItem value={DEFAULT_VALUE}>{defaultLabel}</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {providerName(p.id, p.name)}
              </SelectItem>
            ))}
          </SettingsSelectContent>
        </Select>

        {value && models.length > 0 && (
          <ModelPicker
            ariaLabel={`${ariaLabel} ${t("Model")}`}
            disabled={disabled || saving}
            models={models}
            onChange={(modelId) => {
              const details = models.find((m) => m.modelId === modelId);
              void applySelection({
                providerId: value.providerId,
                modelId,
                reasoning: value.reasoning ?? details?.defaultReasoningLevel ?? "medium",
              });
            }}
            providerName={providerName(value.providerId, selectedProvider?.name)}
            value={value.modelId}
            variant="settings"
          />
        )}

        {value && (
          <Select
            disabled={disabled || saving}
            value={value.reasoning ?? "medium"}
            onValueChange={(reasoning) =>
              void applySelection({
                providerId: value.providerId,
                modelId: value.modelId,
                reasoning: reasoning as PiReasoningLevel,
              })
            }
          >
            <SelectTrigger
              aria-label={`${ariaLabel} ${t("Reasoning")}`}
              className={`${settingsSelect} w-[130px] max-w-full`}
            >
              <SelectValue />
            </SelectTrigger>
            <SettingsSelectContent>
              {PI_REASONING_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {t(reasoningLabel(level))}
                </SelectItem>
              ))}
            </SettingsSelectContent>
          </Select>
        )}
      </div>

      {effectiveModel && (
        <p className="text-[11px] text-foreground-secondary">
          {t("Effective model")}: {effectiveModel.providerId} / {effectiveModel.modelId}
          {effectiveModel.reasoning ? ` · ${t(reasoningLabel(effectiveModel.reasoning))}` : ""}
        </p>
      )}
      {(fallbackWarning || configuredUnavailable) && (
        <p role="alert" className="text-[11px] text-amber-600 dark:text-amber-400">
          {fallbackWarning || t("Configured model is unavailable on this server; choose another or clear.")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
