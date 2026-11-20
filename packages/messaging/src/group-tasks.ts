import { ApiError } from "@outcomego/contracts";
import {
  GROUP_TASK_ACTIVE_STATUSES,
  GROUP_TASK_LIMITS,
  GroupTaskRuleError,
  emptyGroupTaskCounts,
  normalizeGroupTaskTitle,
  planGroupTaskClaim,
  planGroupTaskUpdate,
  renderGroupTaskBoard,
  type GroupTaskActor,
  type GroupTaskBoard,
  type GroupTaskChange,
  type GroupTaskCounts,
  type GroupTaskState,
  type GroupTaskUserAction,
  type GroupTaskView,
} from "@outcomego/contracts/group-tasks";
import type { Prisma, PrismaClient } from "@outcomego/db";

/**
 * The shared task board of a group (specs/010-群任务看板). Every write holds the same per-group
 * advisory lock the group administration uses, so a claim, a number allocation and a membership
 * change can never interleave: ownership is exclusive and every assignee is a current member.
 */

const ACTIVE = [...GROUP_TASK_ACTIVE_STATUSES];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL_NOTE = "Cancelled together with its parent task";

const include = {
  creator: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  parent: { select: { number: true } },
} satisfies Prisma.GroupTaskInclude;
type Row = Prisma.GroupTaskGetPayload<{ include: typeof include }>;
type Db = PrismaClient | Prisma.TransactionClient;

const toView = (row: Row): GroupTaskView => ({
  id: row.id,
  channelId: row.channelId,
  number: row.number,
  parentNumber: row.parent?.number ?? null,
  title: row.title,
  description: row.description,
  status: row.status,
  note: row.note,
  revision: row.revision,
  creator: row.creator,
  assignee: row.assignee,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  completedAt: row.completedAt?.toISOString() ?? null,
});

const stateOf = (row: Row): GroupTaskState => ({
  status: row.status,
  title: row.title,
  description: row.description,
  note: row.note,
  creatorBotId: row.creatorBotId,
  assigneeBotId: row.assigneeBotId,
});

/** A rule refusal becomes an ApiError that carries the task, so a bot can act without re-reading. */
function refuse(error: GroupTaskRuleError, row?: Row): ApiError {
  const message =
    error.code === "group_task_claimed" && row?.assignee
      ? `Task #${row.number} is already owned by ${row.assignee.name}. Do not redo it: pick another task or build on its result`
      : error.message;
  return new ApiError(error.status, error.code, message, row ? { task: toView(row) } : undefined);
}
function applyRule<T>(row: Row, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof GroupTaskRuleError) throw refuse(error, row);
    throw error;
  }
}

interface Member {
  id: string;
  name: string;
  active: boolean;
}

