import { FLOWER_LIVE_ENVELOPE_BYTES, FlowerLiveSyncError } from './flowerLiveWire';
import type { FlowerLiveStreamEnvelope, FlowerToolCallPreview } from './contracts/flowerSurfaceContracts';

const INTERACTION_PRESENTATION_REFRESH_MS = 75;
const MAX_PENDING_UPDATES = 64;
const MAX_PENDING_UPDATE_BYTES = 4 * 1024 * 1024;
const MAX_PENDING_AGE_MS = 250;
const APPLY_BUDGET_MS = 4;
const utf8 = new TextEncoder();

/** One transient frame in the live connection; ThreadCache remains the owner. */
export function createFlowerLiveFrameQueue(options: Readonly<{
  apply: (envelope: FlowerLiveStreamEnvelope, connectionEpoch: number) => void;
  batch?: (apply: () => void) => void;
  connectionEpoch?: () => number;
  onError?: (error: unknown, connectionEpoch: number) => void;
  onPendingMetrics?: (metrics: Readonly<{ bytes: number; ageMs: number; updates: number }>) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  interaction?: Readonly<{ root: HTMLElement; attribute: string }>;
}>) {
  type Frame = { bytes: number; queuedAt: number; urgent?: boolean; envelope: FlowerLiveStreamEnvelope; connectionEpoch: number; append?: {
    chunks: string[]; offset: number; endOffset: number; baseVersion: number; factsKey: string;
  }; body?: { baseVersion: number; factsKey: string; encodedBytes: number } };
  let pending: Frame[] = [];
  let pendingBytes = 0;
  let pendingStartedAt: number | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let failedEpoch: number | undefined;
  let maxPendingBytes = 0;
  let maxPendingAgeMs = 0;
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastAppliedAt = 0;
  let scheduleRevision = 0;
  let generation = 0;
  let disposed = false;
  const idleWaiters = new Set<() => void>();
  const capacityWaiters = new Set<() => void>();
  const releaseCapacity = () => {
    if (!pending.length) { for (const resolve of idleWaiters) resolve(); idleWaiters.clear(); }
    if (pending.length >= 16 || pendingBytes >= 1024 * 1024) return;
    for (const resolve of capacityWaiters) resolve();
    capacityWaiters.clear();
  };
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
    if (deadline !== undefined) clearTimeout(deadline);
    frame = undefined;
    timer = undefined;
    deadline = undefined;
  };
  const clear = () => {
    generation++;
    cancelScheduled();
    pending = [];
    pendingBytes = 0;
    pendingStartedAt = undefined;
    previewIdentities.clear();
    releaseCapacity();
  };
  const current = (value: Frame) => !disposed && failedEpoch !== value.connectionEpoch
    && (!options.connectionEpoch || options.connectionEpoch() === value.connectionEpoch);
  const reportError = (error: unknown, connectionEpoch: number) => {
    clear();
    failedEpoch = connectionEpoch;
    if (options.onError) options.onError(error, connectionEpoch);
    else throw error;
  };
  const apply = (value: Frame) => {
    if (current(value)) {
      if (value.body) {
        const envelope = value.envelope;
        const update = (envelope.update ?? envelope.subagent_update)!;
        const merged = { ...update, base_version: value.body.baseVersion };
        value.envelope = envelope.subagent_update ? { ...envelope, subagent_update: merged } : { ...envelope, update: merged };
      } else if (value.append) {
        const envelope = value.envelope;
        const update = (envelope.update ?? envelope.subagent_update)!;
        const merged = { ...update, base_version: value.append.baseVersion,
          items: [{ kind: 'append' as const, item_id: update.items![0]!.item_id,
            append: { offset_bytes: value.append.offset, text: value.append.chunks.join('') } }] };
        value.envelope = envelope.subagent_update ? { ...envelope, subagent_update: merged } : { ...envelope, update: merged };
      }
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
    const started = performance.now();
    const scheduledGeneration = generation;
    const bytes = pendingBytes;
    const ageMs = pendingStartedAt === undefined ? 0 : Math.max(0, started - pendingStartedAt);
    let updates = 0;
    // Include reactive commits in the budget. Each envelope remains atomic;
    // yielding between envelopes gives input and painting a real task boundary.
    while (pending.length && scheduledGeneration === generation) {
      const value = pending.shift()!;
      pendingBytes -= value.bytes;
      if (options.batch) {
        let failure: { error: unknown } | undefined;
        options.batch(() => {
          // A throwing Solid batch discards queued reactive notifications.
          // Commit the owner's recovery state before handing off the error.
          try { apply(value); } catch (error) { failure = { error }; }
        });
        if (failure) throw failure.error;
      } else apply(value);
      updates++;
      if (performance.now() - started >= APPLY_BUDGET_MS) break;
    }
    pendingStartedAt = pending[0]?.queuedAt;
    releaseCapacity();
    maxPendingAgeMs = Math.max(maxPendingAgeMs, ageMs);
    if (updates) {
      const metrics = { bytes, ageMs, updates, maxPendingBytes, maxPendingAgeMs, durationMs: performance.now() - started };
      options.onPendingMetrics?.(metrics);
      performance.clearMarks('flower.live.frame_queue');
      performance.mark('flower.live.frame_queue', { detail: metrics });
    }
    schedule(true);
  };
  const encodedBytes = (value: FlowerLiveStreamEnvelope) => utf8.encode(JSON.stringify(value)).byteLength;
  const appendOnly = (value: FlowerLiveStreamEnvelope) => {
    const update = value.update ?? value.subagent_update;
    return update && update.items?.length === 1 && update.items[0]?.kind === 'append' && update.items[0].append && !update.items[0].item
      && !update.item_order && !update.context && !update.goal && !update.parent_events && !update.turns
      && !update.queue && !update.interactions && !update.tool_call_previews && !update.restored_inputs;
  };
  const bodyOnly = (value: FlowerLiveStreamEnvelope) => {
    const update = value.update ?? value.subagent_update;
    return update && update.items?.length === 1 && update.items[0]?.kind === 'body' && update.items[0].body
      && !update.items[0].item && !update.items[0].append && !update.tool_call_previews;
  };
  const factsKey = (value: FlowerLiveStreamEnvelope) => {
    const { sampled_at_ms: _sample, ...facts } = (value.update ?? value.subagent_update)!.facts;
    const progress = facts.run_progress;
    if (progress?.request) {
      const { estimated_output_tokens: _tokens, last_progress_at: _at, ...request } = progress.request;
      return JSON.stringify({ ...facts, run_progress: { ...progress, request } });
    }
    return JSON.stringify(facts);
  };
  const progressAdvances = (before: FlowerLiveStreamEnvelope, after: FlowerLiveStreamEnvelope) => {
    const left = (before.update ?? before.subagent_update)!.facts.run_progress?.request;
    const right = (after.update ?? after.subagent_update)!.facts.run_progress?.request;
    if (!left || !right) return !left && !right;
    const previousTime = left.last_progress_at ? Date.parse(left.last_progress_at) : 0;
    const nextTime = right.last_progress_at ? Date.parse(right.last_progress_at) : 0;
    return right.estimated_output_tokens >= left.estimated_output_tokens && nextTime >= previousTime;
  };
  const sameAppendStream = (before: FlowerLiveStreamEnvelope, after: FlowerLiveStreamEnvelope) => {
    const left = before.update ?? before.subagent_update;
    const right = after.update ?? after.subagent_update;
    return Boolean(appendOnly(before) && appendOnly(after) && Boolean(before.subagent_update) === Boolean(after.subagent_update)
      && before.reading_revision === after.reading_revision && before.thread_id === after.thread_id && left?.thread_id === right?.thread_id && left?.turn_id === right?.turn_id
      && left?.run_id === right?.run_id && left?.items?.[0]?.item_id === right?.items?.[0]?.item_id);
  };
  const hasUrgent = () => pending.some(value => value.urgent);
  const interactionActive = () => options.interaction?.root.getAttribute(options.interaction.attribute)
    ?.split(/\s+/).some(kind => kind === 'drag' || kind === 'resize') === true;
  const schedule = (continuation = false) => {
    if (!pending.length || disposed || frame !== undefined || timer !== undefined) return;
    const scheduledGeneration = generation;
    const revision = ++scheduleRevision;
    const connectionEpoch = pending[0]!.connectionEpoch;
    if (continuation || hasUrgent()) {
      timer = setTimeout(() => {
        if (scheduledGeneration !== generation || revision !== scheduleRevision || disposed) return;
        timer = undefined;
        try { flush(); } catch (error) { reportError(error, connectionEpoch); }
      }, 0);
      return;
    }
    if (deadline === undefined) {
      const remainingAge = MAX_PENDING_AGE_MS - (performance.now() - pendingStartedAt!);
      deadline = setTimeout(() => {
        if (scheduledGeneration !== generation || disposed) return;
        try { flush(); } catch (error) { reportError(error, connectionEpoch); }
      }, Math.max(0, remainingAge));
    }
    const remaining = !hasUrgent() && interactionActive() ? INTERACTION_PRESENTATION_REFRESH_MS - (performance.now() - lastAppliedAt) : 0;
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
        if (!hasUrgent() && interactionActive() && performance.now() - lastAppliedAt < INTERACTION_PRESENTATION_REFRESH_MS) {
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
      const value: Frame = { envelope, connectionEpoch, bytes: 0, queuedAt: performance.now() };
      if (!current(value)) return;
      if (pending.length && pending[0]!.connectionEpoch !== connectionEpoch) clear();
      try {
        const update = envelope.update ?? envelope.subagent_update;
        const previewGrowth = update?.tool_call_previews && samePreviewAttempt(previewIdentities.get(update.thread_id), update.tool_call_previews.value);
        const growth = update && update.facts.activity === 'active' && update.facts.run_progress?.phase === 'streaming'
          && !update.facts.error && !update.facts.cancellation && !update.facts.last_outcome
          && !update.facts.attention?.approval_count && !update.facts.attention?.input_count && (update.items?.length || previewGrowth) && (update.items ?? []).every(change => change.kind === 'append' || change.kind === 'body')
          && !update.item_order && !update.turns && !update.goal && !update.parent_events && !update.context
          && !update.queue && !update.interactions && !update.restored_inputs
          && (!update.tool_call_previews || previewGrowth);
        if (growth) {
          const last = pending.at(-1);
          const fragment = appendOnly(envelope) ? update.items![0]!.append! : undefined;
          const bytes = encodedBytes(envelope);
          if (last?.body && bodyOnly(envelope)) {
            const previous = (last.envelope.update ?? last.envelope.subagent_update)!;
            const left = previous.items![0]!.body!;
            const right = update.items![0]!.body!;
            if (last.envelope.reading_revision === envelope.reading_revision && last.envelope.thread_id === envelope.thread_id
              && Boolean(last.envelope.subagent_update) === Boolean(envelope.subagent_update)
              && previous.thread_id === update.thread_id && previous.turn_id === update.turn_id && previous.run_id === update.run_id
              && previous.items![0].item_id === update.items![0].item_id && previous.view_version === update.base_version
              && left.run_id === right.run_id && left.source_id === right.source_id && left.entry_id === right.entry_id
              && left.field === right.field && left.preview_bytes === right.preview_bytes && right.bytes >= left.bytes
              && last.body.factsKey === factsKey(envelope) && progressAdvances(last.envelope, envelope)) {
              if (pendingBytes + bytes - last.body.encodedBytes > MAX_PENDING_UPDATE_BYTES) throw new FlowerLiveSyncError('Flower presentation update byte budget exceeded.');
              pendingBytes += bytes - last.body.encodedBytes;
              last.bytes = bytes;
              last.body.encodedBytes = bytes; last.envelope = envelope;
              maxPendingBytes = Math.max(maxPendingBytes, pendingBytes);
              schedule(); return;
            }
          }
          // Count incoming bytes once. Chunks are joined once at presentation,
          // so merging a long frame never repeatedly serializes its full text.
          if (last?.append && fragment && sameAppendStream(last.envelope, envelope)) {
            const previous = (last.envelope.update ?? last.envelope.subagent_update)!;
            if (previous.view_version !== update.base_version || last.append.endOffset !== fragment.offset_bytes) {
              throw new FlowerLiveSyncError('Flower streaming append lost its contiguous baseline.');
            }
            if (last.append.factsKey === factsKey(envelope) && progressAdvances(last.envelope, envelope)) {
              if (pendingBytes + bytes > MAX_PENDING_UPDATE_BYTES) throw new FlowerLiveSyncError('Flower presentation update byte budget exceeded.');
              pendingBytes += bytes;
              last.bytes += bytes;
              last.append.chunks.push(fragment.text);
              last.append.endOffset += utf8.encode(fragment.text).byteLength;
              last.envelope = envelope;
              maxPendingBytes = Math.max(maxPendingBytes, pendingBytes);
              schedule();
              return;
            }
          }
          if (pending.length >= MAX_PENDING_UPDATES || pendingBytes + bytes > MAX_PENDING_UPDATE_BYTES) {
            throw new FlowerLiveSyncError('Flower presentation update queue overflow.');
          }
          if (!pending.length) pendingStartedAt = performance.now();
          pendingBytes += bytes; value.bytes = bytes;
          maxPendingBytes = Math.max(maxPendingBytes, pendingBytes);
          if (fragment) value.append = { chunks: [fragment.text], offset: fragment.offset_bytes,
            endOffset: fragment.offset_bytes + utf8.encode(fragment.text).byteLength, baseVersion: update.base_version, factsKey: factsKey(envelope) };
          else if (bodyOnly(envelope)) value.body = { baseVersion: update.base_version, factsKey: factsKey(envelope), encodedBytes: bytes };
          pending.push(value);
          schedule();
          return;
        }
        const bytes = encodedBytes(envelope);
        // A supported atomic baseline may exceed the growth queue budget.
        // Reserve one wire envelope; the consumer waits before reading another.
        if (pending.length >= MAX_PENDING_UPDATES || bytes > FLOWER_LIVE_ENVELOPE_BYTES
          || pendingBytes + bytes > MAX_PENDING_UPDATE_BYTES + FLOWER_LIVE_ENVELOPE_BYTES) {
          throw new FlowerLiveSyncError('Flower presentation update queue overflow.');
        }
        if (!pending.length) pendingStartedAt = value.queuedAt;
        const hadUrgent = hasUrgent();
        value.bytes = bytes; value.urgent = true;
        pendingBytes += bytes; maxPendingBytes = Math.max(maxPendingBytes, pendingBytes);
        pending.push(value);
        // Semantic events bypass drag throttling, but never preceding data or
        // the shared task budget. No WebSocket callback performs UI work.
        if (!hadUrgent) cancelScheduled();
        schedule();
      } catch (error) {
        reportError(error, connectionEpoch);
      }
    },
    waitUntilIdle(): Promise<void> | undefined {
      if (!pending.length) return;
      return new Promise(resolve => idleWaiters.add(resolve));
    },
    waitForCapacity(): Promise<void> | undefined {
      if (pending.length < 16 && pendingBytes < 1024 * 1024) return;
      return new Promise(resolve => capacityWaiters.add(resolve));
    },
    boundary() { clear(); failedEpoch = undefined; },
    dispose() { disposed = true; interactionObserver?.disconnect(); clear(); },
  };
}
