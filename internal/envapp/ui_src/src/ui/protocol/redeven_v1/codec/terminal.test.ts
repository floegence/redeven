import { describe, expect, it } from 'vitest';

import {
  fromWireTerminalExecutionContextUpdateNotify,
  fromWireTerminalForegroundCommandUpdateNotify,
  fromWireTerminalSemanticClearResponse,
  fromWireTerminalSemanticHistoryResponse,
  fromWireTerminalNameUpdateNotify,
  fromWireTerminalOutputActivityUpdateNotify,
  fromWireTerminalSessionCreateResponse,
  fromWireTerminalSessionListResponse,
  fromWireTerminalSessionsChangedNotify,
  fromWireTerminalWorkStateUpdateNotify,
  toWireTerminalSemanticClearRequest,
  toWireTerminalSemanticHistoryRequest,
} from './terminal';

describe('terminal codec', () => {
  it('preserves semantic history pages and the attachment-bound request for feature validation', () => {
    expect(toWireTerminalSemanticHistoryRequest({
      sessionId: 'session-1',
      connectionId: 'view-1',
      transportGeneration: 7,
      direction: 'end',
      limit: 24,
    })).toEqual({
      session_id: 'session-1',
      connection_id: 'view-1',
      transport_generation: 7,
      direction: 'end',
      limit: 24,
    });
    expect(Object.hasOwn(toWireTerminalSemanticHistoryRequest({
      sessionId: 'session-1',
      connectionId: 'view-1',
      transportGeneration: 7,
      direction: 'start',
      limit: 24,
    }), 'anchor')).toBe(false);
    const response = fromWireTerminalSemanticHistoryResponse({
      revision: 3,
      anchor: 'anchor',
      firstAvailable: 'first',
      lastAvailable: 'last',
      screenStart: 'screen',
      offset: 41,
      totalRows: 42,
      screenStartOffset: 41,
      hasPrevious: true,
      hasNext: false,
      frame: {
        width: 2,
        height: 1,
        bufferKind: 'normal',
        rows: [{ cells: [{ text: '中', width: 2 }, { text: '', width: 0 }] }],
        cursor: { x: 0, y: 0, visible: true, shape: 'block', blinking: false },
        history: { revision: 3, totalRows: 42, screenStartOffset: 41 },
        graphics: { generation: 0, images: [], placements: [] },
      },
    });
    expect(response.totalRows).toBe(42);
    expect(response.frame.rows[0]?.cells[0]).toMatchObject({ text: '中', width: 2 });
  });

  it('accepts only a real semantic clear actor cut', () => {
    expect(toWireTerminalSemanticClearRequest({
      sessionId: 'session-1', connectionId: 'view-1', transportGeneration: 9,
    })).toEqual({
      session_id: 'session-1', connection_id: 'view-1', transport_generation: 9,
    });
    expect(fromWireTerminalSemanticClearResponse({
      presentation_sequence: 12,
      content_epoch: 2,
    })).toEqual({ presentationSequence: 12, contentEpoch: 2 });
    expect(() => fromWireTerminalSemanticClearResponse({
      presentation_sequence: 0,
      content_epoch: 2,
    })).toThrow('presentation sequence');
  });

  it('decodes foreground command snapshots and defaults missing snapshots to unknown', () => {
    expect(fromWireTerminalSessionListResponse({
      sessions: [{
        id: 'session-1',
        name: 'repo',
        working_dir: '/workspace/repo',
        created_at_ms: 1,
        last_active_at_ms: 2,
        is_active: true,
        foreground_command: {
          phase: 'running',
          display_name: 'top',
          revision: 3,
          updated_at_ms: 4,
        },
        output_activity: {
          phase: 'settled',
          revision: 5,
          updated_at_ms: 6,
        },
        local_path_capability: {
          working_dir: '/workspace/repo',
        },
      }, {
        id: 'session-2',
        name: 'legacy',
        working_dir: '/',
        created_at_ms: 1,
        last_active_at_ms: 2,
        is_active: false,
      }],
    }).sessions.map((session) => ({
      foregroundCommand: session.foregroundCommand,
      outputActivity: session.outputActivity,
      localPathCapability: session.localPathCapability,
    }))).toEqual([
      {
        foregroundCommand: { phase: 'running', displayName: 'top', revision: 3, updatedAtMs: 4 },
        outputActivity: { phase: 'settled', revision: 5, updatedAtMs: 6 },
        localPathCapability: { workingDir: '/workspace/repo' },
      },
      {
        foregroundCommand: { phase: 'unknown', displayName: '', revision: 0, updatedAtMs: 0 },
        outputActivity: { phase: 'unknown', revision: 0, updatedAtMs: 0 },
        localPathCapability: undefined,
      },
    ]);
  });

  it('downgrades malformed output activity snapshots to unknown', () => {
    const [session] = fromWireTerminalSessionListResponse({
      sessions: [{
        id: 'session-1',
        name: 'repo',
        working_dir: '/workspace/repo',
        created_at_ms: 1,
        last_active_at_ms: 2,
        is_active: true,
        output_activity: {
          phase: 'completed' as any,
          revision: 99,
          updated_at_ms: 100,
        },
      }],
    }).sessions;

    expect(session?.outputActivity).toEqual({ phase: 'unknown', revision: 0, updatedAtMs: 0 });
  });

  it('decodes output activity from a create response', () => {
    expect(fromWireTerminalSessionCreateResponse({
      session: {
        id: 'session-created',
        name: 'agent',
        working_dir: '/workspace/repo',
        created_at_ms: 1,
        last_active_at_ms: 2,
        is_active: true,
        output_activity: {
          phase: 'streaming',
          revision: 3,
          updated_at_ms: 4,
        },
        local_path_capability: { working_dir: '/workspace/repo' },
      },
    }).session.outputActivity).toEqual({
      phase: 'streaming', revision: 3, updatedAtMs: 4,
    });
  });

  it('decodes the product-owned local path target without deriving it from working_dir', () => {
    const decoded = fromWireTerminalSessionCreateResponse({
      session: {
        id: 'session-created',
        name: 'agent',
        working_dir: '/terminal-controlled/path',
        created_at_ms: 1,
        last_active_at_ms: 2,
        is_active: true,
        local_path_capability: { working_dir: '/workspace/repo' },
      },
    }).session;

    expect(decoded.workingDir).toBe('/terminal-controlled/path');
    expect(decoded.localPathCapability).toEqual({ workingDir: '/workspace/repo' });
  });

  it('omits missing and malformed local path capability fields', () => {
    const base = {
      id: 'session-created',
      name: 'agent',
      working_dir: '/workspace/repo',
      created_at_ms: 1,
      last_active_at_ms: 2,
      is_active: true,
    };
    expect(fromWireTerminalSessionCreateResponse({ session: base }).session.localPathCapability).toBeUndefined();
    expect(fromWireTerminalSessionCreateResponse({
      session: { ...base, local_path_capability: { working_dir: '   ' } },
    }).session.localPathCapability).toBeUndefined();
    expect(fromWireTerminalSessionCreateResponse({
      session: { ...base, local_path_capability: { working_dir: 42 as unknown as string } },
    }).session.localPathCapability).toBeUndefined();
    for (const workingDir of [
      'relative/path',
      ' /workspace/repo',
      '/workspace/repo ',
      '/workspace//repo',
      '/workspace/./repo',
      '/workspace/../repo',
      '/workspace/repo/',
      '/workspace\\repo',
      '/workspace/line\nbreak',
    ]) {
      expect(fromWireTerminalSessionCreateResponse({
        session: { ...base, local_path_capability: { working_dir: workingDir } },
      }).session.localPathCapability, workingDir).toBeUndefined();
    }
    expect(fromWireTerminalSessionCreateResponse({
      session: { ...base, local_path_capability: { working_dir: '/' } },
    }).session.localPathCapability).toEqual({ workingDir: '/' });
  });

  it('replaces name-update path capabilities and fails closed for missing or malformed values', () => {
    const base = { session_id: ' session-1 ', new_name: 'repo', working_dir: '/workspace/repo' };
    expect(fromWireTerminalNameUpdateNotify({
      ...base,
      local_path_capability: { working_dir: '/workspace/repo' },
    })).toEqual({
      sessionId: 'session-1',
      newName: 'repo',
      workingDir: '/workspace/repo',
      localPathCapability: { workingDir: '/workspace/repo' },
    });
    for (const localPathCapability of [
      null,
      undefined,
      { working_dir: 'relative/path' },
      { working_dir: '/workspace/repo/' },
      { working_dir: 42 },
      'invalid',
    ]) {
      expect(fromWireTerminalNameUpdateNotify({
        ...base,
        ...(localPathCapability === undefined
          ? {}
          : { local_path_capability: localPathCapability }),
      } as any)?.localPathCapability).toBeNull();
    }
  });

  it('accepts complete command notifications and rejects malformed high revisions', () => {
    expect(fromWireTerminalForegroundCommandUpdateNotify({
      session_id: ' session-1 ',
      foreground_command: {
        phase: 'running',
        display_name: 'top',
        revision: 8,
        updated_at_ms: 9,
      },
    })).toEqual({
      sessionId: 'session-1',
      foregroundCommand: { phase: 'running', displayName: 'top', revision: 8, updatedAtMs: 9 },
    });

    expect(fromWireTerminalForegroundCommandUpdateNotify({
      session_id: 'session-1',
      foreground_command: {
        phase: 'garbage' as any,
        display_name: 'unsafe token',
        revision: 999,
        updated_at_ms: 10,
      },
    })).toBeNull();
    expect(fromWireTerminalForegroundCommandUpdateNotify({
      session_id: 'session-1',
    } as any)).toBeNull();
    expect(fromWireTerminalForegroundCommandUpdateNotify({
      session_id: 'session-1',
      foreground_command: {
        phase: 'running',
        revision: 1_000,
        updated_at_ms: 10,
      },
    } as any)).toBeNull();
    expect(fromWireTerminalForegroundCommandUpdateNotify({
      session_id: 'session-1',
      foreground_command: {
        phase: 'running',
        display_name: 42,
        revision: 1_001,
        updated_at_ms: 10,
      },
    } as any)).toBeNull();
  });

  it('accepts complete output activity notifications and isolates malformed revisions', () => {
    expect(fromWireTerminalOutputActivityUpdateNotify({
      session_id: ' session-1 ',
      output_activity: {
        phase: 'streaming',
        revision: 8,
        updated_at_ms: 9,
      },
    })).toEqual({
      sessionId: 'session-1',
      outputActivity: { phase: 'streaming', revision: 8, updatedAtMs: 9 },
    });

    expect(fromWireTerminalOutputActivityUpdateNotify({
      session_id: 'session-1',
      output_activity: {
        phase: 'completed' as any,
        revision: 999,
        updated_at_ms: 10,
      },
    })).toBeNull();
    expect(fromWireTerminalOutputActivityUpdateNotify({
      session_id: 'session-1',
    } as any)).toBeNull();
    expect(fromWireTerminalOutputActivityUpdateNotify({
      session_id: 'session-1',
      output_activity: {
        phase: 'streaming',
        revision: Number.MAX_SAFE_INTEGER + 1,
        updated_at_ms: 10,
      },
    })).toBeNull();
    expect(fromWireTerminalOutputActivityUpdateNotify({
      session_id: '',
      output_activity: {
        phase: 'settled',
        revision: 2,
        updated_at_ms: 10,
      },
    })).toBeNull();
  });

  it('decodes atomic execution context and revision-fenced semantic work notifications', () => {
    expect(fromWireTerminalExecutionContextUpdateNotify({
      session_id: ' session-1 ',
      execution_context: {
        location: {
          kind: 'remote',
          phase: 'ready',
          label: 'root@host',
          authority: 'host',
          working_directory: '/root/project',
          source: 'osc7',
        },
        application: {
          kind: 'agent_cli',
          identity: 'codex',
          display_name: 'Codex',
        },
        revision: 7,
        updated_at_ms: 8,
      },
    })).toEqual({
      sessionId: 'session-1',
      executionContext: {
        location: {
          kind: 'remote',
          phase: 'ready',
          label: 'root@host',
          authority: 'host',
          workingDirectory: '/root/project',
          source: 'osc7',
        },
        application: { kind: 'agent_cli', identity: 'codex', displayName: 'Codex' },
        revision: 7,
        updatedAtMs: 8,
      },
    });
    expect(fromWireTerminalWorkStateUpdateNotify({
      session_id: 'session-1',
      work_state: {
        phase: 'waiting_user',
        source: 'semantic',
        context_revision: 7,
        foreground_command_revision: 4,
        revision: 9,
        updated_at_ms: 10,
      },
    })).toEqual({
      sessionId: 'session-1',
      workState: {
        phase: 'waiting_user',
        source: 'semantic',
        contextRevision: 7,
        foregroundCommandRevision: 4,
        revision: 9,
        updatedAtMs: 10,
      },
    });
  });

  it('rejects malformed context and work values without accepting their high revisions', () => {
    expect(fromWireTerminalExecutionContextUpdateNotify({
      session_id: 'session-sensitive',
      execution_context: {
        location: {
          kind: 'remote', phase: 'ready', label: 'root@host', authority: 'host', working_directory: '/root', source: 'unsafe' as any,
        },
        application: { kind: 'agent_cli', identity: 'codex', display_name: 'Codex' },
        revision: 999,
        updated_at_ms: 10,
      },
    })).toBeNull();
    expect(fromWireTerminalWorkStateUpdateNotify({
      session_id: 'session-sensitive',
      work_state: {
        phase: 'working',
        source: '' as any,
        context_revision: 7,
        foreground_command_revision: 4,
        revision: 999,
        updated_at_ms: 10,
      },
    })).toBeNull();
  });

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
