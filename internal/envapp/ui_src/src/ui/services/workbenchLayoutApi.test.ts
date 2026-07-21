// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./localApi', () => ({
  prepareLocalApiRequestInit: async (init: RequestInit) => init,
}));

import { createWorkbenchTerminalSession } from './workbenchLayoutApi';

function terminalCreatePayload(foregroundCommand?: unknown, outputActivity?: unknown) {
  return {
    data: {
      session: {
        id: 'session-1',
        name: 'repo',
        working_dir: '/workspace/repo',
        created_at_ms: 1,
        last_active_at_ms: 2,
        is_active: true,
        ...(foregroundCommand === undefined ? {} : { foreground_command: foregroundCommand }),
        ...(outputActivity === undefined ? {} : { output_activity: outputActivity }),
      },
      widget_state: {
        widget_id: 'widget-terminal-1',
        widget_type: 'redeven.terminal',
        revision: 1,
        updated_at_unix_ms: 2,
        state: { kind: 'terminal', session_ids: ['session-1'] },
      },
    },
  };
}

function stubResponse(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })));
}

describe('createWorkbenchTerminalSession', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves the foreground command snapshot in the Workbench create path', async () => {
    stubResponse(terminalCreatePayload({
      phase: 'running',
      display_name: 'top',
      revision: 3,
      updated_at_ms: 4,
    }));

    await expect(createWorkbenchTerminalSession('widget-terminal-1', {})).resolves.toMatchObject({
      session: {
        id: 'session-1',
        foreground_command: {
          phase: 'running',
          display_name: 'top',
          revision: 3,
          updated_at_ms: 4,
        },
      },
    });
  });

  it('preserves output activity and uses unknown for mixed-version responses', async () => {
    stubResponse(terminalCreatePayload({
      phase: 'running', display_name: 'codex', revision: 3, updated_at_ms: 4,
    }, {
      phase: 'streaming', revision: 7, updated_at_ms: 8,
    }));
    await expect(createWorkbenchTerminalSession('widget-terminal-1', {})).resolves.toMatchObject({
      session: {
        output_activity: { phase: 'streaming', revision: 7, updated_at_ms: 8 },
      },
    });

    stubResponse(terminalCreatePayload());
    await expect(createWorkbenchTerminalSession('widget-terminal-1', {})).resolves.toMatchObject({
      session: {
        output_activity: { phase: 'unknown', revision: 0, updated_at_ms: 0 },
      },
    });

    stubResponse(terminalCreatePayload(undefined, {
      phase: 'done', revision: 999, updated_at_ms: 9,
    }));
    await expect(createWorkbenchTerminalSession('widget-terminal-1', {})).resolves.toMatchObject({
      session: {
        output_activity: { phase: 'unknown', revision: 0, updated_at_ms: 0 },
      },
    });
  });

  it('normalizes a missing snapshot to unknown and rejects malformed command metadata', async () => {
    stubResponse(terminalCreatePayload());
    await expect(createWorkbenchTerminalSession('widget-terminal-1', {})).resolves.toMatchObject({
      session: {
        foreground_command: {
          phase: 'unknown',
          display_name: '',
          revision: 0,
          updated_at_ms: 0,
        },
      },
    });

    stubResponse(terminalCreatePayload({
      phase: 'running',
      display_name: '/usr/bin/top',
      revision: 5,
      updated_at_ms: 6,
    }));
    await expect(createWorkbenchTerminalSession('widget-terminal-1', {}))
      .rejects.toThrow('Invalid workbench terminal session response');
  });
});
