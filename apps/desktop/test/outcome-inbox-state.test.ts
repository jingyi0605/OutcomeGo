import { expect, test } from "bun:test";
import {
  canResolveDecision,
  DecisionController,
  isApprovalDecision,
} from "../src/renderer/components/outcomego/outcomes/inbox/decision-state";
import { createInboxApi } from "../src/renderer/components/outcomego/outcomes/inbox/inbox-api";
import { createHumanMaterialApi } from "../src/renderer/components/outcomego/outcomes/human-work/human-api";
import { createExploreApi } from "../src/renderer/components/outcomego/outcomes/explore/explore-api";
import {
  uploadReceiptAssets,
  type ReceiptAsset,
} from "../src/renderer/components/outcomego/outcomes/human-work/receipt-state";
import { decisionFixture, decisionResolutionFixture, fixtureIds } from "./outcome-client-fixtures";

test("Decision ambiguous failures preserve the same request ID and exact custom text", async () => {
  const inputs: unknown[] = [];
  let attempts = 0;
  const controller = new DecisionController(
    {
      decision: async () => decisionFixture,
      resolve: async (_id, input) => {
        inputs.push(input);
        if (++attempts === 1) throw new Error("offline");
        return decisionResolutionFixture;
      },
    },
    fixtureIds.decision
  );
  await controller.load();
  controller.edit({ optionId: "custom", customText: "  Preserve the owner's actual words.  " });
  await controller.resolve();
  expect(controller.snapshot().phase).toBe("error");
  await controller.resolve();
  expect(inputs[0]).toEqual(inputs[1]);
  expect(inputs[0]).toMatchObject({
    customText: "  Preserve the owner's actual words.  ",
    optionId: null,
    expectedContractRevision: 1,
  });
  expect(controller.snapshot().phase).toBe("resolved");
  expect(controller.snapshot().decision?.status).toBe("resolved");
});
test("Decision conflict reloads authoritative revision and keeps selection without auto-resolving", async () => {
  let reads = 0;
  let writes = 0;
  const controller = new DecisionController(
    {
      decision: async () => ({ ...decisionFixture, contractRevision: ++reads }),
      resolve: async () => {
        writes++;
        throw { status: 409 };
      },
    },
    fixtureIds.decision
  );
  await controller.load();
  controller.edit({ optionId: "source-a" });
  await controller.resolve();
  expect(controller.snapshot()).toMatchObject({
    phase: "conflict",
    optionId: "source-a",
    decision: { contractRevision: 2 },
  });
  expect(writes).toBe(1);
});
test("withdrawn Decision after conflict blocks another write and preserves user's choice", async () => {
  let reads = 0;
  let writes = 0;
  const controller = new DecisionController(
    {
      decision: async () => ({ ...decisionFixture, status: ++reads > 1 ? "withdrawn" : "open" }),
      resolve: async () => {
        writes++;
        throw { status: 409 };
      },
    },
    fixtureIds.decision
  );
  await controller.load();
  controller.edit({ optionId: "source-a" });
  await controller.resolve();
  await controller.resolve();
  expect(controller.snapshot()).toMatchObject({
    phase: "expired",
    optionId: "source-a",
    decision: { status: "withdrawn" },
  });
  expect(writes).toBe(1);
});
test("pending Decision disables duplicate submissions and local selection changes", async () => {
  let finish!: (value: typeof decisionResolutionFixture) => void;
  let writes = 0;
  const controller = new DecisionController(
    {
      decision: async () => decisionFixture,
      resolve: () => {
        writes++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
    fixtureIds.decision
  );
  await controller.load();
  controller.edit({ optionId: "source-a" });
  const pending = controller.resolve();
  await controller.resolve();
  controller.edit({ customText: "late edit" });
  expect(controller.snapshot().phase).toBe("resolving");
  expect(controller.snapshot().customText).toBe("");
  expect(writes).toBe(1);
  finish(decisionResolutionFixture);
  await pending;
});
test("stale reads cannot replace current Decision state after unmount", async () => {
  let finish!: (value: typeof decisionFixture) => void;
  const controller = new DecisionController(
    {
      decision: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      resolve: async () => decisionResolutionFixture,
    },
    fixtureIds.decision
  );
  const pending = controller.load();
  controller.dispose();
  finish(decisionFixture);
  await pending;
  expect(controller.snapshot().decision).toBeNull();
});
test("future Decision states, expired dates and removed choices never authorize a write", async () => {
  expect(
    canResolveDecision({ ...decisionFixture, status: "future" as typeof decisionFixture.status })
  ).toBe(false);
  expect(canResolveDecision({ ...decisionFixture, expiresAt: "2020-01-01T00:00:00Z" })).toBe(false);
  let writes = 0;
  const controller = new DecisionController(
    {
      decision: async () => decisionFixture,
      resolve: async () => {
        writes++;
        return decisionResolutionFixture;
      },
    },
    fixtureIds.decision
  );
  await controller.load();
  controller.edit({ optionId: "removed" });
  await controller.resolve();
  expect(writes).toBe(0);
});
test("Inbox and material adapters encode cursors/identities and keep business mutations server-owned", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, init });
    return {} as T;
  };
  const client = createInboxApi(request);
  const material = createHumanMaterialApi(request);
  const explore = createExploreApi(request);
  await client.list({ status: "completed", category: "completed", cursor: "a+/=&b" });
  await client.decision("a/b");
  await client.startHuman("a/b", { expectedContractRevision: 2, clientRequestId: "start:test" });
  await material.search(fixtureIds.outcome, "fixture");
  await explore.list("a+/=&b");
  expect(calls[0]?.path).toBe(
    "/api/outcome-inbox?status=completed&category=completed&cursor=a%2B%2F%3D%26b"
  );
  expect(calls[1]?.path).toBe("/api/decisions/a%2Fb");
  expect(JSON.parse(calls[2]?.init?.body as string)).toEqual({
    expectedContractRevision: 2,
    clientRequestId: "start:test",
  });
  expect(JSON.parse(calls[3]?.init?.body as string)).toEqual({ text: "fixture", limit: 20 });
  expect(calls[4]?.path).toBe("/api/explore?cursor=a%2B%2F%3D%26b");
});
test("asset upload failure retains successful refs and retries only the failed attachment", async () => {
  const assets: ReceiptAsset[] = ["first.txt", "second.txt"].map((name, index) => ({
    key: String(index),
    file: new File(["fixture"], name),
    status: "pending",
  }));
  const uploads: string[] = [];
  let fail = true;
  const upload = async (file: File) => {
    uploads.push(file.name);
    if (file.name === "second.txt" && fail) {
      fail = false;
      throw new Error("offline");
    }
    return { assetRef: `asset:${file.name}` };
  };
  const update = (key: string, change: Partial<ReceiptAsset>) => {
    Object.assign(assets.find((asset) => asset.key === key)!, change);
  };
  await expect(uploadReceiptAssets(assets, upload, update)).rejects.toThrow("offline");
  expect(assets[0]).toMatchObject({ status: "uploaded", assetRef: "asset:first.txt" });
  expect(assets[1]?.status).toBe("error");
  expect(await uploadReceiptAssets(assets, upload, update)).toEqual([
    "asset:first.txt",
    "asset:second.txt",
  ]);
  expect(uploads).toEqual(["first.txt", "second.txt", "second.txt"]);
});

test("direct binary comments survive ambiguous retries with the same saved option and idempotency key", async () => {
  const inputs: unknown[] = [];
  let writes = 0;
  const decision = {
    ...decisionFixture,
    options: [
      { ...decisionFixture.options[0]!, id: "yes", label: "Yes" },
      { ...decisionFixture.options[0]!, id: "no", label: "No" },
    ],
  };
  const controller = new DecisionController(
    {
      decision: async () => decision,
      resolve: async (_id, input) => {
        inputs.push(input);
        if (++writes === 1) throw new Error("offline");
        return decisionResolutionFixture;
      },
    },
    decision.id
  );
  await controller.load();
  controller.edit({ customText: "Keep my reasoning exactly." });
  await controller.resolve("no", true);
  await controller.resolve("no", true);
  expect(inputs[0]).toEqual(inputs[1]);
  expect(inputs[0]).toMatchObject({ optionId: "no", customText: "Keep my reasoning exactly." });
  expect(isApprovalDecision(decision)).toBe(true);
  expect(
    isApprovalDecision({
      ...decision,
      options: decision.options.map((option, i) => ({ ...option, label: `Route ${i}` })),
    })
  ).toBe(false);
});
