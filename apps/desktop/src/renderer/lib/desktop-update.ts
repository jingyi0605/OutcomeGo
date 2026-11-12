export const DESKTOP_UPDATE_RESTART_EVENT = "outcomego:request-update-restart";

export function desktopUpdateProgress(update: OutcomeGoUpdateStatus): number | null {
  return update.progress !== null && Number.isFinite(update.progress)
    ? Math.round(Math.max(0, Math.min(100, update.progress)))
    : null;
}

export function requestDesktopUpdateRestart(update: OutcomeGoUpdateStatus) {
  window.dispatchEvent(new CustomEvent(DESKTOP_UPDATE_RESTART_EVENT, { detail: update }));
}
