import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError } from "@outcomego/contracts";
import {
  INITIAL_SIDEBAR_LAYOUT_VERSION,
  SIDEBAR_LAYOUT_CONFLICT_CODE,
  parseSidebarLayoutConflict,
  type SidebarLayoutVersion,
} from "@outcomego/contracts/client-preferences";
import { AgentDataStore } from "../src/agent-data";

/** A prisma stand-in whose transactions run one at a time, like the advisory lock they replace. */
const serialPrisma = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    $transaction: <T>(action: (tx: unknown) => Promise<T>): Promise<T> => {
      const run = tail.then(() => action({ $executeRaw: async () => 0 }));
      tail = run.catch(() => undefined);
      return run;
    },
    channel: { findMany: async () => [] },
  };
};

const layout = (name: string, base: Partial<SidebarLayoutVersion> | null) => ({
  version: 2,
  pinnedIds: [],
  unreadIds: [],
  unassignedCollapsed: false,
  sections: [{ id: "dev", name, collapsed: false }],
  sectionByChannel: { "channel-a": "dev" },
  channelOrderByGroup: {},
  ...(base ? { baseRevision: base.revision, baseUpdatedAt: base.updatedAt } : {}),
});

const withStore = async (run: (store: AgentDataStore) => Promise<void>) => {
  const temporary = await mkdtemp(join(tmpdir(), "outcomego-sidebar-version-"));
  const store = new AgentDataStore(serialPrisma() as never, {
    root: join(temporary, "agent-data"),
    workspaceRoot: join(temporary, "workspace"),
  });
  try {
    await run(store);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};

const conflictOf = async (write: Promise<unknown>) => {
  const error = await write.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(ApiError);
  const api = error as ApiError;
  expect(api.status).toBe(409);
  expect(api.code).toBe(SIDEBAR_LAYOUT_CONFLICT_CODE);
  const conflict = parseSidebarLayoutConflict(api.details);
  expect(conflict).not.toBeNull();
  return conflict!;
};

test("a server that never stored a layout reports the initial version", async () => {
  await withStore(async (store) => {
    const root = await store.loadRootSettingsForClient();
    expect(root.settings.sidebarMeta).toEqual(INITIAL_SIDEBAR_LAYOUT_VERSION);
  });
});

test("an accepted write advances revision and timestamp, both assigned by the server", async () => {
  await withStore(async (store) => {
    const first = await store.writeSidebarPreferences(
      layout("研发管理", INITIAL_SIDEBAR_LAYOUT_VERSION)
    );
    expect(first.revision).toBe(1);
    expect(Date.parse(first.updatedAt)).toBeGreaterThan(
      Date.parse(INITIAL_SIDEBAR_LAYOUT_VERSION.updatedAt)
    );

    const second = await store.writeSidebarPreferences(layout("研发管理 2", first));
    expect(second.revision).toBe(2);
    expect(Date.parse(second.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));

    const root = await store.loadRootSettingsForClient();
    expect(root.settings.sidebarMeta).toEqual({
      revision: 2,
      updatedAt: second.updatedAt,
    });
    expect(root.settings.sidebarSections?.[0]).toMatchObject({ id: "dev", name: "研发管理 2" });
  });
});

test("a write based on an older version is rejected with the current layout", async () => {
  await withStore(async (store) => {
    const first = await store.writeSidebarPreferences(
      layout("研发管理", INITIAL_SIDEBAR_LAYOUT_VERSION)
    );
    const conflict = await conflictOf(
      store.writeSidebarPreferences(layout("overwrite", INITIAL_SIDEBAR_LAYOUT_VERSION))
    );
    expect(conflict.version).toEqual({ revision: 1, updatedAt: first.updatedAt });
    expect(conflict.preferences.sections).toEqual([{ id: "dev", name: "研发管理", collapsed: false }]);
    expect(conflict.preferences.sectionByChannel).toEqual({ "channel-a": "dev" });
    // The rejected write changed nothing.
    expect((await store.loadRootSettingsForClient()).settings.sidebarMeta?.revision).toBe(1);
  });
});

test("the revision alone is not enough: a mismatched timestamp is rejected too", async () => {
  await withStore(async (store) => {
    const first = await store.writeSidebarPreferences(
      layout("研发管理", INITIAL_SIDEBAR_LAYOUT_VERSION)
    );
    await conflictOf(
      store.writeSidebarPreferences(
        layout("x", { revision: first.revision, updatedAt: "2999-01-01T00:00:00.000Z" })
      )
    );
  });
});

test("a write without a base version is rejected", async () => {
  await withStore(async (store) => {
    const conflict = await conflictOf(store.writeSidebarPreferences(layout("legacy", null)));
    expect(conflict.version).toEqual(INITIAL_SIDEBAR_LAYOUT_VERSION);
    expect(conflict.preferences.sections).toEqual([]);
  });
});

test("of two writes made from the same pulled version exactly one is accepted", async () => {
  await withStore(async (store) => {
    const results = await Promise.allSettled([
      store.writeSidebarPreferences(layout("A", INITIAL_SIDEBAR_LAYOUT_VERSION)),
      store.writeSidebarPreferences(layout("B", INITIAL_SIDEBAR_LAYOUT_VERSION)),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ApiError);
    expect((await store.loadRootSettingsForClient()).settings.sidebarMeta?.revision).toBe(1);
  });
});
