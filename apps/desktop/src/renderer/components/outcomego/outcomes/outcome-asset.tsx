import { lazy, Suspense, useState } from "react";
import { useI18n } from "../../../lib/i18n";
import { outcomeAssetId } from "./outcome-asset-resource";

const AssetReader = lazy(() => import("./outcome-asset-reader"));

export function OutcomeAsset({ sourceRef }: { sourceRef: string }) {
  const { t } = useI18n();
  const [action, setAction] = useState<"preview" | "download" | null>(null);
  if (!outcomeAssetId(sourceRef)) return null;
  return <div className="space-y-2" data-asset-ref={sourceRef}>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => setAction("preview")}>{t("Inspect attached asset")}</button>
      <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => setAction("download")}>{t("Download attached asset")}</button>
    </div>
    {action && <Suspense fallback={<p role="status">{t("Loading attached asset…")}</p>}>
      <AssetReader key={`${sourceRef}:${action}`} sourceRef={sourceRef} action={action} onClose={() => setAction(null)} />
    </Suspense>}
  </div>;
}
