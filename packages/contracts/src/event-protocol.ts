import type { ProductEvent } from "./index";

export const GROUP_TASK_CHANGED_TOPIC = "channel.group_tasks.changed";

export const parseProductEvent = (value: unknown): ProductEvent => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Product event must be an object");
  }
  const event = value as Record<string, unknown>;
  if (
    typeof event.sequence !== "string" ||
    !/^\d+$/.test(event.sequence) ||
    typeof event.topic !== "string" ||
    (event.entityId !== null && typeof event.entityId !== "string") ||
    typeof event.createdAt !== "string"
  ) {
    throw new Error("Product event fields are invalid");
  }
  return event as unknown as ProductEvent;
};
