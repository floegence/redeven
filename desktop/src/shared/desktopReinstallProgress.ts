import type { DesktopComponentTaskProgress, DesktopStepProgress } from './desktopLauncherIPC';
import type { DesktopTranslationKey } from './i18n/desktopI18n';

export const REINSTALL_TARGET_PROGRESS_STEPS = [
  'confirmation', 'direct_channel_open', 'target_resolved',
  'package_batch_prepared_and_verified', 'redeven_process_stop_attempted',
  'old_root_isolated_or_cleared', 'runtime_installed',
  'runtime_started', 'runtime_verified', 'catalog_and_local_ui_verified',
  'old_data_cleaned', 'completed',
] as const;
export type ReinstallTargetProgressPhase = typeof REINSTALL_TARGET_PROGRESS_STEPS[number];
export type ReinstallTargetStepStatus = 'pending' | 'running' | 'succeeded' | 'failed';

// Durable journals never contain the transient preflight or terminal phase.
export const REINSTALL_TARGET_JOURNAL_PHASES = [
  'confirmation', 'direct_channel_open', 'target_resolved',
  'package_batch_prepared_and_verified', 'redeven_process_stop_attempted',
  'old_root_isolated_or_cleared', 'runtime_installed',
  'runtime_started', 'runtime_verified', 'catalog_and_local_ui_verified',
  'old_data_cleaned',
] as const;
export type ReinstallTargetJournalPhase = typeof REINSTALL_TARGET_JOURNAL_PHASES[number];

export function reinstallTargetStepProgress(
  phase: ReinstallTargetProgressPhase,
  status: ReinstallTargetStepStatus = 'running',
  detailKey?: DesktopTranslationKey,
  tasks?: readonly DesktopComponentTaskProgress[],
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
      ...(index === activeIndex && tasks ? { tasks } : {}),
    })),
  };
}
