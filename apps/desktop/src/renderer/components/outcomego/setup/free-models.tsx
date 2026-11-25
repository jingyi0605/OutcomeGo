import { ExternalLink } from "lucide-react";
import { useI18n } from "../../../lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { settingsSecondaryButton } from "../settings/ui";
import { ProviderIcon } from "./provider-icon";

export const FREE_MODEL_OFFERS = [
  {
    providerId: "zhipu-api",
    icon: "zhipu-color",
    name: "Zhipu GLM",
    modelId: "glm-4.7-flash",
    model: "GLM-4.7-Flash",
    limits: "Chinese-first model with tool calling. Text input and output are free. Use a standard API key and check your account’s rate limits before connecting.",
    detailsUrl: "https://docs.bigmodel.cn/cn/guide/start/pricing",
  },
  {
    providerId: "siliconflow-cn-api",
    icon: "siliconcloud-color",
    name: "SiliconFlow (China)",
    modelId: "Qwen/Qwen3-8B",
    model: "Qwen3-8B",
    limits: "One API key for multiple models. This setup selects the free Qwen3-8B. Use a verified account and check the model page for current request and token limits.",
    detailsUrl: "https://docs.siliconflow.cn/docs/userguide/faqs/rate-limit-and-upgradation",
  },
  {
    providerId: "openrouter",
    icon: "openrouter",
    name: "OpenRouter",
    modelId: "openrouter/free",
    model: "Free Models Router",
    limits: "Typically 20 requests per minute and 50 per day without purchased credits. Upstream capacity can vary.",
    detailsUrl: "https://openrouter.ai/docs/api/reference/limits",
  },
  {
    providerId: "groq-api",
    icon: "groq",
    name: "Groq",
    modelId: "openai/gpt-oss-20b",
    model: "GPT-OSS 20B",
    limits: "Use a Free plan key. Groq applies per-minute and daily request and token limits. Check the exact limits in your dashboard.",
    detailsUrl: "https://console.groq.com/docs/rate-limits",
  },
  {
    providerId: "gemini-api",
    icon: "gemini-color",
    name: "Google Gemini",
    modelId: "gemini-3.1-flash-lite",
    model: "Gemini 3.1 Flash-Lite",
    limits: "Use a free-tier project in an eligible region. Check per-project limits in AI Studio. Google may use free-tier prompts and replies to improve its products.",
    detailsUrl: "https://ai.google.dev/gemini-api/docs/rate-limits",
  },
] as const;

export type FreeModelOffer = (typeof FREE_MODEL_OFFERS)[number];

function ProviderLogo({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-10 shrink-0 place-items-center rounded-xl border bg-background"
      data-testid="free-provider-logo"
    >
      <ProviderIcon name={name} size={28} />
    </span>
  );
}

export function FreeModelsDialog({
  onChoose,
  onChooseOpenCode,
  onClose,
}: {
  onChoose: (offer: FreeModelOffer) => void;
  onChooseOpenCode?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
        <DialogHeader className="pr-6">
          <DialogTitle>{t("Free and limited-use models")}</DialogTitle>
          <DialogDescription>
            {t("Connect with your own API key. Check your provider’s limits and billing before you connect.")}
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border rounded-xl border">
          {FREE_MODEL_OFFERS.map((offer) => (
            <li key={offer.providerId} className="grid gap-2 px-3 py-3 sm:grid-cols-[1fr_auto]">
              <div className="flex min-w-0 gap-3">
                <ProviderLogo name={offer.icon} />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{t(offer.name)} · {t(offer.model)}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(offer.limits)}</p>
                  <a className="mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-2" href={offer.detailsUrl} rel="noopener noreferrer" target="_blank">
                    {t("Provider limits and terms")} <ExternalLink aria-hidden="true" className="size-3" />
                  </a>
                </div>
              </div>
              <button
                aria-label={t("Connect {provider}", { provider: t(offer.name) })}
                className={`${settingsSecondaryButton} w-fit self-center`}
                onClick={() => onChoose(offer)}
                type="button"
              >
                {t("Connect")}
              </button>
            </li>
          ))}
          <li className="grid gap-2 px-3 py-3 sm:grid-cols-[1fr_auto]">
            <div className="flex min-w-0 gap-3">
              <ProviderLogo name="opencode" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{t("OpenCode Zen free models")}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {onChooseOpenCode
                    ? t("Use free models with key public, or your own OpenCode API key. Quotas, rate limits, and data policies vary by model.")
                    : t("Available in the official OpenCode client. Quotas, rate limits, and data policies vary by model.")}
                </p>
                <a className="mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-2" href="https://opencode.ai/docs/zen/" rel="noopener noreferrer" target="_blank">
                  {t("Provider limits and terms")} <ExternalLink aria-hidden="true" className="size-3" />
                </a>
              </div>
            </div>
            {onChooseOpenCode ? (
              <button
                aria-label={t("Connect {provider}", { provider: "OpenCode Zen" })}
                className={`${settingsSecondaryButton} w-fit self-center`}
                onClick={onChooseOpenCode}
                type="button"
              >
                {t("Connect")}
              </button>
            ) : (
              <a
                className={`${settingsSecondaryButton} w-fit self-center`}
                href="https://opencode.ai/download"
                rel="noopener noreferrer"
                target="_blank"
              >
                {t("Open OpenCode")} <ExternalLink aria-hidden="true" className="size-3" />
              </a>
            )}
          </li>
        </ul>
      </DialogContent>
    </Dialog>
  );
}
