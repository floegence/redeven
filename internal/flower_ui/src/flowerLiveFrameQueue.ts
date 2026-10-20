import { FlowerLiveSyncError } from './flowerLiveWire';
import type { FlowerLiveStreamEnvelope, FlowerToolCallPreview } from './contracts/flowerSurfaceContracts';

const INTERACTION_PRESENTATION_REFRESH_MS = 75;
const MAX_PENDING_UPDATES = 64;

/** One transient frame in the live connection; ThreadCache remains the owner. */
export function createFlowerLiveFrameQueue(options: Readonly<{
  apply: (envelope: FlowerLiveStreamEnvelope, connectionEpoch: number) => void;
  batch?: (apply: () => void) => void;
  connectionEpoch?: () => number;
  onError?: (error: unknown, connectionEpoch: number) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  interaction?: Readonly<{ root: HTMLElement; attribute: string }>;
}>) {
  type Frame = Readonly<{ envelope: FlowerLiveStreamEnvelope; connectionEpoch: number }>;
  let pending: Frame[] = [];
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastAppliedAt = 0;
  let scheduleRevision = 0;
  let generation = 0;
  let disposed = false;
  const previewIdentities = new Map<string, readonly FlowerToolCallPreview[]>();
  const samePreviewAttempt = (before: readonly FlowerToolCallPreview[] | undefined, after: readonly FlowerToolCallPreview[] | null | undefined) => Boolean(before?.length && after?.length === before.length
    && after.every((call, index) => {
      const prior = before[index]!;
      return !call.arguments_complete && !prior.arguments_complete && call.turn_id === prior.turn_id
        && call.run_id === prior.run_id && call.logical_request_id === prior.logical_request_id
        && call.attempt_id === prior.attempt_id && call.attempt_epoch === prior.attempt_epoch
        && call.call_id === prior.call_id && call.name === prior.name;
    }));
  const cancelScheduled = () => {
    scheduleRevision++;
    if (frame !== undefined) options.cancelFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
    frame = undefined;
    timer = undefined;
  };
  const clear = () => {
    generation++;
    cancelScheduled();
    pending = [];
    previewIdentities.clear();
  };
  const current = (value: Frame) => !disposed
    && (!options.connectionEpoch || options.connectionEpoch() === value.connectionEpoch);
  const reportError = (error: unknown, connectionEpoch: number) => {
    clear();
    if (options.onError) options.onError(error, connectionEpoch);
    else throw error;
  };
  const apply = (value: Frame) => {
    if (current(value)) {
      options.apply(value.envelope, value.connectionEpoch);
      const envelope = value.envelope;
      const update = envelope.update ?? envelope.subagent_update;
      const baseline = envelope.current ?? envelope.subagent_current;
      const id = update?.thread_id ?? baseline?.thread_id;
      if (id && (baseline || update?.tool_call_previews)) {
        const calls = baseline?.tool_call_previews ?? update?.tool_call_previews?.value;
        if (calls?.length && calls.every(call => !call.arguments_complete)) previewIdentities.set(id, calls);
        else previewIdentities.delete(id);
      }
      lastAppliedAt = performance.now();
    }
  };
  const flush = () => {
    cancelScheduled();
    const values = pending;
    pending = [];
    const applyPending = () => { for (const value of values) apply(value); };
    if (options.batch) options.batch(applyPending);
    else applyPending();
  };
  const interactionActive = () => options.interaction?.root.getAttribute(options.interaction.attribute)
    ?.split(/\s+/).some(kind => kind === 'drag' || kind === 'resize') === true;
  const schedule = () => {
    if (!pending.length || disposed || frame !== undefined || timer !== undefined) return;
    const scheduledGeneration = generation;
    const revision = ++scheduleRevision;
    const connectionEpoch = pending[0]!.connectionEpoch;
    const remaining = interactionActive() ? INTERACTION_PRESENTATION_REFRESH_MS - (performance.now() - lastAppliedAt) : 0;
    if (remaining > 0) {
      timer = setTimeout(() => {
        if (scheduledGeneration !== generation || revision !== scheduleRevision || disposed) return;
        timer = undefined;
        schedule();
      }, remaining);
      return;
    }
    frame = options.requestFrame(() => {
      if (scheduledGeneration !== generation || revision !== scheduleRevision || disposed) return;
      try {
        // Interaction may start after a normal streaming frame was requested.
        if (interactionActive() && performance.now() - lastAppliedAt < INTERACTION_PRESENTATION_REFRESH_MS) {
          frame = undefined;
          schedule();
        } else flush();
      } catch (error) {
        reportError(error, connectionEpoch);
      }
    });
  };
  const interactionObserver = options.interaction && typeof MutationObserver !== 'undefined'
    ? new MutationObserver(() => {
      if (!interactionActive()) { cancelScheduled(); schedule(); }
    }) : undefined;
  if (options.interaction) interactionObserver?.observe(options.interaction.root, {
    attributes: true, attributeFilter: [options.interaction.attribute],
  });
  return {
    push(envelope: FlowerLiveStreamEnvelope, connectionEpoch = options.connectionEpoch?.() ?? 0) {
      const value = { envelope, connectionEpoch };
      if (!current(value)) return;
      if (pending.length && pending[0]!.connectionEpoch !== connectionEpoch) clear();
      const currentGeneration = generation;
      try {
        const update = envelope.update ?? envelope.subagent_update;
        const previewGrowth = update?.tool_call_previews && samePreviewAttempt(previewIdentities.get(update.thread_id), update.tool_call_previews.value);
        const growth = update && update.facts.activity === 'active' && update.facts.run_progress?.phase === 'streaming'
          && !update.facts.error && (update.items?.length || previewGrowth) && (update.items ?? []).every(change => change.kind === 'append')
          && !update.item_order && !update.turns && !update.goal && !update.parent_events && !update.context
          && !update.queue && !update.interactions && !update.restored_inputs
          && (!update.tool_call_previews || previewGrowth);
        if (growth) {
          if (pending.length >= MAX_PENDING_UPDATES) throw new FlowerLiveSyncError('Flower presentation update queue overflow.');
          pending.push(value);
          schedule();
          return;
        }
        flush();
        if (currentGeneration !== generation || !current(value)) return;
        apply(value);
      } catch (error) {
        reportError(error, connectionEpoch);
      }
    },
    boundary: clear,
    dispose() { disposed = true; interactionObserver?.disconnect(); clear(); },
  };
}
