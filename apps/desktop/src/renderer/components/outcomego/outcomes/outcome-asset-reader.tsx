import type { AssetRef } from "@outcomego/contracts";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../../../client/outcomego-api";
import { authHeaders, expireAuthToken, getAuthCredentialGeneration, subscribeAuthSnapshot } from "../../../client/auth";
import { useI18n } from "../../../lib/i18n";
import { downloadAttachments, FileAttachmentPreview } from "../file-attachment";
import { loadOutcomeAsset } from "./outcome-asset-resource";

export default function OutcomeAssetReader({ sourceRef, action, onClose }: {
  sourceRef: string; action: "preview" | "download"; onClose: () => void;
}) {
  const { t } = useI18n();
  const generation = useSyncExternalStore(subscribeAuthSnapshot, getAuthCredentialGeneration);
  const [initialGeneration] = useState(generation);
  const [attachment, setAttachment] = useState<{ value: AssetRef; generation: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setAttachment(null); setFailed(false);
    void loadOutcomeAsset(sourceRef, {
      assetUrl: api.assetUrl, headers: authHeaders, generation: getAuthCredentialGeneration, expire: expireAuthToken,
    }, controller.signal).then(async value => {
      if (controller.signal.aborted || generation !== getAuthCredentialGeneration()) return;
      if (action === "download") {
        await downloadAttachments([value]);
        if (!controller.signal.aborted && generation === getAuthCredentialGeneration()) onClose();
      } else setAttachment({ value, generation });
    }).catch(() => {
      if (!controller.signal.aborted && generation === getAuthCredentialGeneration()) setFailed(true);
    });
    return () => controller.abort();
  }, [sourceRef, action, attempt]);
  // A change of credentials closes this reader; no previous account's material is retained.
  useEffect(() => {
    if (initialGeneration !== generation) onClose();
  }, [initialGeneration, generation, onClose]);
  if (initialGeneration !== generation) return null;
  return <>
    {failed ? <div role="alert"><p>{t("Could not read the attached asset. Check your connection and access, then retry.")}</p><button type="button" className="rounded border px-3 py-2" onClick={() => setAttempt(value => value + 1)}>{t("Retry")}</button><button type="button" className="rounded border px-3 py-2" onClick={onClose}>{t("Close")}</button></div> :
      !attachment && <p role="status">{t("Loading attached asset…")}</p>}
    {attachment?.generation === generation && <FileAttachmentPreview attachment={attachment.value} open onOpenChange={open => { if (!open) onClose(); }} />}
  </>;
}
