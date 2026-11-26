import type { TaskPolicyKey } from "@outcomego/contracts/task-policy";
import { translateCurrent } from "../../../lib/i18n-catalog";

/**
 * The words for each policy row. The metadata in the contracts package knows keys, units and ranges but nothing about
 * the interface language, so the sentences live here. A function and not a table, so the language is read when the
 * page renders and follows a language change. The `switch` is exhaustive: adding a policy key without its words fails
 * the type check instead of showing a bare identifier to the owner. Each sentence says what the setting does and states
 * no figure; the figures (unit, range, initial value) are drawn from the metadata next to it.
 */
export function policyCopy(key: TaskPolicyKey): { title: string; description: string } {
  switch (key) {
    case "schedule.graceMinutes":
      return {
        title: translateCurrent("Grace time for a missed start"),
        description: translateCurrent("How late a scheduled task may start before an action that acts outside OutcomeGo waits for your decision instead of running."),
      };
    case "schedule.deferMaxCount":
      return {
        title: translateCurrent("Most times a task can be deferred"),
        description: translateCurrent("How many times a running task may put itself off to continue later."),
      };
    case "schedule.deferMaxDays":
      return {
        title: translateCurrent("Furthest a task can be deferred"),
        description: translateCurrent("How far ahead a running task may schedule its own continuation."),
      };
    case "activity.recentCompletedHours":
      return {
        title: translateCurrent("Keep finished work visible for"),
        description: translateCurrent("How long finished work stays in the recently completed list before it is only in history."),
      };
    case "activity.checkOverdueMinutes":
      return {
        title: translateCurrent("Late check tolerance"),
        description: translateCurrent("How long a saved check may be overdue before it is shown as not having fired."),
      };
    case "activity.cardMaxItems":
      return {
        title: translateCurrent("Most items shown as cards"),
        description: translateCurrent("Up to this many items are shown as cards; more are shown as a table."),
      };
    case "todo.suggestionTtlDays":
      return {
        title: translateCurrent("Expire unanswered suggestions after"),
        description: translateCurrent("A suggestion you have not answered is dismissed after this long."),
      };
    case "todo.restoreRetentionDays":
      return {
        title: translateCurrent("Keep finished to-dos restorable for"),
        description: translateCurrent("How long a completed or dismissed to-do can still be restored."),
      };
    case "todo.maxPendingSuggestionsPerBot":
      return {
        title: translateCurrent("Most open suggestions per bot"),
        description: translateCurrent("A bot that already has this many open suggestions cannot add more. Empty means no limit."),
      };
    case "todo.ownerRef.maxAgeHours":
      return {
        title: translateCurrent("How long a message can authorise a to-do"),
        description: translateCurrent("A to-do can be created directly from your message only while that message is this recent."),
      };
    case "todo.ownerRef.maxTodosPerMessage":
      return {
        title: translateCurrent("Most to-dos from one message"),
        description: translateCurrent("How many to-dos a single message of yours can authorise. Empty means no limit."),
      };
    case "todo.autoAccept.maxPerRulePerDay":
      return {
        title: translateCurrent("Most auto-accepts per rule per day"),
        description: translateCurrent("Once a rule has accepted this many suggestions in a day, its further suggestions wait for you. Empty means no limit."),
      };
    case "todo.highUrgencyNotify":
      return {
        title: translateCurrent("Notify for urgent suggestions"),
        description: translateCurrent("Interrupt you once when a bot marks a new item as urgent. Off by default."),
      };
    case "todo.digest.enabled":
      return {
        title: translateCurrent("Send a morning summary"),
        description: translateCurrent("A short daily notice of what is due, overdue, waiting for you or needs a follow-up."),
      };
    case "todo.digest.localTime":
      return {
        title: translateCurrent("Morning summary time"),
        description: translateCurrent("The time of day, in your time zone, the summary is sent."),
      };
    case "todo.digest.maxTitles":
      return {
        title: translateCurrent("Titles in the summary"),
        description: translateCurrent("The most item titles the summary lists."),
      };
    case "inspection.enabled":
      return {
        title: translateCurrent("Enable active inspection"),
        description: translateCurrent("Allow automatic analysis of goals and tasks that are approaching their deadlines."),
      };
    case "inspection.leadHours":
      return {
        title: translateCurrent("Start inspection before the deadline"),
        description: translateCurrent("Automatic analysis becomes eligible this many hours before a goal or task is due."),
      };
  }
}

/** The label of one choice of an option field. */
export function policyOptionLabel(_key: TaskPolicyKey, option: string): string {
  return option;
}
