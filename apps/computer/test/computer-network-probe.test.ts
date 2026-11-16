import { expect, test } from "bun:test";
import {
  computerProbeKinds,
  parseComputerProbeRequest,
  type ComputerProbeKind,
} from "../src/computer-network-probe";

const route = { epoch: "epoch-1", mode: "server" } as never;

test("the probe child accepts every kind the parent can send", () => {
  for (const kind of computerProbeKinds) {
    const request = parseComputerProbeRequest(JSON.stringify({ kind, route }));
    expect(request.kind).toBe(kind);
  }
});

test("the connectivity families used for route verification are accepted probe kinds", () => {
  // `verify` forwards a family straight to the child. A kind missing here makes the
  // child exit at once, which silently removes the exit route and cuts Internet access.
  const families: ComputerProbeKind[] = ["ipv4", "ipv6"];
  for (const family of families) expect(computerProbeKinds).toContain(family);
});

test("the probe child rejects malformed requests", () => {
  for (const input of [
    JSON.stringify({ kind: "dns", route }),
    JSON.stringify({ kind: "ipv4" }),
    JSON.stringify({ kind: "ipv4", route: {} }),
    JSON.stringify({ route }),
    "not json",
  ])
    expect(() => parseComputerProbeRequest(input)).toThrow();
});
