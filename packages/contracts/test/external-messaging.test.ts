import { expect, test } from "bun:test";
import { Schema } from "effect";
import { ChannelKind } from "../src";

test("ChannelKind keeps the existing kinds and adds the provider-independent external_dm", () => {
  const decode = Schema.decodeUnknownSync(ChannelKind);
  for (const kind of ["bot_dm", "agent_dm", "group", "external_dm"]) expect(decode(kind)).toBe(kind);
  // No provider-specific kinds: the platform lives on the mapping, not the Channel.
  expect(() => decode("wechat_dm")).toThrow();
});
