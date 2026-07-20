import type {
  TerminalForegroundCommandInfo,
  TerminalSessionInfo,
} from '@floegence/floeterm-terminal-web';
import { normalizeTerminalForegroundCommandDisplayName } from '@floegence/floeterm-terminal-web/sessions';

export const TERMINAL_FOREGROUND_PRESENTATION_DELAY_MS = 140;

export type TerminalForegroundPresentation = Readonly<{
  displayName: string;
  revision: number;
}>;

export type TerminalForegroundPresentationScheduler = Readonly<{
  sync: (sessions: readonly TerminalSessionInfo[]) => void;
  getSnapshot: () => ReadonlyMap<string, TerminalForegroundPresentation>;
  dispose: () => void;
}>;

type PendingPresentation = TerminalForegroundPresentation & Readonly<{ dueAt: number }>;

type SchedulerOptions = Readonly<{
  publish: (snapshot: ReadonlyMap<string, TerminalForegroundPresentation>) => void;
  delayMs?: number;
  now?: () => number;
  scheduleTimeout?: typeof globalThis.setTimeout;
  cancelTimeout?: typeof globalThis.clearTimeout;
}>;

const UNKNOWN_COMMAND: TerminalForegroundCommandInfo = Object.freeze({
  phase: 'unknown',
  displayName: '',
  revision: 0,
  updatedAtMs: 0,
});

export function normalizeTerminalForegroundCommand(
  value: TerminalSessionInfo['foregroundCommand'],
): TerminalForegroundCommandInfo {
  if (!value || typeof value !== 'object') return UNKNOWN_COMMAND;
  const phase = value.phase;
  const revision = value.revision;
  const updatedAtMs = value.updatedAtMs;
  const rawDisplayName = typeof value.displayName === 'string' ? value.displayName : '';
  if (phase !== 'unknown' && phase !== 'idle' && phase !== 'running') return UNKNOWN_COMMAND;
  if (!Number.isSafeInteger(revision) || revision < 0) return UNKNOWN_COMMAND;
  if (!Number.isSafeInteger(updatedAtMs) || updatedAtMs < 0) return UNKNOWN_COMMAND;
  if (phase !== 'running' && rawDisplayName !== '') return UNKNOWN_COMMAND;
  const displayName = normalizeTerminalForegroundCommandDisplayName(rawDisplayName);
  if (rawDisplayName && displayName !== rawDisplayName) return UNKNOWN_COMMAND;
  return { phase, displayName, revision, updatedAtMs };
}

function sameCommand(
  left: TerminalForegroundCommandInfo | undefined,
  right: TerminalForegroundCommandInfo,
): boolean {
  return Boolean(
    left
    && left.phase === right.phase
    && left.displayName === right.displayName
    && left.revision === right.revision
    && left.updatedAtMs === right.updatedAtMs,
  );
}

export function createTerminalForegroundPresentationScheduler(
  options: SchedulerOptions,
): TerminalForegroundPresentationScheduler {
  const delayMs = Math.max(0, Number(options.delayMs ?? TERMINAL_FOREGROUND_PRESENTATION_DELAY_MS));
  const now = options.now ?? Date.now;
  const scheduleTimeout = options.scheduleTimeout ?? globalThis.setTimeout;
  const cancelTimeout = options.cancelTimeout ?? globalThis.clearTimeout;
  const latestBySession = new Map<string, TerminalForegroundCommandInfo>();
  const pendingBySession = new Map<string, PendingPresentation>();
  const presentedBySession = new Map<string, TerminalForegroundPresentation>();
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let disposed = false;

  const publish = () => options.publish(new Map(presentedBySession));

  const clearTimer = () => {
    if (timer == null) return;
    cancelTimeout(timer);
    timer = null;
  };

  const armTimer = () => {
    clearTimer();
    if (disposed || pendingBySession.size === 0) return;
    let earliest = Number.POSITIVE_INFINITY;
    for (const pending of pendingBySession.values()) {
      earliest = Math.min(earliest, pending.dueAt);
    }
    timer = scheduleTimeout(() => {
      timer = null;
      if (disposed) return;
      const currentTime = now();
      let changed = false;
      for (const [sessionId, pending] of pendingBySession) {
        if (pending.dueAt > currentTime) continue;
        pendingBySession.delete(sessionId);
        const latest = latestBySession.get(sessionId);
        if (
          latest?.phase !== 'running'
          || latest.revision !== pending.revision
          || latest.displayName !== pending.displayName
        ) continue;
        const current = presentedBySession.get(sessionId);
        if (current?.revision === pending.revision && current.displayName === pending.displayName) continue;
        presentedBySession.set(sessionId, {
          displayName: pending.displayName,
          revision: pending.revision,
        });
        changed = true;
      }
      if (changed) publish();
      armTimer();
    }, Math.max(0, earliest - now()));
  };

  return {
    sync(sessions) {
      if (disposed) return;
      const visibleIds = new Set<string>();
      let presentationChanged = false;
      const receivedAt = now();

      for (const session of sessions) {
        const sessionId = String(session?.id ?? '').trim();
        if (!sessionId) continue;
        visibleIds.add(sessionId);
        const incoming = normalizeTerminalForegroundCommand(session.foregroundCommand);
        const current = latestBySession.get(sessionId);
        if (current && incoming.revision < current.revision) continue;
        if (current && incoming.revision === current.revision && !sameCommand(current, incoming)) continue;
        if (!sameCommand(current, incoming)) latestBySession.set(sessionId, incoming);

        if (incoming.phase !== 'running') {
          pendingBySession.delete(sessionId);
          if (presentedBySession.delete(sessionId)) presentationChanged = true;
          continue;
        }

        const presented = presentedBySession.get(sessionId);
        if (presented?.revision === incoming.revision && presented.displayName === incoming.displayName) {
          pendingBySession.delete(sessionId);
          continue;
        }
        const pending = pendingBySession.get(sessionId);
        if (pending?.revision === incoming.revision && pending.displayName === incoming.displayName) continue;
        if (presentedBySession.delete(sessionId)) presentationChanged = true;
        pendingBySession.set(sessionId, {
          displayName: incoming.displayName,
          revision: incoming.revision,
          dueAt: receivedAt + delayMs,
        });
      }

      for (const sessionId of [...latestBySession.keys()]) {
        if (visibleIds.has(sessionId)) continue;
        latestBySession.delete(sessionId);
        pendingBySession.delete(sessionId);
        if (presentedBySession.delete(sessionId)) presentationChanged = true;
      }

      if (presentationChanged) publish();
      armTimer();
    },
    getSnapshot: () => new Map(presentedBySession),
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimer();
      latestBySession.clear();
      pendingBySession.clear();
      presentedBySession.clear();
    },
  };
}
