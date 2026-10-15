import type { FlowerRuntimeCurrentView, FlowerToolCallPreview } from './contracts/flowerSurfaceContracts';
import { flowerActivityIdentity } from './flowerActivityIdentity';

export function flowerToolCallPreviewIdentity(call: FlowerToolCallPreview): string {
  return flowerActivityIdentity({ threadID: call.thread_id, turnID: call.turn_id, runID: call.run_id, itemID: call.call_id });
}

/** Previews remain observations; they never become runtime items or invocations. */
export function flowerCurrentToolCallPreviews(view: FlowerRuntimeCurrentView): readonly FlowerToolCallPreview[] {
  const seen = new Set<string>();
  return (view.tool_call_previews ?? []).filter(call => {
    if (!call.call_id?.trim() || !call.name?.trim() || !call.thread_id?.trim() || !call.turn_id?.trim()
      || !call.run_id?.trim() || !call.logical_request_id?.trim() || !call.attempt_id?.trim()
      || !Number.isSafeInteger(call.attempt_epoch) || call.attempt_epoch < 0) {
      throw new Error('Flower contract error: invalid tool argument preview identity.');
    }
    for (const count of [call.preview?.additions, call.preview?.deletions]) {
      if (count !== undefined && (!Number.isSafeInteger(count) || count < 0)) {
        throw new Error('Flower contract error: invalid tool argument preview line count.');
      }
    }
    const request = view.run_progress?.request;
    if (call.thread_id !== view.thread_id || call.turn_id !== view.turn_id || call.run_id !== view.run_id
      || request && (call.logical_request_id !== request.logical_request_id || call.attempt_id !== request.attempt_id || call.attempt_epoch !== request.attempt_epoch)) return false;
    const key = flowerToolCallPreviewIdentity(call);
    if (seen.has(key)) throw new Error('Flower contract error: duplicate tool argument preview.');
    seen.add(key);
    return call.preview != null;
  });
}
