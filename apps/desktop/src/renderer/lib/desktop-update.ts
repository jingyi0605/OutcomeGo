export const DESKTOP_UPDATE_RESTART_EVENT = "aiteamos:request-update-restart";

export function desktopUpdateProgress(update: AiTeamOSUpdateStatus): number | null {
  return update.progress !== null && Number.isFinite(update.progress)
    ? Math.round(Math.max(0, Math.min(100, update.progress)))
    : null;
}

export function requestDesktopUpdateRestart(update: AiTeamOSUpdateStatus) {
  window.dispatchEvent(new CustomEvent(DESKTOP_UPDATE_RESTART_EVENT, { detail: update }));
}
