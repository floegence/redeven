import { createEffect, onCleanup } from 'solid-js';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { refreshRedevenTerminalSessionsCoordinator } from './terminalSessions';

export function TerminalSessionsLifecycleSync() {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();

  let scheduled = false;
  const scheduleRefresh = () => {
    if (scheduled) return;
    scheduled = true;

    Promise.resolve().then(() => {
      scheduled = false;
      void refreshRedevenTerminalSessionsCoordinator();
    });
  };

  createEffect(() => {
    const client = protocol.client();
    if (!client) return;

    // Ensure the sessions list converges quickly on connect/reconnect.
    scheduleRefresh();

    const unsub = rpc.terminal.onSessionsChanged(() => {
      scheduleRefresh();
    });

    onCleanup(() => {
      unsub();
    });
  });

  return null;
}
