import type { DesktopLauncherActionProgress, DesktopStepProgress } from '../shared/desktopLauncherIPC';

export function environmentProgressMeterPercent(
  progress: DesktopLauncherActionProgress,
): number {
  if (progress.active_progress_surface === 'reinstall' || progress.active_progress_surface === 'gateway') {
    return percentFromStepProgress(progress.step_progress, progress.status) ?? 0;
  }
  if (progress.active_progress_surface === 'runtime_lifecycle') {
    return percentFromStageProgress(progress.lifecycle_progress);
  }
  if (progress.active_progress_surface === 'open') {
    return percentFromStageProgress(progress.open_progress);
  }
  return 0;
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
  if (activeStep?.tasks && activeStep.tasks.length > 0) {
    const completedTasks = activeStep.tasks.filter((task) => task.status === 'succeeded').length;
    const activeTaskContribution = activeStep.tasks.some((task) => task.status === 'running') ? 0.35 : 0;
    return clampPercent(Math.round(((completedSteps + (completedTasks + activeTaskContribution) / activeStep.tasks.length) / steps.length) * 100));
  }
  const activeContribution = activeStep && (activeStep.status === 'running' || activeStep.status === 'canceled')
    ? 0.35
    : 0;

  return clampPercent(Math.round(((completedSteps + activeContribution) / steps.length) * 100));
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}
