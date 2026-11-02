import { useModelSetup } from "../../../hooks/use-model-setup";
import { providerName } from "../../../lib/provider-names";
import { LoadingOrb } from "../../ui/loading-orb";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { ModelTestStatus, primaryButton, secondaryButton, SignInProgress } from "../model-setup";
import { ModelPicker } from "../setup/model-picker";
import { ProviderMark } from "../setup/provider-marks";
import { SettingsGroup, SettingsRow } from "./ui";
import { settingsText, useSettingsLanguage } from "./language";

const selectTrigger =
  "h-7 rounded-[8px] border-black/[0.055] bg-black/[0.035] px-2 text-[12px] shadow-none dark:border-white/[0.07] dark:bg-white/[0.07]";

const reasoningLabel = (value: string, language: "en" | "zh"): string =>
  value === "off"
    ? settingsText(language, "Off", "关闭")
    : value === "xhigh"
      ? settingsText(language, "Extra high", "极高")
      : `${value[0]?.toUpperCase()}${value.slice(1)}`;

export default function ModelSettings() {
  const setup = useModelSetup();
  const { language } = useSettingsLanguage();
  const { data, provider, busy } = setup;
  const working = Boolean(busy) || setup.test.status === "running";
  const signingIn = Boolean(setup.authSession);

  return (
    <>
      <p className="mb-5 text-[13px] text-foreground-secondary">
        {settingsText(
          language,
          "Choose the AI provider and model for all bots on this server.",
          "选择此服务器上所有 Bot 使用的 AI 服务商和模型。"
        )}
      </p>
      <SettingsGroup>
        <SettingsRow
          anchors={["inference-provider"]}
          control={
            <Select
              disabled={!data || working}
              onValueChange={(value) => void setup.selectProvider(value)}
              value={setup.providerId}
            >
              <SelectTrigger aria-label={settingsText(language, "Provider", "服务商")} className={`${selectTrigger} w-[210px]`}>
                <SelectValue placeholder={settingsText(language, "Choose a provider", "选择服务商")} />
              </SelectTrigger>
              <SelectContent>
                {(data?.providers ?? []).map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    <span className="flex min-w-0 items-center gap-2">
                      {/* Names line up whether or not the provider has a mark. */}
                      <span className="grid size-3.5 shrink-0 place-items-center">
                        <ProviderMark id={candidate.id} />
                      </span>
                      <span className="truncate">{providerName(candidate.id, candidate.name)}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          description={settingsText(language, "The account your bots use to think. Sign-ins and keys stay on your server.", "Bot 思考时使用的账户。登录信息和密钥会保存在服务器上。")}
          title={settingsText(language, "Provider", "服务商")}
        />
        <SettingsRow
          control={
            provider?.connected ? (
              <button
                className={secondaryButton}
                disabled={working || signingIn}
                onClick={() => void setup.disconnect()}
                type="button"
              >
                {settingsText(language, "Disconnect", "断开连接")}
              </button>
            ) : signingIn ? null : (
              // The sign-in or key form below replaces these while it's open.
              <div className="flex items-center gap-2">
                {(provider?.authMethods ?? []).map((method) => (
                  <button
                    className={primaryButton}
                    disabled={working || signingIn}
                    key={method.type}
                    onClick={() => void setup.connect(method.type)}
                    type="button"
                  >
                    {busy === "connect" ? <LoadingOrb aria-hidden size={14} /> : null}
                    {method.type === "oauth"
                      ? settingsText(language, "Sign in", "登录")
                      : settingsText(language, "Add API key", "添加 API 密钥")}
                  </button>
                ))}
              </div>
            )
          }
          description={
            provider?.connected
              ? provider.authType === "oauth"
                ? settingsText(
                    language,
                    `Signed in with your ${providerName(provider.id, provider.name)} account.`,
                    `已使用 ${providerName(provider.id, provider.name)} 账户登录。`
                  )
                : /env/i.test(provider.authSource ?? "")
                  ? settingsText(language, "Using an API key from the server's environment.", "正在使用服务器环境中的 API 密钥。")
                  : settingsText(language, "Connected with an API key.", "已通过 API 密钥连接。")
              : settingsText(language, "Not connected.", "未连接。")
          }
          title={settingsText(language, "Connection", "连接状态")}
        />
        {signingIn ? <SignInProgress setup={setup} /> : null}
        <SettingsRow
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
          description={provider?.modelMessage ?? settingsText(language, "Used for every bot's work and background tasks.", "用于每个 Bot 的工作和后台任务。")}
          title={settingsText(language, "Model", "模型")}
        />
        <SettingsRow
          anchors={["inference-reasoning"]}
          control={
            <Select
              disabled={working || !setup.selectedModel?.reasoning}
              onValueChange={(value) =>
                setup.setReasoning(value as typeof setup.effectiveReasoning)
              }
              value={setup.effectiveReasoning}
            >
              <SelectTrigger aria-label={settingsText(language, "Reasoning effort", "推理强度")} className={`${selectTrigger} w-[130px]`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(setup.reasoningLevels.length ? setup.reasoningLevels : ["off"]).map((level) => (
                  <SelectItem key={level} value={level}>
                    {reasoningLabel(level, language)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          description={
            setup.selectedModel?.reasoning
              ? settingsText(language, "Higher effort is slower but more careful.", "更高的推理强度会更慢，但会更加谨慎。")
              : settingsText(language, "This model doesn't offer reasoning levels.", "此模型不支持推理强度选项。")
          }
          title={settingsText(language, "Reasoning effort", "推理强度")}
        />
        <div className="flex min-h-[52px] items-center justify-between gap-3 border-t border-black/[0.065] py-2 dark:border-white/[0.07]">
          <div className="min-w-0 text-[12px] text-foreground-secondary">
            {setup.test.status !== "idle" ? (
              <ModelTestStatus test={setup.test} />
            ) : data?.inference.modelId ? (
              `${settingsText(language, "In use", "当前使用")}: ${providerName(data.inference.providerId, data.providers.find((p) => p.id === data.inference.providerId)?.name)} · ${data.models.find((m) => m.modelId === data.inference.modelId)?.name ?? data.inference.modelId}`
            ) : data ? (
              settingsText(language, "No model chosen yet. Bots can't reply until you choose one.", "尚未选择模型。选择模型后 Bot 才能回复。")
            ) : (
              settingsText(language, "Loading…", "加载中…")
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {setup.test.status === "failed" &&
            provider?.connected &&
            provider.authType === "oauth" &&
            !signingIn ? (
              // A plan sign-in that expired is fixed by signing in again, not by disconnecting.
              <button
                className={secondaryButton}
                disabled={working}
                onClick={() => void setup.connect("oauth")}
                type="button"
              >
                {settingsText(language, "Sign in again", "重新登录")}
              </button>
            ) : null}
            <button
              className={secondaryButton}
              disabled={
                setup.changed ||
                !data?.inference.modelId ||
                working ||
                setup.test.status === "running"
              }
              onClick={() => void setup.runTest()}
              type="button"
            >
              {settingsText(language, "Test", "测试")}
            </button>
            <button
              className={primaryButton}
              disabled={!setup.changed || !provider?.connected || !setup.selectedModel || working}
              onClick={() => void setup.apply()}
              type="button"
            >
              {busy === "save" ? <LoadingOrb aria-hidden size={14} /> : null}
              {settingsText(language, "Apply", "应用")}
            </button>
          </div>
        </div>
      </SettingsGroup>
      {setup.error ? (
        <div className="mt-3 px-2 text-[12px] text-red-600 dark:text-red-400" role="alert">
          {setup.error}
          {!data ? (
            <button
              className={secondaryButton}
              disabled={working}
              onClick={() => void setup.reload()}
              type="button"
            >
              {settingsText(language, "Try again", "重试")}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
