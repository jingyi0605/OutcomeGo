import { expect, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../src/renderer/lib/i18n";
import {
  loadOutcomeAsset,
  outcomeAssetId,
} from "../src/renderer/components/outcomego/outcomes/outcome-asset-resource";
import { OutcomeAsset } from "../src/renderer/components/outcomego/outcomes/outcome-asset";
import { ReviewPanel } from "../src/renderer/components/outcomego/outcomes/detail/review-panel";
import { OutcomeDetail } from "../src/renderer/components/outcomego/outcomes/detail/outcome-detail";
import { HumanAction } from "../src/renderer/components/outcomego/outcomes/human-work/human-action";
import type { OutcomeClient } from "../src/renderer/client/outcome-api";
import type { InboxClient } from "../src/renderer/components/outcomego/outcomes/inbox/inbox-api";
import type { HumanMaterialClient } from "../src/renderer/components/outcomego/outcomes/human-work/human-api";
import { outcomeFixture } from "./outcome-fixture";
import { humanFixture } from "./outcome-client-fixtures";

const hash = "a".repeat(64);
const sourceRef = `asset:${hash}`;
const render = (element: ReactNode) =>
  renderToStaticMarkup(createElement(I18nProvider, { children: element }));
const outcome = {
  ...outcomeFixture,
  evidence: [
    {
      ...outcomeFixture.evidence[0]!,
      sourceType: "asset" as const,
      sourceRef,
      contentSummary: "Human-submitted receipt asset",
    },
  ],
};

test("asset-only Review material is inspectable and downloadable even when review is read-only", () => {
  const html = render(
    createElement(ReviewPanel, {
      receiptReview: true,
      outcome: { ...outcome, status: "accepted" },
      busy: false,
      onSubmit() {},
      onRework() {},
    })
  );
  expect(html).toContain('aria-label="Attached review materials"');
  expect(html).toContain(`data-asset-ref="${sourceRef}"`);
  expect(html).toContain(">Inspect attached asset</button>");
  expect(html).toContain(">Download attached asset</button>");
  expect(html.indexOf(">Inspect attached asset</button>")).toBeLessThan(
    html.indexOf('<fieldset disabled=""')
  );
  expect(html).not.toContain("https://");
});

test("actual N Review excludes successor material and leaves nonasset evidence selection unchanged", () => {
  const original = outcome.currentRevisionView!;
  const html = render(
    createElement(ReviewPanel, {
      receiptReview: true,
      outcome: {
        ...outcome,
        currentRevision: 2,
        currentRevisionView: { ...original, revision: 2, status: "pending_approval" },
        evidence: [
          ...outcome.evidence,
          {
            ...outcome.evidence[0]!,
            id: "future",
            contractRevision: 2,
            sourceRef: `asset:${"b".repeat(64)}`,
          },
          { ...outcomeFixture.evidence[0]!, id: "nonasset" },
        ],
      },
      reviewRevisionView: original,
      busy: false,
      onSubmit() {},
      onRework() {},
    })
  );
  expect(html).toContain(`data-asset-ref="${sourceRef}"`);
  expect(html).not.toContain(`data-asset-ref="asset:${"b".repeat(64)}"`);
  expect(html).toContain("Costs were not compared");
  expect(html).toContain('type="checkbox"');
});

test("Outcome Evidence starts collapsed; submitted receipt history exposes the actual asset control", () => {
  const detail = render(
    createElement(OutcomeDetail, {
      outcomeId: outcome.id,
      initialOutcome: outcome,
      client: {} as OutcomeClient,
    })
  );
  expect(detail).toContain("More details");
  expect(detail).not.toContain("Review evidence");
  const { document } = parseHTML(detail);
  const asset = document.querySelector(`[data-asset-ref="${sourceRef}"]`);
  const materials = asset?.closest("details");
  expect(materials?.querySelector("summary")?.textContent).toContain("Attached review materials");
  expect(materials?.hasAttribute("open")).toBe(false);
  const human = render(
    createElement(HumanAction, {
      workItemId: humanFixture.id,
      client: {} as InboxClient,
      materials: {} as HumanMaterialClient,
      upload: async () => ({ assetRef: sourceRef }),
      onReview() {},
      initialItem: {
        ...humanFixture,
        receipts: [
          {
            id: "receipt-1",
            workItemId: humanFixture.id,
            outcomeId: humanFixture.outcomeId,
            sequence: 1,
            status: "accepted",
            submittedBy: "owner:local",
            submittedAt: "2026-11-17T00:00:00Z",
            reviewComment: "",
            payload: {
              clientRequestId: "receipt-request",
              expectedContractRevision: 1,
              comment: "",
              text: "",
              assetRefs: [sourceRef],
              sourceRefs: [],
              observations: [],
            },
            evidenceIds: ["evidence-1"],
            missingRequirements: [],
          },
        ],
      },
    })
  );
  expect(human).toContain("Receipt history");
  expect(human).toContain(`data-asset-ref="${sourceRef}"`);
  expect(human).toContain(">Inspect attached asset</button>");
});

test("malformed and external source refs never become authenticated asset requests", async () => {
  let requests = 0;
  for (const invalid of [
    "https://example.test/asset",
    `asset:${hash}/other`,
    `asset:${"A".repeat(64)}`,
    "asset:short",
  ]) {
    expect(outcomeAssetId(invalid)).toBeNull();
    expect(render(createElement(OutcomeAsset, { sourceRef: invalid }))).toBe("");
    await expect(
      loadOutcomeAsset(
        invalid,
        {
          assetUrl() {
            requests++;
            return "";
          },
          headers: () => ({}),
          generation: () => 0,
          expire() {},
        },
        new AbortController().signal
      )
    ).rejects.toThrow("Invalid asset reference");
  }
  expect(requests).toBe(0);
});

test("asset reader uses authenticated HEAD metadata for image, PDF and log previews", async () => {
  for (const [mime, kind, extension] of [
    ["image/png", "image", ".png"],
    ["application/pdf", "pdf", ".pdf"],
    ["text/plain; charset=utf-8", "text", ".txt"],
  ] as const) {
    const signal = new AbortController().signal;
    const value = await loadOutcomeAsset(
      sourceRef,
      {
        assetUrl: (id) => `https://server.test/api/v0/assets/${id}`,
        headers: () => ({ authorization: "Bearer current-account" }),
        generation: () => 1,
        expire() {},
        fetch: async (url, init) => {
          expect(url).toBe(`https://server.test/api/v0/assets/${hash}`);
          expect(init?.method).toBe("HEAD");
          expect(init?.redirect).toBe("error");
          expect(init?.signal).toBe(signal);
          expect(new Headers(init?.headers).get("authorization")).toBe("Bearer current-account");
          return new Response(null, {
            headers: { "content-type": mime!, "content-length": "312" },
          });
        },
      },
      signal
    );
    expect(value.assetId).toBe(hash);
    expect(value.byteSize).toBe(312);
    expect(value.kind).toBe(kind);
    expect(value.fileName).toBe(`${hash}${extension}`);
  }
});

test("401 expires only the requesting session; stale and aborted reads never expose metadata", async () => {
  const expired: Array<string | null> = [];
  let generation = 1;
  const controller = new AbortController();
  const transport = {
    assetUrl: () => "https://server.test/api/v0/assets/" + hash,
    headers: () => ({ authorization: "Bearer old-account" }),
    generation: () => generation,
    expire: (token: string | null) => {
      expired.push(token);
    },
    fetch: async () => new Response(null, { status: 401 }),
  };
  await expect(loadOutcomeAsset(sourceRef, transport, controller.signal)).rejects.toThrow("(401)");
  expect(expired).toEqual(["old-account"]);
  expired.length = 0;
  await expect(
    loadOutcomeAsset(
      sourceRef,
      {
        ...transport,
        fetch: async () => {
          generation++;
          return new Response(null, { status: 401 });
        },
      },
      controller.signal
    )
  ).rejects.toThrow("cancelled");
  expect(expired).toEqual([]);
  controller.abort();
  await expect(loadOutcomeAsset(sourceRef, transport, controller.signal)).rejects.toThrow(
    "cancelled"
  );
  expect(expired).toEqual([]);
});

test("unavailable metadata and missing assets fail explicitly rather than inventing a preview", async () => {
  for (const response of [
    new Response(null, { status: 404 }),
    new Response(null, { headers: { "content-type": "image/png" } }),
  ]) {
    await expect(
      loadOutcomeAsset(
        sourceRef,
        {
          assetUrl: () => "https://server.test/api/v0/assets/" + hash,
          headers: () => ({}),
          generation: () => 1,
          expire() {},
          fetch: async () => response,
        },
        new AbortController().signal
      )
    ).rejects.toThrow();
  }
});
