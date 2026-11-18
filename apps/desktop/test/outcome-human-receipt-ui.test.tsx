import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act, useState, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import type {
  HumanReceiptInput,
  HumanReceiptView,
  HumanWorkItemDetail,
} from "@outcomego/contracts/human-work";
import { humanFixture, fixtureIds } from "./outcome-client-fixtures";
import { I18nProvider } from "../src/renderer/lib/i18n";
import { ReceiptForm } from "../src/renderer/components/outcomego/outcomes/human-work/receipt-form";
import { HumanAction } from "../src/renderer/components/outcomego/outcomes/human-work/human-action";
import type { HumanMaterialClient } from "../src/renderer/components/outcomego/outcomes/human-work/human-api";
import type { InboxClient } from "../src/renderer/components/outcomego/outcomes/inbox/inbox-api";

const dom = parseHTML("<!doctype html><html><body></body></html>");
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
const textareaDefault = Object.getOwnPropertyDescriptor(
  dom.window.HTMLTextAreaElement.prototype,
  "defaultValue"
);
let createRoot: typeof import("react-dom/client").createRoot;
let root: Root | undefined;
let host: HTMLElement;
beforeAll(async () => {
  for (const key of [
    "window",
    "document",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "Event",
    "CustomEvent",
    "IS_REACT_ACT_ENVIRONMENT",
    "localStorage",
    "navigator",
  ]) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  const storage = new Map<string, string>();
  Object.defineProperty(dom.window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  Object.defineProperty(dom.window, "navigator", { configurable: true, value: { language: "en" } });
  Object.assign(dom.document, { oninput: null });
  // Linkedom does not reflect textarea.defaultValue into its initial text/value.
  Object.defineProperty(dom.window.HTMLTextAreaElement.prototype, "defaultValue", {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      return this.textContent ?? "";
    },
    set(this: HTMLTextAreaElement, value: string) {
      this.textContent = value;
    },
  });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
});
afterAll(() => {
  if (textareaDefault)
    Object.defineProperty(
      dom.window.HTMLTextAreaElement.prototype,
      "defaultValue",
      textareaDefault
    );
  else Reflect.deleteProperty(dom.window.HTMLTextAreaElement.prototype, "defaultValue");
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function active(status: NonNullable<HumanWorkItemDetail["card"]>["status"] = "in_progress") {
  const item = structuredClone(humanFixture);
  item.status = status;
  item.card!.status = status;
  return item;
}
function receipt(input: HumanReceiptInput, sequence = 1): HumanReceiptView {
  return {
    id: `receipt-${sequence}`,
    workItemId: fixtureIds.human,
    outcomeId: fixtureIds.outcome,
    sequence,
    status: "submitted",
    submittedBy: "owner:local",
    submittedAt: "2026-11-17T00:00:00.000Z",
    reviewComment: null,
    payload: input,
    evidenceIds: [],
    missingRequirements: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const materials = (submit: HumanMaterialClient["receipt"]): HumanMaterialClient => ({
  receipt: submit,
  search: async () => [],
  read: async () => {
    throw new Error("not requested");
  },
});
function inbox(overrides: Partial<InboxClient>): InboxClient {
  return {
    list: async () => {
      throw new Error("not requested");
    },
    forOutcome: async () => {
      throw new Error("not requested");
    },
    decision: async () => {
      throw new Error("not requested");
    },
    resolve: async () => {
      throw new Error("not requested");
    },
    humanItems: async () => [],
    humanItem: async () => active(),
    startHuman: async () => active(),
    pauseHuman: async () => active("paused"),
    ...overrides,
  };
}
async function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await render(node);
}
async function render(node: ReactNode) {
  await act(async () => root!.render(<I18nProvider>{node}</I18nProvider>));
}
function form() {
  return host.querySelector('section[aria-label="Execution receipt"] form')!;
}
async function submit() {
  await act(async () => {
    form().dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((node) => node.textContent === text);
  expect(button).toBeDefined();
  await act(async () => {
    button!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
}
async function change(label: string, value: string) {
  const control = [...host.querySelectorAll("label")]
    .find((node) => node.textContent?.startsWith(label))!
    .querySelector("input,textarea,select") as HTMLInputElement;
  // Linkedom omits the browser default for an input without a type attribute.
  if (control.localName === "input" && !control.getAttribute("type")) control.type = "text";
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")!.set!;
  setter.call(control, value);
  await act(async () => {
    control.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    control.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
async function files(...selected: File[]) {
  const control = host.querySelector('input[type="file"]')!;
  Object.defineProperty(control, "files", { configurable: true, value: selected });
  await act(async () => {
    control.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
function Editor({
  client,
  upload = async () => ({ assetRef: `asset:${"a".repeat(64)}` }),
  onSubmitted = () => {},
  onConflict = () => {},
  item = active(),
}: {
  client: HumanMaterialClient;
  upload?: (file: File) => Promise<{ assetRef: string }>;
  onSubmitted?: (value: HumanReceiptView) => void;
  onConflict?: () => void;
  item?: HumanWorkItemDetail;
}) {
  const [summary, setSummary] = useState("Inspection summary");
  return (
    <ReceiptForm
      card={item.card!}
      client={client}
      upload={upload}
      summary={summary}
      onSummary={setSummary}
      onSubmitted={onSubmitted}
      onConflict={onConflict}
    />
  );
}

test("network retry retains actual entered materials and the identical request key", async () => {
  const calls: HumanReceiptInput[] = [];
  await mount(
    <Editor
      client={materials(async (_, input) => {
        calls.push(input);
        if (calls.length === 1) throw new Error("offline");
        return receipt(input);
      })}
    />
  );
  await change("Execution summary", "Actual recorded result");
  await change("Receipt comment", "Camera checked");
  await change("Equipment label", "UNIT-17");
  await change("External records", "https://example.test/record/17");
  await change("Observation", "Label was physically observed");
  await submit();
  expect(host.textContent).toContain("Submission failed");
  await submit();
  expect(calls).toHaveLength(2);
  expect(calls[0]!.text).toBe("Actual recorded result\nEquipment label: UNIT-17");
  expect(calls[0]!.comment).toBe("Camera checked");
  expect(calls[1]).toEqual(calls[0]);
  expect(calls[0]!.sourceRefs).toEqual([
    { type: "external", ref: "https://example.test/record/17" },
  ]);
  expect(calls[0]!.observations).toEqual([
    {
      criterionId: fixtureIds.criterion,
      result: "observed",
      value: "Label was physically observed",
    },
  ]);
});

test("confirmed receipt cannot be submitted again while the parent is still refreshing", async () => {
  const calls: HumanReceiptInput[] = [];
  await mount(
    <Editor
      client={materials(async (_, input) => {
        calls.push(input);
        return receipt(input);
      })}
    />
  );
  await submit();
  await submit();
  expect(calls).toHaveLength(1);
});

test("online reconnect refreshes authoritative status without resending or clearing local materials", async () => {
  let reads = 0;
  let writes = 0;
  let current = active();
  const client = inbox({
    humanItem: async () => {
      reads++;
      return structuredClone(current);
    },
  });
  await mount(
    <HumanAction
      workItemId={fixtureIds.human}
      client={client}
      materials={materials(async (_, input) => {
        writes++;
        return receipt(input);
      })}
      upload={async () => ({ assetRef: "unused" })}
      onReview={() => {}}
    />
  );
  await change("Execution summary", "Unsaved local observation");
  current = active("rejected");
  await act(async () => {
    window.dispatchEvent(new dom.window.Event("online"));
  });
  expect(reads).toBe(2);
  expect(writes).toBe(0);
  expect(host.textContent).toContain("The receipt was rejected");
  expect(
    (host.querySelector('section[aria-label="Execution receipt"] textarea') as HTMLTextAreaElement)
      .value
  ).toBe("Unsaved local observation");
});

test("partial file upload failure preserves successful assets and retries only the failed file", async () => {
  const uploaded: string[] = [];
  const calls: HumanReceiptInput[] = [];
  let failed = false;
  await mount(
    <Editor
      client={materials(async (_, input) => {
        calls.push(input);
        return receipt(input);
      })}
      upload={async (file) => {
        uploaded.push(file.name);
        if (file.name === "second.txt" && !failed) {
          failed = true;
          throw new Error("upload disconnected");
        }
        return { assetRef: `asset:${(file.name === "first.txt" ? "a" : "b").repeat(64)}` };
      }}
    />
  );
  await change("Receipt comment", "Both actual photographs");
  await files(new File(["first"], "first.txt"), new File(["second"], "second.txt"));
  await submit();
  expect(calls).toHaveLength(0);
  expect(host.textContent).toContain(`asset:${"a".repeat(64)}`);
  expect(host.textContent).toContain("second.txt · error");
  await submit();
  expect(uploaded).toEqual(["first.txt", "second.txt", "second.txt"]);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.assetRefs).toEqual([`asset:${"a".repeat(64)}`, `asset:${"b".repeat(64)}`]);
  expect(calls[0]!.comment).toBe("Both actual photographs");
});

test("in-flight upload and receipt disable the form and ignore duplicate submission events", async () => {
  const uploaded = deferred<{ assetRef: string }>();
  const submitted = deferred<HumanReceiptView>();
  const calls: HumanReceiptInput[] = [];
  await mount(
    <Editor
      upload={() => uploaded.promise}
      client={materials(async (_, input) => {
        calls.push(input);
        return submitted.promise;
      })}
    />
  );
  await files(new File(["photo"], "photo.txt"));
  await submit();
  await submit();
  expect(calls).toHaveLength(0);
  expect(host.textContent).toContain("Uploading materials…");
  expect(form().querySelector("fieldset")!.hasAttribute("disabled")).toBe(true);
  await act(async () => {
    uploaded.resolve({ assetRef: `asset:${"a".repeat(64)}` });
  });
  await submit();
  expect(calls).toHaveLength(1);
  expect(host.textContent).toContain("Submitting receipt…");
  await act(async () => {
    submitted.resolve(receipt(calls[0]!));
  });
});

test("409 refetches the newer revision, preserves materials and requires an explicit retry", async () => {
  let current = active();
  let reads = 0;
  let uploads = 0;
  const calls: HumanReceiptInput[] = [];
  const client = inbox({
    humanItem: async () => {
      reads++;
      return structuredClone(current);
    },
  });
  await mount(
    <HumanAction
      workItemId={fixtureIds.human}
      client={client}
      materials={materials(async (_, input) => {
        calls.push(input);
        if (calls.length === 1) {
          current.card!.contractRevision = 2;
          current.contractRevision = 2;
          throw { status: 409, code: "review_revision_conflict" };
        }
        return receipt(input);
      })}
      upload={async () => {
        uploads++;
        return { assetRef: `asset:${"a".repeat(64)}` };
      }}
      onReview={() => {}}
    />
  );
  await change("Execution summary", "Retained across a revision conflict");
  await change("Receipt comment", "Do not erase");
  await files(new File(["photo"], "photo.txt"));
  await submit();
  expect(reads).toBe(2);
  expect(calls).toHaveLength(1);
  expect(host.textContent).toContain("The Contract revision changed");
  expect(host.textContent).toContain("Revision 2");
  await submit();
  expect(calls).toHaveLength(2);
  expect(uploads).toBe(1);
  expect(calls[1]).toMatchObject({
    text: "Retained across a revision conflict",
    comment: "Do not erase",
    expectedContractRevision: 2,
    assetRefs: calls[0]!.assetRefs,
  });
  expect(calls[1]!.clientRequestId).not.toBe(calls[0]!.clientRequestId);
});

test("lost successful response is reconciled by refresh into read-only receipt history without another write", async () => {
  let current = active();
  let writes = 0;
  const client = inbox({ humanItem: async () => structuredClone(current) });
  await mount(
    <HumanAction
      workItemId={fixtureIds.human}
      client={client}
      materials={materials(async (_, input) => {
        writes++;
        current = active("submitted");
        current.receipts = [receipt(input)];
        throw new Error("response lost after commit");
      })}
      upload={async () => ({ assetRef: "unused" })}
      onReview={() => {}}
    />
  );
  await change("Execution summary", "Persisted result despite lost response");
  await submit();
  expect(host.textContent).toContain("Submission failed");
  await click("Refresh from server");
  expect(host.textContent).toContain("Receipt submitted. Acceptance review is still required.");
  expect(host.textContent).toContain("#1 · submitted");
  await submit();
  expect(writes).toBe(1);
  expect(form().querySelector("fieldset")!.hasAttribute("disabled")).toBe(true);
  expect((form().querySelector("textarea") as HTMLTextAreaElement).value).toBe(
    "Persisted result despite lost response"
  );
});

test("rejected feedback refreshes, requires resume and allows corrected receipt with a new key", async () => {
  let current = active();
  let starts = 0;
  const calls: HumanReceiptInput[] = [];
  const client = inbox({
    humanItem: async () => structuredClone(current),
    startHuman: async () => {
      starts++;
      current.status = "in_progress";
      current.card!.status = "in_progress";
      return structuredClone(current);
    },
  });
  await mount(
    <HumanAction
      workItemId={fixtureIds.human}
      client={client}
      materials={materials(async (_, input) => {
        calls.push(input);
        current.status = "submitted";
        current.card!.status = "submitted";
        const value = receipt(input, calls.length);
        current.receipts!.push(value);
        return value;
      })}
      upload={async () => ({ assetRef: "unused" })}
      onReview={() => {}}
    />
  );
  await submit();
  expect(host.textContent).toContain("#1 · submitted");
  current.status = "rejected";
  current.card!.status = "rejected";
  current.receipts![0]!.status = "rejected";
  current.receipts![0]!.reviewComment = "Photograph must include the label";
  await click("Refresh from server");
  expect(host.textContent).toContain("Photograph must include the label");
  await submit();
  expect(calls).toHaveLength(1);
  await click("Resume action");
  await change("Execution summary", "Corrected observation with label");
  await submit();
  expect(starts).toBe(1);
  expect(calls).toHaveLength(2);
  expect(calls[1]!.text).toBe("Corrected observation with label");
  expect(calls[1]!.clientRequestId).not.toBe(calls[0]!.clientRequestId);
  expect(host.textContent).toContain("#2 · submitted");
});

test("pause saves entered progress and a remount restores only the server-saved draft", async () => {
  let current = active();
  const pauses: unknown[] = [];
  const client = inbox({
    humanItem: async () => structuredClone(current),
    pauseHuman: async (_, input) => {
      pauses.push(input);
      current = active("paused");
      current.card!.draft = {
        currentStepId: input.currentStepId,
        draftSummary: input.draftSummary,
        readReferenceIds: input.readReferenceIds,
        reason: input.reason,
      };
      return structuredClone(current);
    },
  });
  const node = () => (
    <HumanAction
      workItemId={fixtureIds.human}
      client={client}
      materials={materials(async (_, input) => receipt(input))}
      upload={async () => ({ assetRef: "unused" })}
      onReview={() => {}}
    />
  );
  await mount(node());
  await change("Execution summary", "Saved from the real editor");
  await change("Pause reason", "Camera battery charging");
  await click("Pause action");
  expect(pauses).toHaveLength(1);
  expect(pauses[0]).toMatchObject({
    draftSummary: "Saved from the real editor",
    reason: "Camera battery charging",
    currentStepId: "step-1",
    readReferenceIds: ["ref-1"],
  });
  await act(async () => root!.unmount());
  root = undefined;
  host.remove();
  await mount(node());
  expect((form().querySelector("textarea") as HTMLTextAreaElement).value).toBe(
    "Saved from the real editor"
  );
  expect(host.textContent).toContain("Camera battery charging");
  expect(form().querySelector("fieldset")!.hasAttribute("disabled")).toBe(true);
});

test("leaving a card during upload does not publish a receipt after that card unmounts", async () => {
  const uploaded = deferred<{ assetRef: string }>();
  let writes = 0;
  await mount(
    <Editor
      upload={() => uploaded.promise}
      client={materials(async (_, input) => {
        writes++;
        return receipt(input);
      })}
    />
  );
  await files(new File(["photo"], "photo.txt"));
  await submit();
  await act(async () => root!.unmount());
  root = undefined;
  await act(async () => {
    uploaded.resolve({ assetRef: `asset:${"a".repeat(64)}` });
  });
  expect(writes).toBe(0);
});

test("late receipt responses after unmount never notify the departed card", async () => {
  const submitted = deferred<HumanReceiptView>();
  let notifications = 0;
  let input!: HumanReceiptInput;
  await mount(
    <Editor
      client={materials(async (_, value) => {
        input = value;
        return submitted.promise;
      })}
      onSubmitted={() => {
        notifications++;
      }}
    />
  );
  await submit();
  await act(async () => root!.unmount());
  root = undefined;
  await act(async () => {
    submitted.resolve(receipt(input));
  });
  expect(notifications).toBe(0);
});

test("out-of-order reconnect reads cannot replace the latest authoritative card", async () => {
  const first = deferred<HumanWorkItemDetail>();
  const second = deferred<HumanWorkItemDetail>();
  let reads = 0;
  const client = inbox({ humanItem: () => (++reads === 1 ? first.promise : second.promise) });
  await mount(
    <HumanAction
      workItemId={fixtureIds.human}
      client={client}
      materials={materials(async (_, input) => receipt(input))}
      upload={async () => ({ assetRef: "unused" })}
      onReview={() => {}}
    />
  );
  await act(async () => {
    window.dispatchEvent(new dom.window.Event("online"));
    second.resolve(active("accepted"));
  });
  expect(host.textContent).toContain("Human action accepted.");
  await act(async () => {
    first.resolve(active("paused"));
  });
  expect(reads).toBe(2);
  expect(host.textContent).toContain("Human action accepted.");
  expect(host.textContent).not.toContain("Resume action");
});

test("reconnect after an ambiguous error retains uploaded assets and the exact retry intent", async () => {
  let reads = 0;
  let uploads = 0;
  const calls: HumanReceiptInput[] = [];
  const client = inbox({
    humanItem: async () => {
      reads++;
      return active();
    },
  });
  await mount(
    <HumanAction
      workItemId={fixtureIds.human}
      client={client}
      materials={materials(async (_, input) => {
        calls.push(input);
        if (calls.length === 1) throw new Error("offline");
        return receipt(input);
      })}
      upload={async () => {
        uploads++;
        return { assetRef: `asset:${"a".repeat(64)}` };
      }}
      onReview={() => {}}
    />
  );
  await change("Execution summary", "Reconnect must retain this intent");
  await change("Receipt comment", "Retained comment");
  await files(new File(["photo"], "photo.txt"));
  await submit();
  await act(async () => {
    window.dispatchEvent(new dom.window.Event("online"));
  });
  expect(reads).toBe(2);
  expect(calls).toHaveLength(1);
  expect(host.textContent).toContain(`asset:${"a".repeat(64)}`);
  await submit();
  expect(uploads).toBe(1);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
});

test("missing evidence and unavailable asset errors keep text editable for an explicit correction", async () => {
  for (const failure of [
    { status: 422, code: "human_evidence_missing", message: "Required materials are missing" },
    { status: 404, code: "receipt_asset_not_found", message: "An uploaded asset is unavailable" },
  ]) {
    const calls: HumanReceiptInput[] = [];
    await mount(
      <Editor
        client={materials(async (_, input) => {
          calls.push(input);
          if (calls.length === 1) throw failure;
          return receipt(input);
        })}
      />
    );
    await change("Receipt comment", "Preserve the actual comment");
    await submit();
    expect(host.textContent).toContain(failure.message);
    expect(form().querySelector("fieldset")!.hasAttribute("disabled")).toBe(false);
    await change("Execution summary", "Corrected evidence summary");
    await submit();
    expect(calls[1]).toMatchObject({
      text: "Corrected evidence summary",
      comment: "Preserve the actual comment",
    });
    expect(calls[1]!.clientRequestId).not.toBe(calls[0]!.clientRequestId);
    await act(async () => root!.unmount());
    root = undefined;
    host.remove();
  }
});

test("409 refresh to a cancelled card keeps materials and blocks another receipt", async () => {
  let current = active();
  let writes = 0;
  const client = inbox({ humanItem: async () => structuredClone(current) });
  await mount(
    <HumanAction
      workItemId={fixtureIds.human}
      client={client}
      materials={materials(async () => {
        writes++;
        current = active("cancelled");
        throw { status: 409, code: "human_work_item_not_active" };
      })}
      upload={async () => ({ assetRef: "unused" })}
      onReview={() => {}}
    />
  );
  await change("Execution summary", "Historical entered result");
  await submit();
  expect(host.textContent).toContain("The action changed");
  expect(host.textContent).toContain("Status: cancelled");
  await submit();
  expect(writes).toBe(1);
  expect((form().querySelector("textarea") as HTMLTextAreaElement).value).toBe(
    "Historical entered result"
  );
  expect(form().querySelector("fieldset")!.hasAttribute("disabled")).toBe(true);
});

for (const resumeFirst of [false, true]) {
  test(`authoritative rejection permits correction when resume is ${resumeFirst ? "before" : "after"} the old successful response`, async () => {
    const delayed = deferred<HumanReceiptView>();
    let current = active();
    const calls: HumanReceiptInput[] = [];
    const client = inbox({
      humanItem: async () => structuredClone(current),
      startHuman: async () => {
        current.status = "in_progress";
        current.card!.status = "in_progress";
        return structuredClone(current);
      },
    });
    await mount(
      <HumanAction
        workItemId={fixtureIds.human}
        client={client}
        materials={materials(async (_, input) => {
          calls.push(input);
          const value = receipt(input, calls.length);
          current.receipts!.push(value);
          current.status = "submitted";
          current.card!.status = "submitted";
          return calls.length === 1 ? delayed.promise : value;
        })}
        upload={async () => ({ assetRef: "unused" })}
        onReview={() => {}}
      />
    );
    await submit();
    current.status = "rejected";
    current.card!.status = "rejected";
    current.receipts![0]!.status = "rejected";
    current.receipts![0]!.reviewComment = "Submit the corrected observation";
    await act(async () => {
      window.dispatchEvent(new dom.window.Event("online"));
    });
    expect(host.textContent).toContain("Submit the corrected observation");
    if (resumeFirst) await click("Resume action");
    await act(async () => {
      delayed.resolve(receipt(calls[0]!));
    });
    if (!resumeFirst) await click("Resume action");
    expect(form().querySelector("fieldset")!.hasAttribute("disabled")).toBe(false);
    await change("Execution summary", "Corrected after authoritative rejection");
    await submit();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.clientRequestId).not.toBe(calls[0]!.clientRequestId);
    expect(host.textContent).toContain("#2 · submitted");
  });
}

test("late old success cannot clear a corrected receipt's in-flight guard or reuse its request key", async () => {
  const first = deferred<HumanReceiptView>();
  const second = deferred<HumanReceiptView>();
  let current = active();
  const calls: HumanReceiptInput[] = [];
  const client = inbox({
    humanItem: async () => structuredClone(current),
    startHuman: async () => {
      current.status = "in_progress";
      current.card!.status = "in_progress";
      return structuredClone(current);
    },
  });
  await mount(
    <HumanAction
      workItemId={fixtureIds.human}
      client={client}
      materials={materials(async (_, input) => {
        calls.push(input);
        current.receipts!.push(receipt(input, calls.length));
        return calls.length === 1 ? first.promise : second.promise;
      })}
      upload={async () => ({ assetRef: "unused" })}
      onReview={() => {}}
    />
  );
  await submit();
  current.status = "rejected";
  current.card!.status = "rejected";
  current.receipts![0]!.status = "rejected";
  await act(async () => {
    window.dispatchEvent(new dom.window.Event("online"));
  });
  await click("Resume action");
  await submit();
  expect(calls).toHaveLength(2);
  expect(calls[1]!.clientRequestId).not.toBe(calls[0]!.clientRequestId);
  await act(async () => {
    first.resolve(receipt(calls[0]!));
  });
  expect(host.textContent).toContain("Submitting receipt…");
  expect(form().querySelector("fieldset")!.hasAttribute("disabled")).toBe(true);
  await submit();
  expect(calls).toHaveLength(2);
  current.status = "submitted";
  current.card!.status = "submitted";
  await act(async () => {
    second.resolve(receipt(calls[1]!, 2));
  });
  expect(host.textContent).toContain("#2 · submitted");
});
