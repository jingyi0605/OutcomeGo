import {
  defaultTranscriptionSettings,
  type TranscriptionSettings,
  type TranscriptionSettingsView,
} from "@openteam/contracts/transcription";
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../client/openteam-api";
import { requestRuntimeRefresh } from "../../../lib/runtime-refresh";
import {
  MODEL_TEST_DEADLINE_MS,
  requestErrorMessage,
  withDeadline,
} from "../../../lib/request-errors";
import {
  HOSTED_TRANSCRIPTION_ENDPOINTS,
  HOSTED_TRANSCRIPTION_MODELS,
} from "../../../lib/transcription-providers";
import { LoadingOrb } from "../../ui/loading-orb";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { primaryButton, secondaryButton } from "../model-setup";
import { ProviderMark } from "../setup/provider-marks";
import { InteractiveSwitch, SectionLabel, SettingsGroup, SettingsRow } from "./ui";
import { settingsText, useSettingsLanguage } from "./language";
import "./transcription.css";

const inputClass = "transcription-input";

export default function VoiceNotesSettings() {
  return <TranscriptionSettingsPanel />;
}

export function TranscriptionSettingsPanel() {
  const { language } = useSettingsLanguage();
  const [saved, setSaved] = useState<TranscriptionSettingsView | null>(null);
  const [draft, setDraft] = useState<TranscriptionSettings>(defaultTranscriptionSettings);
  const [apiKey, setApiKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState<"load" | "save" | "check" | null>("load");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setBusy("load");
    setMessage("");
    setFailed(false);
    try {
      const value = await withDeadline(() => api.transcriptionSettings());
      if (version !== loadVersion.current) return;
      setSaved(value);
      const untouched = !value.configured && !value.baseUrl && !value.hasApiKey;
      setDraft(
        untouched
          ? {
              ...value,
              provider: "openai",
              baseUrl: HOSTED_TRANSCRIPTION_ENDPOINTS.openai ?? "",
              model: HOSTED_TRANSCRIPTION_MODELS.openai ?? "",
            }
          : value
      );
      setFailed(false);
    } catch (error) {
      if (version !== loadVersion.current) return;
      setFailed(true);
      setMessage(requestErrorMessage(error, "Could not load transcription settings. Try again."));
    } finally {
      if (version === loadVersion.current) setBusy(null);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      loadVersion.current++;
    };
  }, [load]);
  const change = <K extends keyof TranscriptionSettings>(
    key: K,
    value: TranscriptionSettings[K]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  };
  const sameEndpoint = saved?.provider === draft.provider && saved.baseUrl === draft.baseUrl;
  const hasSavedKey = sameEndpoint && saved?.hasApiKey && !removeKey;
  const changed =
    saved &&
    (apiKey !== "" ||
      removeKey ||
      (["enabled", "provider", "baseUrl", "model", "language"] as const).some(
        (key) => saved[key] !== draft[key]
      ));
  const save = async () => {
    if (!saved) return;
    setBusy("save");
    setMessage("");
    try {
      const key = apiKey.trim();
      const value = await withDeadline(() =>
        api.updateTranscriptionSettings({
          ...draft,
          baseUrl: draft.baseUrl.trim(),
          model: draft.model.trim(),
          language: draft.language.trim(),
          ...(key ? { apiKey: key } : removeKey ? { apiKey: null } : {}),
        })
      );
      setSaved(value);
      setDraft(value);
      setApiKey("");
      setRemoveKey(false);
      requestRuntimeRefresh();
      setFailed(false);
      setMessage(
        value.configured
          ? "Saved. Voice notes are enabled on connected devices."
          : "Saved. Voice notes are disabled."
      );
    } catch (error) {
      setFailed(true);
      setMessage(requestErrorMessage(error, "Could not save transcription settings. Try again."));
    } finally {
      setBusy(null);
    }
  };
  const check = async () => {
    setBusy("check");
    setMessage("");
    try {
      const result = await withDeadline(() => api.checkTranscription(), MODEL_TEST_DEADLINE_MS);
      setFailed(result.level === "fail");
      setMessage(result.detail);
    } catch (error) {
      setFailed(true);
      setMessage(requestErrorMessage(error, "Could not check transcription. Try again."));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="transcription-settings">
      <p className="mb-5 text-[13px] leading-5 text-foreground-secondary">
        {settingsText(
          language,
          "Turn recordings into text you can review before sending. Shared by all apps connected to this server.",
          "将录音转换为文字，发送前可以先检查。此设置会应用于连接到此服务器的所有应用。"
        )}
      </p>
      {!saved ? (
        <SettingsGroup>
          <div
            className="flex min-h-[72px] items-center gap-2 py-4 text-[13px] text-foreground-secondary"
            role={failed ? "alert" : "status"}
          >
            {busy ? (
              <>
                <LoadingOrb aria-hidden size={16} /> {settingsText(language, "Loading voice notes…", "正在加载语音消息…")}
              </>
            ) : (
              <>
                <span className="flex-1">{message}</span>
                <button className={secondaryButton} onClick={() => void load()} type="button">
                  {settingsText(language, "Try again", "重试")}
                </button>
              </>
            )}
          </div>
        </SettingsGroup>
      ) : (
        <fieldset disabled={Boolean(busy)} className="min-w-0">
          <SettingsGroup>
            <SettingsRow
              title={settingsText(language, "Voice notes", "语音消息")}
              description={settingsText(language, "Enable transcription for recorded messages on desktop and iPhone.", "为桌面端和 iPhone 上的录音消息启用转写。")}
              control={
                <InteractiveSwitch
                  label={settingsText(language, "Enable voice notes", "启用语音消息")}
                  checked={draft.enabled}
                  onChange={(value) => change("enabled", value)}
                />
              }
            />
          </SettingsGroup>
          <SectionLabel>{settingsText(language, "Transcription service", "转写服务")}</SectionLabel>
          <SettingsGroup className="transcription-fields">
            <SettingsRow
              title={settingsText(language, "Provider", "服务商")}
              className="transcription-setting-row"
              control={
                <Select
                  value={draft.provider}
                  onValueChange={(value) => {
                    const provider = value as TranscriptionSettings["provider"];
                    setDraft((current) => ({
                      ...current,
                      provider,
                      baseUrl: HOSTED_TRANSCRIPTION_ENDPOINTS[provider] ?? "",
                      model: HOSTED_TRANSCRIPTION_MODELS[provider] ?? "",
                    }));
                    setApiKey("");
                    setRemoveKey(false);
                    setMessage("");
                  }}
                >
                  <SelectTrigger
                    aria-label={settingsText(language, "Transcription provider", "转写服务商")}
                    className="transcription-input"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">
                      <span className="flex items-center gap-2">
                        <ProviderMark id="openai" /> OpenAI
                      </span>
                    </SelectItem>
                    <SelectItem value="deepgram">
                      <span className="flex items-center gap-2">
                        <ProviderMark id="deepgram" /> Deepgram
                      </span>
                    </SelectItem>
                    <SelectItem value="openai-compatible">
                      <span className="flex items-center gap-2">
                        {/* A custom service has no brand; iPhone shows the same sparkles. */}
                        <Sparkles aria-hidden className="size-3.5 text-violet-500" strokeWidth={1.8} />
                        {settingsText(language, "Custom / OpenAI-compatible", "自定义 / OpenAI 兼容")}
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            {draft.provider === "openai-compatible" ? (
              <SettingsRow
                title={settingsText(language, "Base URL", "基础 URL")}
                className="transcription-setting-row"
                description={settingsText(language, "An audio service reachable from your OpenTeam server.", "OpenTeam 服务器可以访问的音频服务地址。")}
                control={
                  <input
                    className={inputClass}
                    aria-label={settingsText(language, "Transcription base URL", "转写基础 URL")}
                    inputMode="url"
                    spellCheck={false}
                    value={draft.baseUrl}
                    placeholder="http://audio-server:8000/v1"
                    onChange={(e) => change("baseUrl", e.target.value)}
                  />
                }
              />
            ) : null}
            <SettingsRow
              title={settingsText(language, "Model", "模型")}
              className="transcription-setting-row"
              control={
                <input
                  className={inputClass}
                  aria-label={settingsText(language, "Transcription model", "转写模型")}
                  spellCheck={false}
                  value={draft.model}
                  placeholder="Model ID"
                  onChange={(e) => change("model", e.target.value)}
                />
              }
            />
          </SettingsGroup>
          <SectionLabel>{settingsText(language, "Credentials and language", "凭据和语言")}</SectionLabel>
          <SettingsGroup className="transcription-fields">
            <SettingsRow
              title={settingsText(language, "API key", "API 密钥")}
              className="transcription-setting-row"
              description={
                hasSavedKey
                  ? settingsText(language, "A key is saved. Leave blank to keep it.", "已有密钥。留空即可保留。")
                  : settingsText(language, "Separate from chat sign-in. Keys stay on your server.", "与聊天登录分开。密钥会保存在服务器上。")
              }
              control={
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="new-password"
                  aria-label={settingsText(language, "Transcription API key", "转写 API 密钥")}
                  value={apiKey}
                  placeholder={hasSavedKey ? settingsText(language, "Key saved", "密钥已保存") : settingsText(language, "API key", "API 密钥")}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    if (e.target.value) setRemoveKey(false);
                    setMessage("");
                  }}
                />
              }
            />
            {saved.hasApiKey && sameEndpoint ? (
              <SettingsRow
                title={settingsText(language, "Remove saved key", "删除已保存的密钥")}
                control={
                  <InteractiveSwitch
                    label={settingsText(language, "Remove transcription API key", "删除转写 API 密钥")}
                    checked={removeKey}
                    onChange={(value) => {
                      setRemoveKey(value);
                      if (value) setApiKey("");
                      setMessage("");
                    }}
                  />
                }
              />
            ) : null}
            <SettingsRow
              title={settingsText(language, "Language", "语言")}
              className="transcription-setting-row"
              description={settingsText(language, "Leave blank to detect automatically, or use a code such as en.", "留空可自动检测，也可以填写 en 等语言代码。")}
              control={
                <input
                  className={inputClass}
                  aria-label={settingsText(language, "Transcription language", "转写语言")}
                  spellCheck={false}
                  value={draft.language}
                  placeholder={settingsText(language, "Automatic", "自动")}
                  onChange={(e) => change("language", e.target.value)}
                />
              }
            />
          </SettingsGroup>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className={secondaryButton}
              disabled={Boolean(busy) || Boolean(changed) || !saved.configured}
              onClick={() => void check()}
            >
              {busy === "check" ? <LoadingOrb aria-hidden size={14} /> : null}{" "}
              {settingsText(language, "Test connection", "测试连接")}
            </button>
            <button
              type="button"
              className={primaryButton}
              disabled={Boolean(busy) || !changed}
              onClick={() => void save()}
            >
              {busy === "save" ? <LoadingOrb aria-hidden size={14} /> : null}{" "}
              {settingsText(language, "Save", "保存")}
            </button>
          </div>
          {message ? (
            <p
              role={failed ? "alert" : "status"}
              className={`mt-3 text-[12px] leading-5 ${failed ? "text-red-600 dark:text-red-400" : "text-foreground-secondary"}`}
            >
              {message}
            </p>
          ) : null}
        </fieldset>
      )}
    </div>
  );
}
