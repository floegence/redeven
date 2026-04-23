import { describe, expect, it } from 'vitest';

import { fromWireTerminalSessionsChangedNotify } from './terminal';

describe('terminal codec', () => {
  it('decodes hidden terminal close lifecycle notifications', () => {
    expect(fromWireTerminalSessionsChangedNotify({
      reason: 'close_failed_hidden',
      session_id: ' session-1 ',
      timestamp_ms: 42,
      lifecycle: 'close_failed_hidden',
      hidden: true,
      owner_widget_id: ' widget-terminal-1 ',
      failure_code: 'DELETE_FAILED',
      failure_message: 'pty cleanup timed out',
    })).toEqual({
      reason: 'close_failed_hidden',
      sessionId: 'session-1',
      timestampMs: 42,
      lifecycle: 'close_failed_hidden',
      hidden: true,
      ownerWidgetId: 'widget-terminal-1',
      failureCode: 'DELETE_FAILED',
      failureMessage: 'pty cleanup timed out',
    });
  });

  it('rejects unknown terminal session change reasons', () => {
    expect(fromWireTerminalSessionsChangedNotify({
      reason: 'unknown' as any,
    })).toBeNull();
  });
});
