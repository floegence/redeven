import { describe, expect, it } from 'vitest';

import {
  createTerminalVisibleOutputStore,
  mergeTerminalVisibleOutput,
  terminalListeningPlaceholderVisible,
  terminalVisibleOutputIdentityKey,
} from './flowerTerminalOutput';

describe('terminal visible output', () => {
  it('keeps previous output when a running poll returns no content', () => {
    expect(mergeTerminalVisibleOutput('tick 1\n', '', 'running')).toBe('tick 1\n');
    expect(terminalListeningPlaceholderVisible('tick 1\n', 'running')).toBe(false);
  });

  it('shows the listening placeholder only before any running output exists', () => {
    expect(mergeTerminalVisibleOutput('', '', 'running')).toBe('');
    expect(terminalListeningPlaceholderVisible('', 'running')).toBe(true);
    expect(terminalListeningPlaceholderVisible('', 'success')).toBe(false);
  });

  it('keeps visible output when later terminal frames are empty', () => {
    const store = createTerminalVisibleOutputStore();
    const identity = {
      surface_scope: 'test',
      run_id: 'run_1',
      turn_id: 'msg_1',
      message_id: 'msg_1',
      block_index: 0,
      item_id: 'tool:call_1',
      tool_id: 'call_1',
      command: 'npm test',
    };

    expect(store.merge(identity, '', 'tick 1\n', 'running')).toBe('tick 1\n');
    expect(store.merge(identity, '', '', 'running')).toBe('tick 1\n');
    expect(store.merge(identity, '', '', 'success')).toBe('tick 1\n');
    expect(terminalListeningPlaceholderVisible(store.get(identity), 'running')).toBe(false);
  });

  it('does not change the primary identity key when the process id arrives later', () => {
    const base = {
      surface_scope: 'test',
      run_id: 'run_1',
      message_id: 'msg_1',
      block_index: 0,
      item_id: 'tool:call_1',
      tool_id: 'call_1',
      command: 'npm test',
    };

    expect(terminalVisibleOutputIdentityKey(base)).toBe(
      terminalVisibleOutputIdentityKey({ ...base, process_id: 'tp_1' }),
    );
  });

  it('appends live output segments without duplicating repeated chunks', () => {
    expect(mergeTerminalVisibleOutput('tick 1\n', 'tick 2\n', 'running')).toBe('tick 1\ntick 2\n');
    expect(mergeTerminalVisibleOutput('tick 1\ntick 2\n', 'tick 2\n', 'running')).toBe('tick 1\ntick 2\n');
  });
});
