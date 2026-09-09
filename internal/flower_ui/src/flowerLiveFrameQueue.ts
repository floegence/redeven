import type { FlowerLiveStreamEnvelope, FlowerRuntimeCurrentItem } from './contracts/flowerSurfaceContracts';
import { retainEqualValue } from './presentationIdentity';

/** Only text may differ; every other current and envelope field is compared. */
export function flowerLiveTextAppend(previous: FlowerLiveStreamEnvelope, next: FlowerLiveStreamEnvelope): boolean {
  const before = previous.current;
  const after = next.current;
  if (previous.kind !== 'thread.batch' || next.kind !== 'thread.batch' || !before || !after) return false;
  if (!Number.isSafeInteger(after.view_version) || after.view_version <= before.view_version) return false;
  if (after.activity !== 'active' || !after.turn_id || !after.run_id) return false;
  if (previous.subagent_current || next.subagent_current) return false;
  const oldItems = before.items;
  const newItems = after.items;
  if (!oldItems || !newItems || oldItems.length !== newItems.length) return false;
  let changed = false;
  const comparable: FlowerRuntimeCurrentItem[] = [];
  for (let index = 0; index < newItems.length; index += 1) {
    const oldItem = oldItems[index]!;
    const newItem = newItems[index]!;
    if (oldItem.text === newItem.text) { comparable.push(newItem); continue; }
    if ((newItem.kind !== 'assistant' && newItem.kind !== 'thinking') || !newItem.live
      || newItem.turn_id !== after.turn_id || newItem.run_id !== after.run_id
      || typeof oldItem.text !== 'string' || typeof newItem.text !== 'string'
      || !newItem.text.startsWith(oldItem.text)) return false;
    changed = true;
    comparable.push({ ...newItem, text: oldItem.text });
  }
  return changed && retainEqualValue(previous, {
    ...next, current: { ...after, view_version: before.view_version, items: comparable },
  }) === previous;
}

/** One transient frame in the live connection; ThreadCache remains the owner. */
export function createFlowerLiveFrameQueue(options: Readonly<{
  apply: (envelope: FlowerLiveStreamEnvelope) => void;
  validateAppend: (envelope: FlowerLiveStreamEnvelope) => boolean;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
}>) {
  let previous: FlowerLiveStreamEnvelope | undefined;
  let pending: FlowerLiveStreamEnvelope | undefined;
  let frame: number | undefined;
  const flush = () => {
    if (frame !== undefined) options.cancelFrame(frame);
    frame = undefined;
    const value = pending;
    pending = undefined;
    if (value) options.apply(value);
  };
  return {
    push(value: FlowerLiveStreamEnvelope) {
      if (previous && flowerLiveTextAppend(previous, value) && options.validateAppend(value)) {
        pending = value;
        previous = value;
        if (frame === undefined) frame = options.requestFrame(flush);
        return;
      }
      flush();
      options.apply(value);
      previous = value;
    },
    boundary() { flush(); previous = undefined; },
    dispose() {
      if (frame !== undefined) options.cancelFrame(frame);
      frame = undefined;
      pending = undefined;
      previous = undefined;
    },
  };
}
