/**
 * Fail visible stalled model initialization instead of showing a permanent spinner.
 * Download timeout is an INACTIVITY watchdog: transferred bytes reset it.
 */
export type StartupStage = 'downloading' | 'initializing';
export const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 70_000;
export const INITIALIZATION_TIMEOUT_MS = 30_000;

export function startupTimeoutMs(stage: StartupStage): number {
  return stage === 'downloading' ? DOWNLOAD_INACTIVITY_TIMEOUT_MS : INITIALIZATION_TIMEOUT_MS;
}

export function shouldRetryStartupOnWasm(stage: StartupStage, alreadyUsingWasm: boolean): boolean {
  return stage === 'initializing' && !alreadyUsingWasm;
}
