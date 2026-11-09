import type { PluginConnectionView } from "@aiteamos/contracts";
import {
  GOOGLE_PLUGIN_KEYS,
  pluginAuthorization,
} from "@aiteamos/product-core/plugin-authorization";
import { api } from "../../../client/aiteamos-api";
import { useEffect, useState } from "react";
import { AiTeamOSClientError } from "@aiteamos/client-core/http";
import { useVisibleNow } from "../../../hooks/use-visible-now";
import { useI18n } from "../../../lib/i18n";

/** Manual sign-in stays in aiTeamOS until the user has read the copy/paste steps. */
export function openAutomaticPluginSignIn(callbackMode: string | undefined, url: string) {
  if (callbackMode !== "manual") window.open(url, "_blank", "noopener,noreferrer");
}

export function PluginAuthorization({
  connection,
  busy,
  onCancel,
  onRetry,
}: {
  connection: PluginConnectionView;
  busy: boolean;
  onCancel: () => void;
  onRetry: (force?: boolean) => void;
}) {
  const { t } = useI18n();
  const [callbackUrl, setCallbackUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [openedBrowser, setOpenedBrowser] = useState(false);
  useEffect(() => {
    setCallbackUrl("");
    setFeedback("");
    setOpenedBrowser(false);
  }, [connection.id, connection.authorizationUrl]);
  const now = useVisibleNow(1_000, Boolean(connection.authorizationUrl));
  const session = pluginAuthorization(connection, now);
  useEffect(() => {
    if (session?.expired) setCallbackUrl("");
  }, [session?.expired]);
  if (!session) return null;
  const manual = connection.oauthCallbackMode === "manual";
  const google = GOOGLE_PLUGIN_KEYS.includes(connection.pluginKey);
  const finish = async () => {
    if (submitting) return;
    const value = callbackUrl;
    setCallbackUrl("");
    setSubmitting(true);
    setFeedback("");
    try {
      await api.finishManualPluginAuthentication(connection.id, value);
      setFeedback(t("Authorization received. Refreshing connection status…"));
    } catch (error) {
      const status = await api.pluginConnectionStatuses([connection.id]).catch(() => null);
      setFeedback(
        status?.connections[0]?.status === "ready"
          ? t("Connected.")
          : error instanceof AiTeamOSClientError && error.code === "plugin_oauth_session_changed"
            ? t("This sign-in was started in another session. Select Start again to sign in here.")
            : t(
                "Could not finish sign-in. Copy the entire address from the browser’s final page and try pasting it again. If this sign-in expired, start again."
              )
      );
    } finally {
      setSubmitting(false);
    }
  };
  const action =
    "inline-flex items-center rounded-full bg-foreground/[0.06] px-3 py-1 text-[12px] hover:bg-foreground/[0.1] disabled:opacity-40";
  return (
    <div className="mx-3 mb-3 rounded-lg bg-foreground/[0.035] p-3" role="status">
      <p className="text-[12px] font-medium">
        {session.expired
          ? t("Sign-in expired")
          : manual && !openedBrowser
            ? t("Before you sign in")
            : t("Finish signing in")}
      </p>
      {manual && !session.expired ? (
        <ol className="mt-2 list-decimal space-y-2 pl-4 text-[12px] text-foreground-secondary">
          <li>
            {google
              ? t("Sign in to Google and approve access.")
              : t("Sign in in your browser and approve access.")}
          </li>
          <li>
            {t(
              "The browser may say it can’t open the page. That’s expected. Copy the entire address starting with 127.0.0.1 from the address bar."
            )}
          </li>
          <li>{t("Return to aiTeamOS, paste the address below, then select Complete sign-in.")}</li>
        </ol>
      ) : (
        <p className="mt-1 text-[11px] text-foreground-secondary">
          {session.expired
            ? t("Start again when you’re ready. Your setup is saved.")
            : t("Finish in your browser. If you closed it, reopen the same sign-in below.")}
        </p>
      )}
      {manual && !session.expired && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="password"
            aria-label={t("Browser address from sign-in")}
            placeholder={t("Paste the browser address here")}
            autoComplete="off"
            spellCheck={false}
            value={callbackUrl}
            onChange={(event) => setCallbackUrl(event.target.value)}
            className="min-w-0 flex-1 rounded border border-foreground/15 bg-transparent px-3 py-2 text-[12px]"
          />
          <button
            className={action}
            type="button"
            disabled={busy || submitting || !callbackUrl.trim()}
            onClick={() => void finish()}
          >
            {t("Complete sign-in")}
          </button>
        </div>
      )}
      {feedback && (
        <p role="status" className="mt-2 text-[12px]">
          {feedback}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        {session.expired ? (
          <button
            className={action}
            type="button"
            disabled={busy || submitting}
            onClick={() => onRetry(true)}
          >
            {t("Try again")}
          </button>
        ) : manual ? (
          <button
            className={action}
            type="button"
            disabled={busy || submitting}
            onClick={() => {
              window.open(session.url, "_blank", "noopener,noreferrer");
              setOpenedBrowser(true);
            }}
          >
            {openedBrowser
              ? t("Reopen sign-in")
              : google
                ? t("Continue to Google")
                : t("Continue to browser")}
          </button>
        ) : window.aiteamos?.pluginOAuth ? (
          <button
            className={action}
            type="button"
            disabled={busy || submitting}
            onClick={() => onRetry()}
          >
            {t("Reopen sign-in")}
          </button>
        ) : (
          <a className={action} href={session.url} target="_blank" rel="noopener noreferrer">
            {t("Reopen sign-in")}
          </a>
        )}
        {!session.expired && (
          <button
            className={action}
            type="button"
            disabled={busy || submitting}
            onClick={() => onRetry(true)}
          >
            {t("Start again")}
          </button>
        )}
        <button className={action} type="button" disabled={busy || submitting} onClick={onCancel}>
          {t("Cancel sign-in")}
        </button>
      </div>
    </div>
  );
}
