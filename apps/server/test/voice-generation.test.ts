import { describe, expect, test } from "bun:test";
import { decodeVoiceFrame } from "@outcomego/contracts";
import { VoiceSessionConnection } from "../src/services/voice-session";

const connection = () =>
  new VoiceSessionConnection({
    sessionId: "session",
    onHello: async () => undefined,
    onControl: async () => undefined,
    onInputFrame: async () => undefined,
    onClose: async () => undefined,
  });

/**
 * Clients drop every output frame whose generation is <= the generation reported by
 * barge_in / audio.stopped. So the reported value must be the generation that was
 * stopped, and audio produced afterwards must carry a strictly greater one.
 */
describe("output generation after a stop", () => {
  test("audio after a barge-in is not at or below the stopped generation", () => {
    const call = connection();
    const stopped = call.stopOutputGeneration();
    const frame = decodeVoiceFrame(call.media.push(new Uint8Array([1]), 0), "output");
    expect(frame.generation).toBeGreaterThan(stopped);
  });

  test("every later reply stays audible after repeated barge-ins", () => {
    const call = connection();
    for (let index = 0; index < 4; index += 1) {
      const stopped = call.stopOutputGeneration();
      const frame = decodeVoiceFrame(call.media.push(new Uint8Array([index]), 0), "output");
      expect(frame.generation).toBeGreaterThan(stopped);
    }
  });

  test("frames queued before the stop are at or below the reported generation", () => {
    const call = connection();
    const before = decodeVoiceFrame(call.media.push(new Uint8Array([1]), 0), "output");
    const stopped = call.stopOutputGeneration();
    expect(before.generation).toBeLessThanOrEqual(stopped);
  });
});

describe("waiting for earlier speech to be heard", () => {
  test("resolves once the client has played up to the position", async () => {
    const call = connection();
    const generation = call.media.currentGeneration;
    const waiting = call.waitForPlayback(generation, 40, 5_000);
    call.media.push(new Uint8Array([1]), 0);
    call.media.push(new Uint8Array([2]), 20);
    call.acknowledgePlayback(generation, 1);
    expect(await waiting).toBe(true);
  });

  test("resolves false when the user cuts in first", async () => {
    const call = connection();
    const generation = call.media.currentGeneration;
    const waiting = call.waitForPlayback(generation, 10_000, 5_000);
    call.stopOutputGeneration();
    expect(await waiting).toBe(false);
  });

  test("does not hold text back forever when the client never acknowledges", async () => {
    const call = connection();
    const started = Date.now();
    expect(await call.waitForPlayback(call.media.currentGeneration, 10_000, 60)).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("counts queued frames so a later message can wait for them", () => {
    const call = connection();
    expect(call.media.queuedFrames).toBe(0);
    call.media.push(new Uint8Array([1]), 0);
    call.media.push(new Uint8Array([2]), 20);
    expect(call.media.queuedFrames).toBe(2);
    call.stopOutputGeneration();
    expect(call.media.queuedFrames).toBe(0);
  });
});
