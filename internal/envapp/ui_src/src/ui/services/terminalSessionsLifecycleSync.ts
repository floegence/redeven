import { createEffect, onCleanup } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc } from '../protocol/redeven_v1';
import type { TerminalSessionsChangedEvent } from '../protocol/redeven_v1';
import { refreshRedevenTerminalSessionsCoordinator } from './terminalSessions';

export type TerminalSessionsLifecycleSyncProps = Readonly<{
  refresh?: () => Promise<void>;
  removeSession?: (sessionId: string) => void;
  refreshOnConnect?: boolean;
}>;

export function TerminalSessionsLifecycleSync(props: TerminalSessionsLifecycleSyncProps = {}) {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const notification = useNotification();
  const hiddenFailureNotified = new Set<string>();
  let disposed = false;

  let scheduled = false;
  const scheduleRefresh = () => {
    if (scheduled) return;
    scheduled = true;

    Promise.resolve().then(() => {
      scheduled = false;
      if (disposed) return;
      void (props.refresh?.() ?? refreshRedevenTerminalSessionsCoordinator()).catch(() => undefined);
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
    const status = (protocol as typeof protocol & { status?: () => string }).status?.() ?? 'connected';
    if (!client || status !== 'connected') return;

    // Ensure the sessions list converges quickly on connect/reconnect.
    if (props.refreshOnConnect !== false) scheduleRefresh();

    const unsub = rpc.terminal.onSessionsChanged((event) => {
      resetHiddenCloseFailureNotification(event);
      notifyHiddenCloseFailure(event);
      if (event.sessionId && (event.reason === 'deleted' || event.reason === 'closed')) {
        props.removeSession?.(event.sessionId);
      }
      scheduleRefresh();
    });

    onCleanup(() => {
      unsub();
    });
  });

  onCleanup(() => {
    disposed = true;
  });

  return null;
}
