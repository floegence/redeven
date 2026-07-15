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

export interface TerminalVisibleOutputStore {
  get(identity: TerminalVisibleOutputIdentity): string;
  merge(identity: TerminalVisibleOutputIdentity, current: unknown, next: unknown, status?: TerminalVisibleOutputStatus): string;
  remember(identity: TerminalVisibleOutputIdentity, output: unknown): void;
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

export function mergeTerminalVisibleOutput(previous: unknown, next: unknown, _status?: TerminalVisibleOutputStatus): string {
  const current = normalizeOutput(previous);
  const incoming = normalizeOutput(next);
  if (!incoming.trim()) {
    return current;
  }
  if (!current.trim()) return incoming;
  if (incoming === current) return current;
  if (incoming.startsWith(current)) return incoming;
  if (current.includes(incoming)) return current;
  return `${current}${current.endsWith('\n') || incoming.startsWith('\n') ? '' : '\n'}${incoming}`;
}

export function terminalListeningPlaceholderVisible(output: unknown, status: TerminalVisibleOutputStatus | undefined): boolean {
  return isLiveStatus(status) && !normalizeOutput(output).trim();
}

export function createTerminalVisibleOutputStore(maxEntries = 200): TerminalVisibleOutputStore {
  const entries = new Map<string, string>();

  const touch = (key: string, output: string) => {
    entries.delete(key);
    entries.set(key, output);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  return {
    get(identity) {
      return entries.get(terminalVisibleOutputIdentityKey(identity)) ?? '';
    },
    merge(identity, current, next, status) {
      const key = terminalVisibleOutputIdentityKey(identity);
      const merged = mergeTerminalVisibleOutput(entries.get(key) ?? current, next, status);
      if (merged.trim()) {
        touch(key, merged);
      }
      return merged;
    },
    remember(identity, output) {
      const normalized = normalizeOutput(output);
      if (!normalized.trim()) return;
      touch(terminalVisibleOutputIdentityKey(identity), normalized);
    },
    clear() {
      entries.clear();
    },
  };
}
