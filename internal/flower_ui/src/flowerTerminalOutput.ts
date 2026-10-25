export type TerminalVisibleOutputStatus = 'running' | 'pending' | 'success' | 'error' | 'canceled' | 'waiting' | string;

export type TerminalVisibleOutputIdentity = Readonly<{
  surface_scope?: string;
  owner_thread_id?: string;
  render_thread_id?: string;
  run_id?: string;
  turn_id?: string;
  message_id?: string;
  block_index?: number | string;
  item_id?: string;
  tool_id?: string;
  process_id?: string;
  command?: string;
  command_hash?: string;
}>;

export type TerminalOutputFrame = Readonly<{
  output: string;
  first_seq: number;
  last_seq: number;
  truncated?: boolean;
}>;

export type TerminalVisibleOutputState = Readonly<{
  output: string;
  first_seq: number;
  last_seq: number;
  truncated: boolean;
}>;

export interface TerminalVisibleOutputStore {
  get(identity: TerminalVisibleOutputIdentity): string;
  replaceSnapshot(identity: TerminalVisibleOutputIdentity, snapshot: TerminalOutputFrame): string;
  appendDelta(identity: TerminalVisibleOutputIdentity, delta: TerminalOutputFrame): string;
  acknowledgeDeferred(identity: TerminalVisibleOutputIdentity, lastSeq: number,
    read: (afterSeq: number) => Promise<TerminalOutputFrame>, signal: AbortSignal): Promise<() => string>;
  clear(): void;
}

export const TERMINAL_OUTPUT_FOLLOW_THRESHOLD_PX = 24;

export type TerminalOutputViewportController = Readonly<{
  bind: (node: HTMLElement) => void;
  bindOutput: (node: HTMLElement) => void;
  setOutput: (output: string, immediate?: boolean) => void;
  notifyOutputChanged: () => void;
  onScroll: () => void;
  onWheel: (event: Pick<WheelEvent, 'deltaY'>) => void;
  followingLatest: () => boolean;
  dispose: () => void;
}>;

export type TerminalOutputViewportControllerOptions = Readonly<{
  thresholdPx?: number;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  onPresentationFrame?: () => void;
  interaction?: Readonly<{ root: HTMLElement; attribute: string }>;
}>;

export function createTerminalOutputViewportController(
  options: TerminalOutputViewportControllerOptions = {},
): TerminalOutputViewportController {
  const thresholdPx = Math.max(0, options.thresholdPx ?? TERMINAL_OUTPUT_FOLLOW_THRESHOLD_PX);
  const requestFrame = options.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.requestAnimationFrame(callback));
  const cancelFrame = options.cancelAnimationFrame ?? ((handle: number) => window.cancelAnimationFrame(handle));
  let viewport: HTMLElement | undefined;
  let frame: number | undefined;
  let followsLatest = true;
  let textNode: Text | undefined;
  let output = '';
  let immediate = false;
  let disposed = false;
  let pendingPresentation = false;
  const interactionActive = () => options.interaction?.root.getAttribute(options.interaction.attribute)
    ?.split(/\s+/).some(kind => kind === 'drag' || kind === 'resize') === true;

  const distanceToBottom = (): number => {
    if (!viewport) return 0;
    return Math.max(0, viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight);
  };
  const nearBottom = (): boolean => distanceToBottom() <= thresholdPx;
  const cancelScheduled = () => {
    if (frame === undefined) return;
    cancelFrame(frame);
    frame = undefined;
  };
  const paintOutput = () => {
    if (!textNode || textNode.data === output) return;
    if (output.startsWith(textNode.data)) textNode.appendData(output.slice(textNode.length));
    else textNode.data = output;
  };
  const schedule = () => {
    if (disposed || !pendingPresentation || !viewport || frame !== undefined || (interactionActive() && !immediate)) return;
    frame = requestFrame(() => {
      frame = undefined;
      if (disposed || !viewport || (interactionActive() && !immediate)) return;
      immediate = false;
      pendingPresentation = false;
      paintOutput();
      if (followsLatest) {
        viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      }
      options.onPresentationFrame?.();
    });
  };
  const notifyOutputChanged = () => { pendingPresentation = true; schedule(); };
  const observer = options.interaction && typeof MutationObserver !== 'undefined'
    ? new MutationObserver(() => {
      if (interactionActive() && !immediate) cancelScheduled();
      else schedule();
    }) : undefined;
  if (options.interaction) observer?.observe(options.interaction.root, {
    attributes: true, attributeFilter: [options.interaction.attribute],
  });

  return {
    bind: (node) => {
      viewport = node;
      followsLatest = true;
      notifyOutputChanged();
    },
    bindOutput: (node) => {
      textNode = node.ownerDocument.createTextNode('');
      node.appendChild(textNode);
      if (!interactionActive() || immediate) paintOutput();
      notifyOutputChanged();
    },
    setOutput: (value, urgent = false) => {
      output = value;
      immediate ||= urgent;
      if (urgent && !disposed) paintOutput();
      notifyOutputChanged();
    },
    notifyOutputChanged,
    onScroll: () => {
      followsLatest = nearBottom();
    },
    onWheel: (event) => {
      if (event.deltaY < 0) {
        followsLatest = false;
      }
    },
    followingLatest: () => followsLatest,
    dispose: () => {
      disposed = true;
      observer?.disconnect();
      cancelScheduled();
      viewport = undefined;
      textNode = undefined;
      output = '';
      pendingPresentation = false;
    },
  };
}

