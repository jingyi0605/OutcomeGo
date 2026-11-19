import { expect, test } from "bun:test";
import { OutcomeAttentionTracker, type AttentionSample } from "../src/renderer/lib/outcome-attention";

test("attention excludes background time, buffers planning until creation, and reports positive deltas only", async () => {
  let now = 0; let id = 0;
  const samples: Array<{ outcomeId: string; sample: AttentionSample }> = [];
  const tracker = new OutcomeAttentionTracker("planning", async (outcomeId, sample) => { samples.push({ outcomeId, sample }); }, () => now, () => String(++id));
  now = 10_000; await tracker.flush(); expect(samples).toHaveLength(0);
  tracker.setActive(true); now = 12_500; tracker.setActive(false);
  now = 99_000; await tracker.flush(); expect(samples).toHaveLength(0);
  tracker.attach("new-outcome"); await tracker.flush();
  expect(samples).toEqual([{ outcomeId: "new-outcome", sample: { clientRequestId: "attention:1", surface: "planning", seconds: 2.5 } }]);
  await tracker.flush(); expect(samples).toHaveLength(1);
});
test("attention retries the same delta identity rather than double-counting transport failures", async () => {
  let now = 0; let id = 0; let attempts = 0;
  const samples: AttentionSample[] = [];
  const tracker = new OutcomeAttentionTracker("decision", async (_outcomeId, sample) => { samples.push(sample); if (++attempts === 1) throw new Error("offline"); }, () => now, () => String(++id));
  tracker.attach("o"); tracker.setActive(true); now = 2000; await tracker.flush(); await tracker.flush();
  expect(samples).toHaveLength(2); expect(samples[0]).toEqual(samples[1]);
  expect(samples[0]?.seconds).toBe(2);
});
test("attention caps each sample at 300 seconds and never infers a missing duration", async () => {
  let now = 0;
  const samples: AttentionSample[] = [];
  const tracker = new OutcomeAttentionTracker("review", async (_id, sample) => { samples.push(sample); }, () => now);
  tracker.attach("o"); tracker.setActive(true); now = 650_000; await tracker.flush(); tracker.setActive(false);
  expect(samples.map(sample => sample.seconds)).toEqual([300, 300, 50]);
  expect(new Set(samples.map(sample => sample.clientRequestId)).size).toBe(3);
});
test("changing Outcome identity keeps buffered and failed samples attached to their original Outcome", async () => {
  let now = 0; let fail = true;
  const samples: Array<{ outcomeId: string; seconds: number }> = [];
  const tracker = new OutcomeAttentionTracker("review", async (outcomeId, sample) => {
    samples.push({ outcomeId, seconds: sample.seconds });
    if (fail) { fail = false; throw new Error("offline"); }
  }, () => now);
  tracker.attach("outcome-A"); tracker.setActive(true);
  now = 2000; tracker.attach("outcome-B");
  await tracker.flush();
  now = 5000; await tracker.flush();
  expect(samples).toEqual([{ outcomeId: "outcome-A", seconds: 2 }, { outcomeId: "outcome-A", seconds: 2 }, { outcomeId: "outcome-B", seconds: 3 }]);
});
