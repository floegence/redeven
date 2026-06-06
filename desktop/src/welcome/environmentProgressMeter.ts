import type { DesktopLauncherActionProgress, DesktopStepProgress } from '../shared/desktopLauncherIPC';

export function environmentProgressMeterPercent(
  progress: DesktopLauncherActionProgress,
): number {
  const stepPercent = percentFromStepProgress(progress.step_progress, progress.status);
  if (stepPercent !== null) {
    return stepPercent;
  }
  return percentFromStageProgress(progress.lifecycle_progress ?? progress.open_progress);
}

function percentFromStageProgress(current: Readonly<{ stage_index: number; stage_count: number }> | undefined): number {
  if (!current || current.stage_count <= 0) {
    return 0;
  }
  return clampPercent(Math.round((current.stage_index / current.stage_count) * 100));
}

function percentFromStepProgress(
  progress: DesktopStepProgress | undefined,
  operationStatus: DesktopLauncherActionProgress['status'],
): number | null {
  const steps = progress?.steps ?? [];
  if (steps.length === 0) {
    return null;
  }
  if (operationStatus === 'succeeded') {
    return 100;
  }

  const completedSteps = steps.filter((step) => step.status === 'succeeded').length;
  const activeStep = steps.find((step) => step.id === progress?.active_step_id);
  const activeContribution = activeStep && (activeStep.status === 'running' || activeStep.status === 'canceled')
    ? 0.35
    : 0;

  return clampPercent(Math.round(((completedSteps + activeContribution) / steps.length) * 100));
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}
