import { describe, expect, test } from "bun:test";
import { isTrustedAssetDownloadUrl } from "../src/main/download-assets";

const assetId = "a".repeat(64);

describe("native asset download URL validation", () => {
  test("accepts the selected remote server and its path prefix", () => {
    expect(
      isTrustedAssetDownloadUrl(
        `https://files.example.test/team/api/v0/assets/${assetId}?name=report.docx&download=1`,
        ["https://files.example.test/team"]
      )
    ).toBe(true);
  });

  test("rejects another origin, path, or asset identifier", () => {
    const trusted = ["https://files.example.test/team"];
    expect(
      isTrustedAssetDownloadUrl(
        `https://other.example.test/team/api/v0/assets/${assetId}?download=1`,
        trusted
      )
    ).toBe(false);
    expect(
      isTrustedAssetDownloadUrl(
        `https://files.example.test/api/v0/assets/${assetId}?download=1`,
        trusted
      )
    ).toBe(false);
    expect(
      isTrustedAssetDownloadUrl(
        "https://files.example.test/team/api/v0/assets/not-an-asset?download=1",
        trusted
      )
    ).toBe(false);
  });
});
