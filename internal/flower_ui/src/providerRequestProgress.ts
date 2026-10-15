import type { FlowerProviderRequestProgress } from './contracts/flowerSurfaceContracts';

/** Anchor server-sampled elapsed time to the browser's monotonic clock. */
export function mapFlowerProviderRequestProgress(raw: unknown, sampledAt: unknown, previous?: FlowerProviderRequestProgress): FlowerProviderRequestProgress {
  const value = raw as FlowerProviderRequestProgress | null;
  const startedAt = Date.parse(value?.started_at ?? '');
  if (!value || !value.logical_request_id?.trim() || !value.attempt_id?.trim()
    || !Number.isSafeInteger(value.attempt_epoch) || value.attempt_epoch < 0
    || !Number.isFinite(startedAt) || typeof sampledAt !== 'number' || !Number.isFinite(sampledAt)
    || !Number.isSafeInteger(value.estimated_output_tokens) || value.estimated_output_tokens < 0
    || (value.first_output_at !== undefined && !Number.isFinite(Date.parse(value.first_output_at)))
    || (value.last_progress_at !== undefined && !Number.isFinite(Date.parse(value.last_progress_at)))) {
    throw new Error('Flower contract error: invalid provider request progress or server sample.');
  }
  let anchor = performance.now() - Math.max(0, sampledAt - startedAt);
  if (previous?.logical_request_id === value.logical_request_id && previous.attempt_id === value.attempt_id
    && previous.attempt_epoch === value.attempt_epoch && previous.started_at === value.started_at && previous.wait_anchor_monotonic_ms !== undefined) {
    anchor = Math.min(anchor, previous.wait_anchor_monotonic_ms);
  }
  const progressAt = Date.parse(value.last_progress_at ?? value.first_output_at ?? value.started_at);
  let progressAnchor = performance.now() - Math.max(0, sampledAt - progressAt);
  if (previous?.attempt_id === value.attempt_id && previous.logical_request_id === value.logical_request_id
    && previous.attempt_epoch === value.attempt_epoch && previous.last_progress_at === value.last_progress_at
    && previous.first_output_at === value.first_output_at && previous.started_at === value.started_at
    && previous.progress_anchor_monotonic_ms !== undefined) {
    progressAnchor = Math.min(progressAnchor, previous.progress_anchor_monotonic_ms);
  }
  return { ...value, wait_anchor_monotonic_ms: anchor, progress_anchor_monotonic_ms: progressAnchor };
}

export function flowerRequestWaitSeconds(request: FlowerProviderRequestProgress | undefined, now: number): number | null {
  if (!request || request.first_output_at || request.wait_anchor_monotonic_ms === undefined) return null;
  const elapsed = Math.max(0, now - request.wait_anchor_monotonic_ms);
  return elapsed >= 3000 ? Math.floor(elapsed / 1000) : null;
}

/** Presentation only: the runtime owns deadlines, failures and recovery. */
export function flowerRequestStallSeconds(request: FlowerProviderRequestProgress | undefined, now: number): number | null {
  if (!request?.first_output_at || request.progress_anchor_monotonic_ms === undefined) return null;
  const elapsed = Math.max(0, now - request.progress_anchor_monotonic_ms);
  return elapsed >= 15000 ? Math.floor(elapsed / 1000) : null;
}
