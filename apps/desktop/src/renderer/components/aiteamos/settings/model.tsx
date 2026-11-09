import { Plus, X } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../ui/alert-dialog";
import { AddProviderDialog } from "./add-provider-dialog";
import { SettingsSelectContent } from "./select-content";
import { useModelSetup } from "../../../hooks/use-model-setup";
import { providerName } from "../../../lib/provider-names";
import { LoadingOrb } from "../../ui/loading-orb";
import {
  Select,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { ModelTestStatus, SignInProgress } from "../model-setup";
import { ModelPicker } from "../setup/model-picker";
import { useI18n } from "../../../lib/i18n";
import { ProviderRowMark } from "../setup/provider-icon";
import {
  SettingsGroup,
  SettingsRow,
  SettingsIntro,
  settingsPrimaryButton,
  settingsSecondaryButton,
  settingsSelect,
  settingsRow,
  settingsInput,
} from "./ui";

// Not a provider id (ids start with a letter or digit): picking it opens the add dialog.
const ADD_PROVIDER = "__add-provider__";

const selectTrigger = settingsSelect;

const reasoningLabel = (value: string): string =>
  value === "off"
    ? "Off"
    : value === "xhigh"
      ? "Extra high"
      : `${value[0]?.toUpperCase()}${value.slice(1)}`;

export default function ModelSettings() {
  const { t } = useI18n();
  const setup = useModelSetup();
  const { data, provider, busy } = setup;
  const working = Boolean(busy) || setup.test.status === "running";
  const signingIn = Boolean(setup.authSession);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // A finished sign-in stays on screen as "Connected"; only a running one blocks adding.
  const signInRunning =
    signingIn && !["connected", "failed", "cancelled"].includes(setup.authSession?.status ?? "");

  return (
    <>
      <SettingsIntro>
        {t("Choose the AI provider and model for all bots on this server.")}
      </SettingsIntro>
      <SettingsGroup>
        <SettingsRow
          stackControl
          anchors={["inference-provider"]}
          control={
            <Select
              disabled={!data || working}
              onOpenChange={setListOpen}
              open={listOpen}
              onValueChange={(value) => {
                if (value === ADD_PROVIDER) setAdding(true);
                else void setup.selectProvider(value);
              }}
              value={setup.providerId}
            >
              <SelectTrigger aria-label={t("Provider")} className={`${selectTrigger} w-[210px]`}>
                <SelectValue placeholder={t("Choose a provider")} />
              </SelectTrigger>
              <SettingsSelectContent>
                {(data?.providers ?? []).map((candidate) => {
                  // The provider bots use now stays; any other one added by hand can go.
                  const removable =
                    candidate.custom &&
                    !(
                      data?.inference.providerId === candidate.id && Boolean(data.inference.modelId)
                    );
                  return (
                    <div className="group relative" key={candidate.id}>
                      <SelectItem value={candidate.id}>
                        <span className="flex min-w-0 items-center gap-2">
                          {/* Names line up whether or not the provider has a mark. */}
                          <span className="grid size-3.5 shrink-0 place-items-center">
                            <ProviderRowMark icon={candidate.icon} id={candidate.id} />
                          </span>
                          <span className="truncate">
                            {providerName(candidate.id, candidate.name)}
                          </span>
                        </span>
                      </SelectItem>
                      {removable ? (
                        // A sibling of the item, not inside it: the item's content is copied into the
                        // closed trigger, and a click here must not choose the provider.
                        <button
                          aria-label={t("Remove {name}", {
                            name: providerName(candidate.id, candidate.name),
                          })}
                          className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-[5px] text-foreground-secondary opacity-0 outline-none transition-opacity hover:bg-black/[0.08] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 group-hover:opacity-100 dark:hover:bg-white/[0.12]"
                          data-testid={`remove-provider-${candidate.id}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            // Close the list first: two overlays that hide the page at once
                            // leave the Settings dialog marked hidden for screen readers.
                            setListOpen(false);
                            setRemoving({
                              id: candidate.id,
                              name: providerName(candidate.id, candidate.name),
                            });
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                          type="button"
                        >
                          <X aria-hidden className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                <SelectSeparator />
                <SelectItem value={ADD_PROVIDER}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="grid size-3.5 shrink-0 place-items-center">
                      <Plus aria-hidden className="size-3.5" />
                    </span>
                    <span className="truncate">{t("Add provider")}</span>
                  </span>
                </SelectItem>
              </SettingsSelectContent>
            </Select>
          }
          description={t(
            "The account your bots use to think. Sign-ins and keys stay on your server."
          )}
          title={t("Provider")}
        />
        <SettingsRow
          control={
            provider?.connected ? (
              <div className="flex items-center gap-2">
                <button
                  className={settingsSecondaryButton}
                  disabled={working || signingIn}
                  onClick={() => void setup.disconnect()}
                  type="button"
                >
                  {t("Disconnect")}
                </button>
              </div>
            ) : signingIn ? null : (
              // The sign-in or key form below replaces these while it's open.
              <div className="flex items-center gap-2">
                {(provider?.authMethods ?? []).map((method) => (
                  <button
                    className={settingsPrimaryButton}
                    disabled={working || signingIn}
                    key={method.type}
                    onClick={() => void setup.connect(method.type)}
                    type="button"
                  >
                    {busy === "connect" ? <LoadingOrb aria-hidden size={14} /> : null}
                    {method.type === "oauth" ? t("Sign in") : t("Add API key")}
                  </button>
                ))}
              </div>
            )
          }
          description={
            provider?.connected
              ? provider.authType === "oauth"
                ? t("Signed in with your {provider} account.", {
                    provider: providerName(provider.id, provider.name),
                  })
                : /env/i.test(provider.authSource ?? "")
                  ? t("Using an API key from the server's environment.")
                  : t("Connected with an API key.")
              : t("Not connected.")
          }
          title={t("Connection")}
        />
        {signingIn ? (
          <SignInProgress
            setup={setup}
            controlStyles={{
              primaryButton: settingsPrimaryButton,
              secondaryButton: settingsSecondaryButton,
              input: settingsInput,
            }}
          />
        ) : null}
        <SettingsRow
          stackControl
          anchors={["inference-model"]}
          control={
            <ModelPicker
              models={data?.models ?? []}
              value={setup.modelId}
              providerName={providerName(setup.providerId, provider?.name)}
              disabled={working || !provider?.connected || !data?.models.length}
              onChange={setup.selectModel}
              variant="settings"
            />
          }
          description={
            provider?.modelMessage ?? t("Used for every bot's work and background tasks.")
          }
          title={t("Model")}
        />
        <SettingsRow
          stackControl
          anchors={["inference-reasoning"]}
          control={
            <Select
              disabled={working || !setup.selectedModel?.reasoning}
              onValueChange={(value) =>
                setup.setReasoning(value as typeof setup.effectiveReasoning)
              }
              value={setup.effectiveReasoning}
            >
              <SelectTrigger
                aria-label={t("Reasoning effort")}
                className={`${selectTrigger} w-[130px]`}
              >
                <SelectValue />
              </SelectTrigger>
              <SettingsSelectContent>
                {(setup.reasoningLevels.length ? setup.reasoningLevels : ["off"]).map((level) => (
                  <SelectItem key={level} value={level}>
                    {t(reasoningLabel(level))}
                  </SelectItem>
                ))}
              </SettingsSelectContent>
            </Select>
          }
          description={
            setup.selectedModel?.reasoning
              ? t("Higher effort is slower but more careful.")
              : t("This model doesn't offer reasoning levels.")
          }
          title={t("Reasoning effort")}
        />
        <div className={`${settingsRow} flex-wrap justify-between`}>
          <div className="min-w-0 text-[12px] text-foreground-secondary">
            {setup.test.status !== "idle" ? (
              <ModelTestStatus test={setup.test} />
            ) : data?.inference.modelId ? (
              t("In use: {provider} · {model}", {
                provider: providerName(
                  data.inference.providerId,
                  data.providers.find((p) => p.id === data.inference.providerId)?.name
                ),
                model:
                  data.models.find((m) => m.modelId === data.inference.modelId)?.name ??
                  data.inference.modelId,
              })
            ) : data ? (
              t("No model chosen yet. Bots can't reply until you choose one.")
            ) : (
              t("Loading…")
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {setup.test.status === "failed" &&
            provider?.connected &&
            provider.authType === "oauth" &&
            !signingIn ? (
              // A plan sign-in that expired is fixed by signing in again, not by disconnecting.
              <button
                className={settingsSecondaryButton}
                disabled={working}
                onClick={() => void setup.connect("oauth")}
                type="button"
              >
                {t("Sign in again")}
              </button>
            ) : null}
            <button
              className={settingsSecondaryButton}
              disabled={
                setup.changed ||
                !data?.inference.modelId ||
                working ||
                setup.test.status === "running"
              }
              onClick={() => void setup.runTest()}
              type="button"
            >
              {t("Test")}
            </button>
            <button
              className={settingsPrimaryButton}
              disabled={!setup.changed || !provider?.connected || !setup.selectedModel || working}
              onClick={() => void setup.apply()}
              type="button"
            >
              {busy === "save" ? <LoadingOrb aria-hidden size={14} /> : null}
              {t("Apply")}
            </button>
          </div>
        </div>
      </SettingsGroup>
      <AlertDialog onOpenChange={(open) => !open && setRemoving(null)} open={Boolean(removing)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Remove {name}?", { name: removing?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("Its address and key are deleted from your server.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                const target = removing;
                if (!target) return;
                void setup.removeProvider(target.id).then((done) => done && setRemoving(null));
              }}
            >
              {t("Remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AddProviderDialog
        onAdd={async (input, apiKey) => {
          const result = await setup.addProvider(input, apiKey);
          return result;
        }}
        onOpenChange={setAdding}
        open={adding}
      />
      {setup.error ? (
        <div className="mt-3 px-2 text-[12px] text-red-600 dark:text-red-400" role="alert">
          {setup.error}
          {!data ? (
            <button
              className={settingsSecondaryButton}
              disabled={working}
              onClick={() => void setup.reload()}
              type="button"
            >
              {t("Try again")}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
