import { describe, expect, it } from 'vitest';

import { validateRedevenWireValue } from './validate';

describe('validateRedevenWireValue', () => {
  it('accepts an exact response shape', () => {
    expect(validateRedevenWireValue('wire_fs_list_resp', { entries: [] })).toEqual({ entries: [] });
  });

  it('rejects missing required fields, extra fields, and wrong scalar types', () => {
    expect(() => validateRedevenWireValue('wire_fs_list_resp', {})).toThrow(/entries is required/u);
    expect(() => validateRedevenWireValue('wire_fs_list_resp', { entries: [], extra: true })).toThrow(/extra is not allowed/u);
    expect(() => validateRedevenWireValue('wire_fs_list_resp', {
      entries: [{
        name: 'README.md',
        path: '/README.md',
        is_directory: false,
        size: '12',
        modified_at: 1,
        created_at: 1,
      }],
    })).toThrow(/size must be a finite number/u);
  });

  it('rejects unknown notification fields before a business handler runs', () => {
    expect(() => validateRedevenWireValue('wire_terminal_name_update_notify', {
      session_id: 'terminal-1',
      new_name: 'shell',
      working_dir: '/workspace',
      local_path_capability: null,
      legacy_name: 'ignored-before-0.41',
    })).toThrow(/legacy_name is not allowed/u);
  });

  it('exactly validates nested Git and terminal response DTOs', () => {
    expect(() => validateRedevenWireValue('wire_git_list_workspace_changes_resp', {
      repo_root_path: '/workspace',
      summary: {},
      staged: [{ path: 'README.md', unexpected: true }],
      unstaged: [],
      untracked: [],
      conflicted: [],
    })).toThrow(/unexpected is not allowed/u);

    expect(() => validateRedevenWireValue('wire_terminal_history_resp', {
      snapshotId: 'snapshot-1',
      chunkIndex: 0,
      chunkCount: 1,
      payloadBytes: 3,
      payloadSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      payload: 'AQID',
      revision: 1,
      transportGeneration: 1,
      contentEpoch: 1,
      geometryGeneration: 1,
      cols: 80,
      rows: 24,
      anchor: 'anchor-1',
      firstAvailable: 'first-1',
      lastAvailable: 'last-1',
      screenStart: 'screen-1',
      offset: 0,
      totalRows: 24,
      screenStartOffset: 0,
      hasPrevious: false,
      hasNext: false,
      legacyFrame: {},
    })).toThrow(/legacyFrame is not allowed/u);
  });
});
