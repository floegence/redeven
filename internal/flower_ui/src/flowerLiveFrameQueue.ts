import type { FlowerLiveStreamEnvelope, FlowerRuntimeCurrentItem } from './contracts/flowerSurfaceContracts';
import { retainEqualValue } from './presentationIdentity';

/** Only text may differ; every other current and envelope field is compared. */
export function flowerLiveTextAppend(previous: FlowerLiveStreamEnvelope, next: FlowerLiveStreamEnvelope): boolean {
  if (previous.kind !== 'thread.batch' || next.kind !== 'thread.batch') return false;
  if (Boolean(previous.current) === Boolean(previous.subagent_current)
    || Boolean(next.current) === Boolean(next.subagent_current)) return false;
  const field = previous.current ? 'current' : 'subagent_current';
  const before = previous[field];
  const after = next[field];
  if (!before || !after) return false;
  if (!Number.isSafeInteger(before.view_version) || before.view_version <= 0
    || !Number.isSafeInteger(after.view_version) || after.view_version <= before.view_version) return false;
  if (after.activity !== 'active' || !after.turn_id || !after.run_id) return false;
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
    ...next, [field]: { ...after, view_version: before.view_version, items: comparable },
  }) === previous;
}

/** One transient frame in the live connection; ThreadCache remains the owner. */
export function createFlowerLiveFrameQueue(options: Readonly<{
  apply: (envelope: FlowerLiveStreamEnvelope, connectionEpoch: number) => void;
  connectionEpoch?: () => number;
  onError?: (error: unknown, connectionEpoch: number) => void;
  validateAppend: (envelope: FlowerLiveStreamEnvelope) => boolean;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
}>) {
  type Frame = Readonly<{ envelope: FlowerLiveStreamEnvelope; connectionEpoch: number }>;
  let previous: Frame | undefined;
  let pending: Frame | undefined;
  let frame: number | undefined;
  let generation = 0;
  let disposed = false;
  const clear = () => {
    generation++;
    if (frame !== undefined) options.cancelFrame(frame);
    frame = undefined;
    pending = undefined;
    previous = undefined;
  };
  const current = (value: Frame) => !disposed
    && (!options.connectionEpoch || options.connectionEpoch() === value.connectionEpoch);
  const reportError = (error: unknown, connectionEpoch: number) => {
    clear();
    if (options.onError) options.onError(error, connectionEpoch);
    else throw error;
  };
  const apply = (value: Frame) => {
    if (current(value)) options.apply(value.envelope, value.connectionEpoch);
  };
  const flush = () => {
    if (frame !== undefined) options.cancelFrame(frame);
    frame = undefined;
    const value = pending;
    pending = undefined;
    if (value) apply(value);
  };
  return {
    push(envelope: FlowerLiveStreamEnvelope, connectionEpoch = options.connectionEpoch?.() ?? 0) {
      const value = { envelope, connectionEpoch };
      if (!current(value)) return;
      if (previous && previous.connectionEpoch !== connectionEpoch) clear();
      const currentGeneration = generation;
      try {
        if (previous && flowerLiveTextAppend(previous.envelope, envelope) && options.validateAppend(envelope)) {
          pending = value;
          previous = value;
          if (frame === undefined) frame = options.requestFrame(() => {
            if (currentGeneration !== generation || disposed) return;
            try { flush(); } catch (error) { reportError(error, connectionEpoch); }
          });
          return;
        }
        flush();
        if (currentGeneration !== generation || !current(value)) return;
        apply(value);
        if (currentGeneration === generation && current(value)) previous = value;
      } catch (error) {
        reportError(error, connectionEpoch);
      }
    },
    boundary: clear,
    dispose() { disposed = true; clear(); },
  };
}
