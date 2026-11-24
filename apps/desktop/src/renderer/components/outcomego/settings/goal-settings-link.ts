import { OUTCOMEGO_DEEP_LINK_EVENT } from "../../../lib/app-deep-links";

/** The deep link that opens the goal-management settings page. */
export const GOAL_SETTINGS_LINK = "outcomego://app/v1/settings?id=goal-management";

/**
 * Opens the goal-management page through the same deep-link event the version-mismatch banner uses, so the settings
 * panel handles it whether it is closed or already open. Nothing here changes a setting.
 */
export function openGoalSettings(target: EventTarget = window): void {
  target.dispatchEvent(new CustomEvent(OUTCOMEGO_DEEP_LINK_EVENT, { detail: { url: GOAL_SETTINGS_LINK } }));
}
