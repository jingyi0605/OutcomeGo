import { describe, expect, test } from "bun:test";
import { channelViews } from "../../src/services/snapshot/views";

const base = {
  name: "Chat",
  description: "",
  avatarPath: null,
  workingDirectory: null,
  hiddenFromSidebar: false,
  members: [{ botId: "bot-1", ordinal: 0 }],
  createdAt: new Date("2026-11-16T00:00:00Z"),
  updatedAt: new Date("2026-11-16T00:00:00Z"),
};

describe("channel views for external chats", () => {
  test("an external_dm carries the platform of its mapping", () => {
    const [view] = channelViews(
      [{ ...base, id: "c1", kind: "external_dm", directKey: "external:m1", externalMapping: { platform: "wechat" } }],
      new Map()
    );
    expect(view?.kind).toBe("external_dm");
    expect(view?.externalPlatform).toBe("wechat");
  });

  test("other channels have no externalPlatform field at all", () => {
    const views = channelViews(
      [
        { ...base, id: "c2", kind: "bot_dm", directKey: "bot:bot-1" },
        { ...base, id: "c3", kind: "group", directKey: null, externalMapping: null },
      ],
      new Map()
    );
    for (const view of views) expect("externalPlatform" in view).toBe(false);
  });

  test("an external_dm is shown in the sidebar like other visible chats", () => {
    const [view] = channelViews(
      [{ ...base, id: "c1", kind: "external_dm", directKey: "external:m1", externalMapping: { platform: "wechat" } }],
      new Map()
    );
    expect(view?.hiddenFromSidebar).toBe(false);
  });
});
