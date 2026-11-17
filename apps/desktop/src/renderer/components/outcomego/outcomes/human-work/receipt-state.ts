import type { HumanReceiptInput } from "@outcomego/contracts/human-work";

export interface ReceiptAsset {
  key: string;
  file: File;
  assetRef?: string;
  status: "pending" | "uploading" | "uploaded" | "error";
}
/** Reuses successful uploads across retries; a failure never erases another attachment. */
export async function uploadReceiptAssets(
  assets: readonly ReceiptAsset[],
  upload: (file: File) => Promise<{ assetRef: string }>,
  update: (key: string, changes: Partial<ReceiptAsset>) => void,
): Promise<string[]> {
  const refs: string[] = [];
  for (const asset of assets) {
    if (asset.assetRef) { refs.push(asset.assetRef); continue; }
    update(asset.key, { status: "uploading" });
    try {
      const uploaded = await upload(asset.file);
      refs.push(uploaded.assetRef);
      update(asset.key, { assetRef: uploaded.assetRef, status: "uploaded" });
    } catch (error) {
      update(asset.key, { status: "error" });
      throw error;
    }
  }
  return refs;
}
export const receiptObservations = (values: Record<string, string>): HumanReceiptInput["observations"] =>
  Object.entries(values).filter(([, value]) => value.trim()).map(([criterionId, value]) => ({ criterionId, result: "observed", value }));
