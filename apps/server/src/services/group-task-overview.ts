import type { GroupTaskStatus } from "@outcomego/contracts/group-tasks";
import type { ActivityItem } from "@outcomego/contracts/task-overview";
import type { Prisma } from "@outcomego/db";

export const groupTaskOverviewFields = {
  id: true, channelId: true, channel: { select: { name: true } },
  number: true, title: true, status: true, assigneeBotId: true,
  note: true, createdAt: true, updatedAt: true,
} satisfies Prisma.GroupTaskSelect;

const displayState = {
  open: "waiting",
  in_progress: "in_progress",
  blocked: "blocked",
  done: "completed",
  cancelled: "cancelled",
} as const satisfies Record<GroupTaskStatus, ActivityItem["state"]>;

export function groupTaskOverview(row: Prisma.GroupTaskGetPayload<{ select: typeof groupTaskOverviewFields }>) {
  return {
    id: `group_task:${row.id}`,
    title: `${row.channel.name} · #${row.number} ${row.title}`,
    state: displayState[row.status],
    link: { type: "channel", id: row.channelId } as const,
  };
}
