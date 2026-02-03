import { TerminalSessionsCoordinator, type Logger, type TerminalTransport } from '@floegence/floeterm-terminal-web';

type singleton_state = {
  connId: string;
  coordinator: TerminalSessionsCoordinator;
};

let singleton: singleton_state | null = null;

export function getRedevenTerminalSessionsCoordinator(opts: {
  connId: string;
  transport: TerminalTransport;
  logger?: Logger;
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

  const coordinator = new TerminalSessionsCoordinator({
    transport: opts.transport,
    pollMs: 60_000,
    logger: opts.logger,
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