const lockChannel = (tx: Prisma.TransactionClient, channelId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`channel:${channelId}`}))`;

/** The group's members. Null when the channel is not an active group. */
async function groupMembers(db: Db, channelId: string): Promise<{ name: string; members: Member[] } | null> {
  const channel = await db.channel.findFirst({
    where: { id: channelId, kind: "group", archivedAt: null },
    select: {
      name: true,
      members: {
        orderBy: { ordinal: "asc" },
        select: { bot: { select: { id: true, name: true, status: true } } },
      },
    },
  });
  if (!channel) return null;
  return {
    name: channel.name,
    members: channel.members.map(({ bot }) => ({ id: bot.id, name: bot.name, active: bot.status === "active" })),
  };
}

type Caller = GroupTaskActor;

/** A Bot may use only the board of a group it actively belongs to; the user may use any group's. */
function assertCaller(group: { members: readonly Member[] } | null, caller: Caller): asserts group is NonNullable<typeof group> {
  if (!group) {
    throw caller.kind === "bot"
      ? new ApiError(403, "group_task_unavailable", "The task board exists only in group chats")
      : new ApiError(404, "channel_not_found", "Channel not found");
  }
  if (caller.kind === "bot" && !group.members.some((member) => member.id === caller.botId && member.active))
    throw new ApiError(403, "group_task_unavailable", "Only members of this group can use its task board");
}

/** Loads the group inside a write transaction and checks the caller may use its board. */
async function openGroup(tx: Prisma.TransactionClient, channelId: string, caller: Caller) {
  await lockChannel(tx, channelId);
  const group = await groupMembers(tx, channelId);
  assertCaller(group, caller);
  return group;
}

/** `me`, `none`, a member id or an exact member name → a member's Bot id, or null for "none". */
function resolveAssignee(members: readonly Member[], caller: Caller, reference: string): string | null {
  const text = reference.trim();
  const lower = text.toLocaleLowerCase("en-US");
  if (lower === "none") return null;
  if (lower === "me") {
    if (caller.kind !== "bot") throw new ApiError(400, "invalid_request", 'assignTo "me" needs a Bot caller');
    return caller.botId;
  }
  const active = members.filter((member) => member.active);
  const byId = UUID.test(text) ? active.find((member) => member.id.toLowerCase() === lower) : undefined;
  if (byId) return byId.id;
  const byName = active.filter((member) => member.name.trim().toLocaleLowerCase("en-US") === lower);
  const [only] = byName;
  if (only && byName.length === 1) return only.id;
  const roster = active.map((member) => `${member.name} (${member.id})`).join(", ");
  throw new ApiError(
    409,
    "group_task_assignee_invalid",
    byName.length > 1
      ? `More than one member is named ${JSON.stringify(text)}; use an id. Members: ${roster}`
      : `${JSON.stringify(text)} is not a member of this group. Members: ${roster}`
  );
}

const cleanTitle = (title: string): string => {
  const text = title.replace(/\s+/g, " ").trim();
  if (!text) throw new ApiError(400, "invalid_request", "A task needs a title");
  if (text.length > GROUP_TASK_LIMITS.title)
    throw new ApiError(400, "invalid_request", `A title is at most ${GROUP_TASK_LIMITS.title} characters`);
  return text;
};

const findTask = async (db: Db, channelId: string, number: number): Promise<Row> => {
  const row = await db.groupTask.findUnique({
    where: { channelId_number: { channelId, number } },
    include,
  });
  if (!row) throw new ApiError(404, "group_task_not_found", `Task #${number} is not on this board`);
  return row;
};

const staleRevision = (row: Row, expected: number | undefined) => {
  if (expected !== undefined && expected !== row.revision)
    throw new ApiError(
      409,
      "group_task_revision_conflict",
      `Task #${row.number} changed (revision ${row.revision}, you read ${expected}). Read it again before deciding`,
      { task: toView(row) }
    );
};

