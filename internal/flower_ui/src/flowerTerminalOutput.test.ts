import { describe, expect, it } from 'vitest';

import { mergeTerminalVisibleOutput, terminalListeningPlaceholderVisible } from './flowerTerminalOutput';

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

  it('appends live output segments without duplicating repeated chunks', () => {
    expect(mergeTerminalVisibleOutput('tick 1\n', 'tick 2\n', 'running')).toBe('tick 1\ntick 2\n');
    expect(mergeTerminalVisibleOutput('tick 1\ntick 2\n', 'tick 2\n', 'running')).toBe('tick 1\ntick 2\n');
  });
});
