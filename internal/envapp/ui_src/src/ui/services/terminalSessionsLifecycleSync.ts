import { createEffect, onCleanup } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc } from '../protocol/redeven_v1';
import type { TerminalSessionsChangedEvent } from '../protocol/redeven_v1';
import { refreshRedevenTerminalSessionsCoordinator } from './terminalSessions';

export function TerminalSessionsLifecycleSync() {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const notification = useNotification();
  const hiddenFailureNotified = new Set<string>();

  let scheduled = false;
  const scheduleRefresh = () => {
    if (scheduled) return;
    scheduled = true;

    Promise.resolve().then(() => {
      scheduled = false;
      void refreshRedevenTerminalSessionsCoordinator();
    });
  };

  const notifyHiddenCloseFailure = (event: TerminalSessionsChangedEvent) => {
    if (event.reason !== 'close_failed_hidden') return;
    const sessionKey = event.sessionId?.trim() || 'unknown-session';
    const failureKey = `${sessionKey}:${event.failureCode || 'UNKNOWN'}:${event.failureMessage || ''}`;
    if (hiddenFailureNotified.has(failureKey)) return;
    hiddenFailureNotified.add(failureKey);

    const detail = event.failureMessage?.trim()
      ? `The tab was removed, but cleanup is still blocked: ${event.failureMessage.trim()}`
      : 'The tab was removed, but Redeven could not finish cleaning up its PTY resources.';
    notification.error('Terminal cleanup delayed', detail);
  };

  const resetHiddenCloseFailureNotification = (event: TerminalSessionsChangedEvent) => {
    if (!event.sessionId || (event.reason !== 'closing' && event.reason !== 'deleted' && event.reason !== 'closed')) return;
    const prefix = `${event.sessionId.trim()}:`;
    for (const key of Array.from(hiddenFailureNotified)) {
      if (key.startsWith(prefix)) hiddenFailureNotified.delete(key);
    }
  };

  createEffect(() => {
    const client = protocol.client();
    if (!client) return;

    // Ensure the sessions list converges quickly on connect/reconnect.
    scheduleRefresh();

    const unsub = rpc.terminal.onSessionsChanged((event) => {
      resetHiddenCloseFailureNotification(event);
      notifyHiddenCloseFailure(event);
      scheduleRefresh();
    });

    onCleanup(() => {
      unsub();
    });
  });

  return null;
}
