import { Schema } from "effect";

export const AssetKind = Schema.Literal("image", "video", "audio", "pdf", "text", "file");
export type AssetKind = typeof AssetKind.Type;

/** Canonical persisted reference to bytes owned by OutcomeGo's content-addressed asset store. */
export const AssetRef = Schema.Struct({
  assetId: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
  fileName: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255)),
  mimeType: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
  byteSize: Schema.Number.pipe(Schema.int(), Schema.between(0, 200 * 1024 * 1024)),
  kind: AssetKind,
  width: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThan(0))),
  height: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThan(0))),
  alt: Schema.optional(Schema.String.pipe(Schema.maxLength(2_000))),
});
export type AssetRef = typeof AssetRef.Type;
