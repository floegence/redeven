import type { DesktopStepProgress } from './desktopLauncherIPC';
import type { DesktopTranslationKey } from './i18n/desktopI18n';

export const REINSTALL_TARGET_PROGRESS_STEPS = [
  'preflight', 'confirmation', 'target_locked', 'sessions_closed',
  'maintenance_helper_uploaded', 'redeven_processes_inventory',
  'redeven_processes_stopping', 'redeven_processes_verified_stopped',
  'target_quarantined', 'gateway_package_preparing', 'gateway_package_installing',
  'runtime_package_preparing', 'runtime_package_installing',
  'gateway_and_runtime_starting', 'fresh_identity_verified',
  'catalog_and_local_ui_verified', 'quarantine_cleaned', 'completed',
] as const;
export type ReinstallTargetProgressPhase = typeof REINSTALL_TARGET_PROGRESS_STEPS[number];
export type ReinstallTargetStepStatus = 'pending' | 'running' | 'succeeded' | 'failed';

// Durable journals never contain the transient preflight or terminal phase.
export const REINSTALL_TARGET_JOURNAL_PHASES = [
  'confirmation', 'target_locked', 'sessions_closed',
  'maintenance_helper_uploaded', 'redeven_processes_inventory',
  'redeven_processes_stopping', 'redeven_processes_verified_stopped',
  'target_quarantined', 'gateway_package_preparing',
  'gateway_package_installing', 'runtime_package_preparing',
  'runtime_package_installing', 'gateway_and_runtime_starting',
  'fresh_identity_verified', 'catalog_and_local_ui_verified',
  'quarantine_cleaned',
] as const;
export type ReinstallTargetJournalPhase = typeof REINSTALL_TARGET_JOURNAL_PHASES[number];

export function reinstallTargetStepProgress(
  phase: ReinstallTargetProgressPhase,
  status: ReinstallTargetStepStatus = 'running',
  detailKey?: DesktopTranslationKey,
): DesktopStepProgress {
  const activeIndex = REINSTALL_TARGET_PROGRESS_STEPS.indexOf(phase);
  return {
    active_step_id: phase,
    steps: REINSTALL_TARGET_PROGRESS_STEPS.map((step, index) => ({
      id: step,
      backend_event: `reinstall.${step}`,
      label: step,
      label_key: `progress.reinstallStep.${step}` as DesktopTranslationKey,
      status: index < activeIndex ? 'succeeded' : index === activeIndex ? status : 'pending',
      ...(index === activeIndex && detailKey ? { detail_key: detailKey } : {}),
    })),
  };
}
