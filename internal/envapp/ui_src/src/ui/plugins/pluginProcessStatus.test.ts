import { describe, expect, it } from 'vitest';

import { projectPluginProcessStatus } from './pluginProcessStatus';

describe('projectPluginProcessStatus', () => {
  it('uses the newest process event and projects only stable fields', () => {
    const status = projectPluginProcessStatus([
      {
        type: 'plugin.process.started', severity: 'info', message: 'plugin process started',
        occurred_at: '2026-10-07T01:00:00Z', details: { operation: 'start' },
      },
      {
        type: 'plugin.process.stream_gap', severity: 'warning', message: 'plugin process output buffer overflowed',
        occurred_at: '2026-10-07T01:01:00Z', details: { operation: 'read_stdout', stream: 'stdout' },
      },
    ]);

    expect(status).toEqual({
      state: 'stream_gap',
      eventType: 'plugin.process.stream_gap',
      occurredAt: '2026-10-07T01:01:00Z',
      operation: 'read_stdout',
      stream: 'stdout',
    });
  });

  it('maps permission failures to blocked and other failures to crashed', () => {
    expect(projectPluginProcessStatus([{
      type: 'plugin.process.operation_failed', severity: 'warning', message: 'plugin process operation failed',
      details: { code: 'PERMISSION_DENIED', operation: 'start' },
    }])).toMatchObject({ state: 'blocked', code: 'PERMISSION_DENIED' });
    expect(projectPluginProcessStatus([{
      type: 'plugin.background.failed', severity: 'warning', message: 'plugin background worker stopped unexpectedly',
      details: { operation: 'background_worker' },
    }])).toMatchObject({ state: 'crashed' });
  });

  it('ignores unrelated diagnostics and preserves input order without timestamps', () => {
    expect(projectPluginProcessStatus([
      { type: 'plugin.runtime.warning', severity: 'warning', message: 'runtime warning' },
      { type: 'plugin.process.starting', severity: 'info', message: 'plugin process is starting' },
    ])).toMatchObject({ state: 'starting' });
  });
});