function normalizeOutput(value: unknown): string {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function normalizePart(value: unknown): string {
  return String(value ?? '').trim();
}

function isLiveStatus(status: TerminalVisibleOutputStatus | undefined): boolean {
  const value = String(status ?? '').trim().toLowerCase();
  return value === 'running' || value === 'pending' || value === 'waiting';
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function terminalVisibleOutputIdentityKey(identity: TerminalVisibleOutputIdentity): string {
  const scope = normalizePart(identity.surface_scope) || 'terminal';
  const ownerThreadID = normalizePart(identity.owner_thread_id);
  const renderThreadID = normalizePart(identity.render_thread_id);
  const runID = normalizePart(identity.run_id);
  const turnID = normalizePart(identity.turn_id);
  const messageID = normalizePart(identity.message_id);
  const blockIndex = normalizePart(identity.block_index);
  const itemID = normalizePart(identity.item_id);
  const toolID = normalizePart(identity.tool_id);
  const processID = normalizePart(identity.process_id);
  const commandHash = normalizePart(identity.command_hash) || (normalizePart(identity.command) ? hashText(normalizePart(identity.command)) : '');

  const threadScope = [scope, ownerThreadID, renderThreadID].join('\x1f');
  if (runID && (toolID || itemID)) {
    return [threadScope, runID, turnID, toolID || itemID, itemID].join('\x1e');
  }
  if (messageID && blockIndex) {
    return [threadScope, runID, turnID, messageID, blockIndex, itemID || toolID, commandHash].join('\x1e');
  }
  if (runID && processID) {
    return [threadScope, runID, processID].join('\x1e');
  }
  return [threadScope, runID, processID, commandHash].join('\x1e');
}

function normalizeSequence(value: unknown, field: string): number {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error(`Invalid terminal output ${field}.`);
  }
  return sequence;
}

function normalizeFrame(frame: TerminalOutputFrame, allowUnsequencedOutput = false): TerminalVisibleOutputState {
  const output = normalizeOutput(frame.output);
  const firstSeq = normalizeSequence(frame.first_seq, 'first_seq');
  const lastSeq = normalizeSequence(frame.last_seq, 'last_seq');
  if (output.length === 0) {
    if (firstSeq !== 0) throw new Error('Empty terminal output must have first_seq 0.');
  } else if (
    (firstSeq === 0 || lastSeq < firstSeq)
    && !(allowUnsequencedOutput && firstSeq === 0 && lastSeq === 0)
  ) {
    throw new Error('Terminal output sequence range is invalid.');
  }
  return { output, first_seq: firstSeq, last_seq: lastSeq, truncated: Boolean(frame.truncated) };
}

export function replaceTerminalOutputSnapshot(
  previous: TerminalVisibleOutputState | undefined,
  snapshot: TerminalOutputFrame,
): TerminalVisibleOutputState {
  const next = normalizeFrame(snapshot, true);
  const nextUnsequenced = next.output.length > 0 && next.first_seq === 0 && next.last_seq === 0;
  const previousUnsequenced = previous !== undefined
    && previous.output.length > 0
    && previous.first_seq === 0
    && previous.last_seq === 0;
  if (nextUnsequenced) return next;
  if (previousUnsequenced) {
    if (next.output.length === 0 && next.last_seq === 0) return previous;
    return next;
  }
  if (previous && next.last_seq <= previous.last_seq) return previous;
  return next;
}

export function appendTerminalOutputDelta(
  previous: TerminalVisibleOutputState | undefined,
  delta: TerminalOutputFrame,
): TerminalVisibleOutputState {
  const next = normalizeFrame(delta);
  const previousUnsequenced = previous !== undefined
    && previous.output.length > 0
    && previous.first_seq === 0
    && previous.last_seq === 0;
  if (previous && next.last_seq <= previous.last_seq) return previous;
  if (next.output.length === 0) {
    if (previous) return previous;
    return next;
  }
  if (previousUnsequenced) {
    if (next.first_seq !== 1 && !next.truncated) {
      throw new Error('Terminal output delta does not start at the first sequence.');
    }
    return next;
  }
  if (!previous) {
    if (next.first_seq !== 1 && !next.truncated) {
      throw new Error('Terminal output delta does not start at the first sequence.');
    }
    return next;
  }
  if (next.first_seq !== previous.last_seq + 1) {
    if (next.truncated && next.first_seq > previous.last_seq + 1) return next;
    throw new Error('Terminal output delta is not contiguous.');
  }
  return {
    output: `${previous.output}${next.output}`,
    first_seq: previous.first_seq || next.first_seq,
    last_seq: next.last_seq,
    truncated: previous.truncated || next.truncated,
  };
}

export function terminalListeningPlaceholderVisible(output: unknown, status: TerminalVisibleOutputStatus | undefined): boolean {
  return isLiveStatus(status) && !normalizeOutput(output).trim();
}

export function createTerminalVisibleOutputStore(maxEntries = 200): TerminalVisibleOutputStore {
  type Entry = { state: TerminalVisibleOutputState; frames: readonly TerminalVisibleOutputState[]; deferredThrough?: number };
  const entries = new Map<string, Entry>();

  const touch = (key: string, entry: Entry) => {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  return {
    get(identity) {
      return entries.get(terminalVisibleOutputIdentityKey(identity))?.state.output ?? '';
    },
    replaceSnapshot(identity, snapshot) {
      const key = terminalVisibleOutputIdentityKey(identity);
      const prior = entries.get(key);
      const state = replaceTerminalOutputSnapshot(prior?.state, snapshot);
      touch(key, state === prior?.state ? prior : { state, frames: state.output ? [state] : [] });
      return state.output;
    },
    appendDelta(identity, delta) {
      const key = terminalVisibleOutputIdentityKey(identity);
      const prior = entries.get(key);
      const state = appendTerminalOutputDelta(prior?.state, delta);
      const frame = normalizeFrame(delta);
      touch(key, state === prior?.state ? prior : { state,
        frames: frame.output ? frame.truncated && prior && frame.first_seq > prior.state.last_seq + 1
          ? [frame] : [...(prior?.frames ?? []), frame] : prior?.frames ?? [], deferredThrough: prior?.deferredThrough });
      return state.output;
    },
    async acknowledgeDeferred(identity, watermark, read, signal) {
      signal.throwIfAborted();
      const through = normalizeSequence(watermark, 'last_seq');
      const key = terminalVisibleOutputIdentityKey(identity);
      const prior = entries.get(key);
      if (prior?.deferredThrough !== undefined && through < prior.deferredThrough) return () => prior.state.output;
      let frames = (prior?.frames ?? []).filter(frame => frame.last_seq > through);
      if (frames.some(frame => frame.first_seq <= through)) {
        // A canonical watermark can fall inside a multi-sequence response.
        // Text cannot be split by sequence arithmetically. Re-read only that
        // retained suffix from its process owner before replacing the display.
        const target = prior!.state.last_seq;
        frames = [];
        let after = through;
        while (after < target) {
          const frame = normalizeFrame(await read(after));
          signal.throwIfAborted();
          if (!frame.output || frame.last_seq <= after || frame.first_seq !== after + 1 && !frame.truncated) {
            throw new Error('Deferred terminal output handoff did not advance.');
          }
          frames.push(frame); after = frame.last_seq;
        }
      }
      signal.throwIfAborted();
      let state = normalizeFrame({ output: '', first_seq: 0, last_seq: through });
      for (const frame of frames) state = appendTerminalOutputDelta(state, frame);
      // Publication belongs to the field owner after its range validation.
      // Aborting that read leaves both the old text and live tail intact.
      return () => {
        signal.throwIfAborted();
        if (entries.get(key) !== prior) throw new DOMException('Terminal source changed during handoff.', 'AbortError');
        touch(key, { state, frames, deferredThrough: through });
        return state.output;
      };
    },
    clear() {
      entries.clear();
    },
  };
}
