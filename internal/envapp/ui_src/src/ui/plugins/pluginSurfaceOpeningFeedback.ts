import type { PluginSurfaceOpeningMilestone, PluginSurfaceOpeningProgress, PluginSurfaceOpeningStage } from '@floegence/redevplugin-ui';

// Product copy and a bounded display projection of SDK progress. These values
// are diagnostic only and never participate in surface authority or retries.
export const surfaceOpeningStageKeys = {
  preparing: 'uiCopy.plugin.openingStages.preparing',
  connecting: 'uiCopy.plugin.openingStages.connecting',
  authorizing: 'uiCopy.plugin.openingStages.authorizing',
  initializing: 'uiCopy.plugin.openingStages.initializing',
  committing: 'uiCopy.plugin.openingStages.committing',
} as const satisfies Record<PluginSurfaceOpeningStage, string>;

const milestones: ReadonlySet<string> = new Set<PluginSurfaceOpeningMilestone>(['frame_load', 'prepare', 'port_ack', 'token', 'renderer_ready', 'worker_ready', 'first_commit']);

export type SurfaceOpeningFeedback = Readonly<Pick<PluginSurfaceOpeningProgress, 'stage' | 'elapsedMs' | 'stageElapsedMs'>> & Readonly<{
  pendingMilestones: readonly PluginSurfaceOpeningMilestone[];
}>;

export function surfaceOpeningFeedback(value: unknown): SurfaceOpeningFeedback | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const progress = value as Record<string, unknown>;
  const { stage, elapsedMs, stageElapsedMs, pendingMilestones } = progress;
  if (progress.phase !== 'opening' || typeof stage !== 'string' || !Object.hasOwn(surfaceOpeningStageKeys, stage)
    || typeof elapsedMs !== 'number' || !Number.isSafeInteger(elapsedMs) || elapsedMs < 0
    || typeof stageElapsedMs !== 'number' || !Number.isSafeInteger(stageElapsedMs) || stageElapsedMs < 0 || stageElapsedMs > elapsedMs
    || !Array.isArray(pendingMilestones) || pendingMilestones.length > 2
    || !pendingMilestones.every((item): item is PluginSurfaceOpeningMilestone => typeof item === 'string' && milestones.has(item))) return undefined;
  return { stage: stage as SurfaceOpeningFeedback['stage'], elapsedMs, stageElapsedMs, pendingMilestones: [...pendingMilestones] };
}

export function surfaceFailureDiagnostic(errorCode: string, opening?: SurfaceOpeningFeedback): string {
  return JSON.stringify({
    ...(/^PLUGIN_[A-Z0-9_]{1,80}$/u.test(errorCode) ? { error_code: errorCode } : {}),
    ...(opening ? { opening } : {}),
  }, null, 2);
}
