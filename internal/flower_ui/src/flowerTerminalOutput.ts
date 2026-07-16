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
  clear(): void;
}

export const TERMINAL_OUTPUT_FOLLOW_THRESHOLD_PX = 24;

export type TerminalOutputViewportController = Readonly<{
  bind: (node: HTMLElement) => void;
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
  const notifyOutputChanged = () => {
    if (!viewport || frame !== undefined) return;
    frame = requestFrame(() => {
      frame = undefined;
      if (!viewport) return;
      if (followsLatest) {
        viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      }
      options.onPresentationFrame?.();
    });
  };

  return {
    bind: (node) => {
      viewport = node;
      followsLatest = true;
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
      cancelScheduled();
      viewport = undefined;
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

function normalizeFrame(frame: TerminalOutputFrame): TerminalVisibleOutputState {
  const output = normalizeOutput(frame.output);
  const firstSeq = normalizeSequence(frame.first_seq, 'first_seq');
  const lastSeq = normalizeSequence(frame.last_seq, 'last_seq');
  if (output.length === 0) {
    if (firstSeq !== 0) throw new Error('Empty terminal output must have first_seq 0.');
  } else if (firstSeq === 0 || lastSeq < firstSeq) {
    throw new Error('Terminal output sequence range is invalid.');
  }
  return { output, first_seq: firstSeq, last_seq: lastSeq, truncated: Boolean(frame.truncated) };
}

export function replaceTerminalOutputSnapshot(
  previous: TerminalVisibleOutputState | undefined,
  snapshot: TerminalOutputFrame,
): TerminalVisibleOutputState {
  const next = normalizeFrame(snapshot);
  if (previous && next.last_seq <= previous.last_seq) return previous;
  return next;
}

export function appendTerminalOutputDelta(
  previous: TerminalVisibleOutputState | undefined,
  delta: TerminalOutputFrame,
): TerminalVisibleOutputState {
  const next = normalizeFrame(delta);
  if (previous && next.last_seq <= previous.last_seq) return previous;
  if (next.output.length === 0) {
    if (previous) return previous;
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
  const entries = new Map<string, TerminalVisibleOutputState>();

  const touch = (key: string, state: TerminalVisibleOutputState) => {
    entries.delete(key);
    entries.set(key, state);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  return {
    get(identity) {
      return entries.get(terminalVisibleOutputIdentityKey(identity))?.output ?? '';
    },
    replaceSnapshot(identity, snapshot) {
      const key = terminalVisibleOutputIdentityKey(identity);
      const state = replaceTerminalOutputSnapshot(entries.get(key), snapshot);
      touch(key, state);
      return state.output;
    },
    appendDelta(identity, delta) {
      const key = terminalVisibleOutputIdentityKey(identity);
      const state = appendTerminalOutputDelta(entries.get(key), delta);
      touch(key, state);
      return state.output;
    },
    clear() {
      entries.clear();
    },
  };
}
