import { ApiError, type DynamicToolCallRequest } from "@outcomego/contracts";
import {
  decodeGroupTaskInput,
  type GroupTaskToolName,
  type GroupTaskView,
} from "@outcomego/contracts/group-tasks";
import type { GroupTaskService, ToolContext } from "@outcomego/messaging";

const FINISH =
  "When it is finished call UpdateGroupTask with status done and a note summarising the result; use status blocked with a note if you are stuck, and assignTo \"none\" if you stop.";

const afterCreate = (task: GroupTaskView, botId: string, created: boolean): string => {
  if (!created) return `Task #${task.number} was already registered by this same request; nothing new was created.`;
  if (task.assignee?.id === botId) return `Registered and claimed as #${task.number}. Start the work now. ${FINISH}`;
  if (task.assignee) return `Registered as #${task.number} and assigned to ${task.assignee.name}, who must claim it. Do not do the work yourself.`;
  return `Registered as #${task.number}, unowned. Claim it with ClaimGroupTask before you start, or assign it to a member.`;
};

const afterUpdate = (task: GroupTaskView): string => {
  switch (task.status) {
    case "done":
      return `Task #${task.number} is done. Tell the group the result in a sentence if it matters to them.`;
    case "cancelled":
      return `Task #${task.number} is cancelled together with its unfinished subtasks. Create a new task if the work resumes.`;
    case "blocked":
      return `Task #${task.number} is blocked. Say what you need in the group, and resume with status in_progress when it arrives.`;
    case "open":
      return task.assignee
        ? `Task #${task.number} was handed to ${task.assignee.name}, who must claim it.`
        : `Task #${task.number} is released and anyone can claim it.`;
    default:
      return `Task #${task.number} is in progress. ${FINISH}`;
  }
};

/**
 * Adapts the four group task tools to the board service (specs/010-群任务看板). The group is always
 * the run's own channel; no argument can name another one.
 */
export class GroupTaskTools {
  constructor(private readonly tasks: GroupTaskService) {}

  execute = async (request: DynamicToolCallRequest, context: ToolContext): Promise<unknown> => {
    const channelId = context.channelId;
    if (!channelId) throw new ApiError(403, "group_task_unavailable", "The task board exists only in group chats");
    const botId = context.botId;
    const caller = { kind: "bot", botId } as const;
    const input = <Name extends GroupTaskToolName>(name: Name) => {
      try {
        return decodeGroupTaskInput(name, request.arguments);
      } catch {
        throw new ApiError(400, "invalid_request", `Invalid ${name} arguments`);
      }
    };
    switch (request.tool) {
      case "ListGroupTasks":
        return this.tasks.list(channelId, caller, input("ListGroupTasks"));
      case "CreateGroupTask": {
        const { task, created } = await this.tasks.create(channelId, botId, input("CreateGroupTask"));
        return { task, created, nextStep: afterCreate(task, botId, created) };
      }
      case "ClaimGroupTask": {
        const { task: number, expectedRevision } = input("ClaimGroupTask");
        const task = await this.tasks.claim(channelId, botId, number, expectedRevision);
        return { task, nextStep: `You own #${task.number}. Do the work. ${FINISH}` };
      }
      case "UpdateGroupTask": {
        const { task: number, ...change } = input("UpdateGroupTask");
        const task = await this.tasks.update(channelId, caller, number, change);
        return { task, nextStep: afterUpdate(task) };
      }
      default:
        throw new ApiError(400, "invalid_request", `Unknown group task tool ${request.tool}`);
    }
  };
}