async function duplicateOf(
  db: Db,
  input: { channelId: string; parentId: string | null; titleKey: string; excludeId?: string }
): Promise<Row | null> {
  return db.groupTask.findFirst({
    where: {
      channelId: input.channelId,
      parentId: input.parentId,
      titleKey: input.titleKey,
      status: { in: ACTIVE },
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
    include,
  });
}

const duplicateError = (existing: Row) =>
  new ApiError(
    409,
    "group_task_duplicate",
    `An unfinished task with this title already exists: #${existing.number} (${existing.status}, ${
      existing.assignee ? `owned by ${existing.assignee.name}` : "unowned"
    }). Claim it if it is unowned, otherwise leave it to its owner instead of creating a copy`,
    { existing: toView(existing) }
  );

async function countByStatus(db: Db, channelId: string): Promise<GroupTaskCounts> {
  const counts = emptyGroupTaskCounts();
  const groups = await db.groupTask.groupBy({ by: ["status"], where: { channelId }, _count: { _all: true } });
  for (const group of groups) counts[group.status] = group._count._all;
  return counts;
}

export interface CreateGroupTaskInput {
  title: string;
  description?: string;
  parent?: number;
  assignTo?: string;
  clientRequestId?: string;
}
export interface UpdateGroupTaskInput {
  expectedRevision?: number;
  status?: Exclude<GroupTaskView["status"], "open">;
  title?: string;
  description?: string;
  note?: string;
  assignTo?: string;
}
export interface ListGroupTasksInput {
  includeClosed?: boolean;
  assignee?: string;
  parent?: number;
}

export class GroupTaskService {
  constructor(private readonly prisma: PrismaClient) {}

  /** The live board. A Bot caller must be a member; the user (no botId) may read any active group. */
  list = async (channelId: string, caller: Caller, input: ListGroupTasksInput = {}): Promise<GroupTaskBoard> => {
    const group = await groupMembers(this.prisma, channelId);
    assertCaller(group, caller);
    let assigneeFilter: Prisma.GroupTaskWhereInput = {};
    if (input.assignee !== undefined) {
      const assignee = resolveAssignee(group.members, caller, input.assignee);
      assigneeFilter = { assigneeBotId: assignee };
    }
    let parentFilter: Prisma.GroupTaskWhereInput = {};
    if (input.parent !== undefined) {
      const parent = await findTask(this.prisma, channelId, input.parent);
      parentFilter = { parentId: parent.id };
    }
    const [rows, counts] = await Promise.all([
      this.prisma.groupTask.findMany({
        where: {
          channelId,
          ...(input.includeClosed ? {} : { status: { in: ACTIVE } }),
          ...assigneeFilter,
          ...parentFilter,
        },
        include,
        orderBy: { number: "asc" },
        take: 500,
      }),
      countByStatus(this.prisma, channelId),
    ]);
    return { tasks: rows.map(toView), counts };
  };

  create = (channelId: string, botId: string, input: CreateGroupTaskInput) =>
    this.prisma.$transaction(async (tx) => {
      const caller: Caller = { kind: "bot", botId };
      const group = await openGroup(tx, channelId, caller);
      if (input.clientRequestId) {
        const prior = await tx.groupTask.findUnique({
          where: { channelId_clientRequestId: { channelId, clientRequestId: input.clientRequestId } },
          include,
        });
        if (prior) return { task: toView(prior), created: false };
      }
      const title = cleanTitle(input.title);
      const description = (input.description ?? "").trim();
      if (description.length > GROUP_TASK_LIMITS.description)
        throw new ApiError(400, "invalid_request", `A description is at most ${GROUP_TASK_LIMITS.description} characters`);

      let parent: Row | null = null;
      if (input.parent !== undefined) {
        parent = await findTask(tx, channelId, input.parent);
        if (parent.parentId !== null)
          throw new ApiError(409, "group_task_depth", `Task #${parent.number} is already a subtask; subtasks cannot have subtasks`);
        if (parent.status === "done" || parent.status === "cancelled")
          throw new ApiError(409, "group_task_closed", `Task #${parent.number} is already ${parent.status}; create a new top-level task instead`);
        const siblings = await tx.groupTask.count({ where: { parentId: parent.id } });
        if (siblings >= GROUP_TASK_LIMITS.subtasksPerParent)
          throw new ApiError(409, "group_task_limit", `A task has at most ${GROUP_TASK_LIMITS.subtasksPerParent} subtasks`);
      }
      const active = await tx.groupTask.count({ where: { channelId, status: { in: ACTIVE } } });
      if (active >= GROUP_TASK_LIMITS.activePerGroup)
        throw new ApiError(409, "group_task_limit", `The board has ${GROUP_TASK_LIMITS.activePerGroup} unfinished tasks; finish or cancel some first`);

      const titleKey = normalizeGroupTaskTitle(title);
      const duplicate = await duplicateOf(tx, { channelId, parentId: parent?.id ?? null, titleKey });
      if (duplicate) throw duplicateError(duplicate);

      const assignee = input.assignTo === undefined ? null : resolveAssignee(group.members, caller, input.assignTo);
      const last = await tx.groupTask.aggregate({ where: { channelId }, _max: { number: true } });
      const created = await tx.groupTask.create({
        data: {
          channelId,
          number: (last._max.number ?? 0) + 1,
          parentId: parent?.id ?? null,
          title,
          titleKey,
          description,
          status: assignee === botId ? "in_progress" : "open",
          creatorBotId: botId,
          assigneeBotId: assignee,
          clientRequestId: input.clientRequestId ?? null,
        },
        include,
      });
      return { task: toView(created), created: true };
    });

  claim = (channelId: string, botId: string, number: number, expectedRevision?: number) =>
    this.prisma.$transaction(async (tx) => {
      await openGroup(tx, channelId, { kind: "bot", botId });
      const row = await findTask(tx, channelId, number);
      staleRevision(row, expectedRevision);
      const plan = applyRule(row, () => planGroupTaskClaim(stateOf(row), botId));
      if (plan.unchanged) return toView(row);
      const updated = await tx.groupTask.update({
        where: { id: row.id },
        data: {
          status: plan.status,
          assigneeBotId: plan.assigneeBotId,
          note: null,
          revision: { increment: 1 },
        },
        include,
      });
      return toView(updated);
    });

  update = (channelId: string, caller: Caller, number: number, input: UpdateGroupTaskInput) =>
    this.prisma.$transaction(async (tx) => {
      const group = await openGroup(tx, channelId, caller);
      const row = await findTask(tx, channelId, number);
      staleRevision(row, input.expectedRevision);

      const title = input.title === undefined ? undefined : cleanTitle(input.title);
      const description = input.description?.trim();
      if (description !== undefined && description.length > GROUP_TASK_LIMITS.description)
        throw new ApiError(400, "invalid_request", `A description is at most ${GROUP_TASK_LIMITS.description} characters`);
      if (input.note !== undefined && input.note.length > GROUP_TASK_LIMITS.note)
        throw new ApiError(400, "invalid_request", `A note is at most ${GROUP_TASK_LIMITS.note} characters`);
      const assignee = input.assignTo === undefined ? undefined : resolveAssignee(group.members, caller, input.assignTo);

      const change: GroupTaskChange = {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(assignee !== undefined ? { assigneeBotId: assignee } : {}),
      };
      const openSubtasks =
        input.status === "done"
          ? await tx.groupTask.count({ where: { parentId: row.id, status: { in: ACTIVE } } })
          : 0;
      const plan = applyRule(row, () => planGroupTaskUpdate(stateOf(row), caller, change, openSubtasks));

      const titleKey = normalizeGroupTaskTitle(plan.title);
      if (plan.title !== row.title) {
        const duplicate = await duplicateOf(tx, { channelId, parentId: row.parentId, titleKey, excludeId: row.id });
        if (duplicate) throw duplicateError(duplicate);
      }
      const now = new Date();
      const updated = await tx.groupTask.update({
        where: { id: row.id },
        data: {
          status: plan.status,
          title: plan.title,
          titleKey,
          description: plan.description,
          note: plan.note,
          assigneeBotId: plan.assigneeBotId,
          completedAt: plan.closes ? now : null,
          revision: { increment: 1 },
        },
        include,
      });
      if (plan.cascadeCancel) {
        await tx.groupTask.updateMany({
          where: { parentId: row.id, status: { in: ACTIVE } },
          data: { status: "cancelled", note: TERMINAL_NOTE, completedAt: now, revision: { increment: 1 } },
        });
      }
      return toView(updated);
    });

  /** The user's own controls from the desktop page: not limited to the creator or owner. */
  userAct = (channelId: string, number: number, input: GroupTaskUserAction) =>
    this.update(channelId, { kind: "user" }, number, {
      expectedRevision: input.expectedRevision,
      ...(input.action === "release"
        ? { assignTo: "none" }
        : { status: "cancelled" as const, note: input.note?.trim() || "Cancelled by the user" }),
    });

  /**
   * The board as the bot's per-turn context, or null when the channel is not a group the bot
   * belongs to (a direct chat has no board and gets no tools).
   */
  snapshotFor = async (botId: string, channelId: string): Promise<string | null> => {
    const channel = await this.prisma.channel.findFirst({
      where: {
        id: channelId,
        kind: "group",
        archivedAt: null,
        members: { some: { botId, bot: { status: "active" } } },
      },
      select: { name: true },
    });
    if (!channel) return null;
    const [rows, counts] = await Promise.all([
      this.prisma.groupTask.findMany({
        where: { channelId, status: { in: ACTIVE } },
        include,
        orderBy: { number: "asc" },
        take: GROUP_TASK_LIMITS.activePerGroup + 20,
      }),
      countByStatus(this.prisma, channelId),
    ]);
    return renderGroupTaskBoard({ groupName: channel.name, viewerBotId: botId, tasks: rows.map(toView), counts });
  };
}

/**
 * A Bot that leaves a group (or is archived) cannot finish what it owns. Releasing in the caller's
 * transaction keeps "every owner is a current member" true at all times. With no channel, releases
 * the Bot's tasks in every group.
 */
export async function releaseGroupTasksForBots(
  tx: Prisma.TransactionClient,
  botIds: readonly string[],
  channelId?: string
): Promise<number> {
  if (botIds.length === 0) return 0;
  const released = await tx.groupTask.updateMany({
    where: {
      assigneeBotId: { in: [...botIds] },
      status: { in: ACTIVE },
      ...(channelId ? { channelId } : {}),
    },
    data: { assigneeBotId: null, status: "open", note: null, revision: { increment: 1 } },
  });
  return released.count;
}
