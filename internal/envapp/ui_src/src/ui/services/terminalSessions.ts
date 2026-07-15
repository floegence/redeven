import {
  TerminalSessionsCoordinator,
  type Logger,
  type TerminalTransport,
} from '@floegence/floeterm-terminal-web/sessions';

type singleton_state = {
  connId: string;
  coordinator: TerminalSessionsCoordinator;
};

let singleton: singleton_state | null = null;

export function createRedevenTerminalSessionsCoordinator(opts: {
  transport: TerminalTransport;
  logger?: Logger;
  pollMs?: number;
}): TerminalSessionsCoordinator {
  return new TerminalSessionsCoordinator({
    transport: opts.transport,
    pollMs: opts.pollMs ?? 60_000,
    logger: opts.logger,
  });
}

export function getRedevenTerminalSessionsCoordinator(opts: {
  connId: string;
  transport?: TerminalTransport;
  logger?: Logger;
  pollMs?: number;
}): TerminalSessionsCoordinator {
  const connId = String(opts.connId ?? '').trim();
  if (!connId) {
    throw new Error('Missing terminal connId');
  }

  if (singleton && singleton.connId === connId) {
    return singleton.coordinator;
  }

  // If connId changes (rare), create a fresh coordinator to avoid mixing sessions across connections.
  if (singleton) {
    singleton.coordinator.dispose();
  }

  const coordinator = createRedevenTerminalSessionsCoordinator({
    transport: opts.transport ?? {
      attach: async () => { throw new Error('Terminal sessions coordinator transport is unavailable'); },
      resize: async () => { throw new Error('Terminal sessions coordinator transport is unavailable'); },
      sendInput: async () => { throw new Error('Terminal sessions coordinator transport is unavailable'); },
      history: async () => { throw new Error('Terminal sessions coordinator transport is unavailable'); },
      clear: async () => { throw new Error('Terminal sessions coordinator transport is unavailable'); },
    },
    logger: opts.logger,
    pollMs: opts.pollMs,
  });

  singleton = { connId, coordinator };
  return coordinator;
}

export async function refreshRedevenTerminalSessionsCoordinator(): Promise<void> {
  try {
    await singleton?.coordinator.refresh();
  } catch {
    // Best-effort refresh; coordinator handles retry via polling.
  }
}

export function disposeRedevenTerminalSessionsCoordinator(): void {
  if (!singleton) return;
  singleton.coordinator.dispose();
  singleton = null;
}
