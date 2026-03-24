import { describe, expect, it, vi } from 'vitest';
import { canOpenDirectoryPathInTerminal, openDirectoryInTerminal } from './openDirectoryInTerminal';

describe('openDirectoryInTerminal', () => {
  it('accepts only normalized absolute directory paths', () => {
    expect(canOpenDirectoryPathInTerminal('/workspace/demo')).toBe(true);
    expect(canOpenDirectoryPathInTerminal('/workspace/demo/')).toBe(true);
    expect(canOpenDirectoryPathInTerminal('workspace/demo')).toBe(false);
    expect(canOpenDirectoryPathInTerminal('')).toBe(false);
  });

  it('dispatches the normalized path and preferred name to the terminal opener', () => {
    const openTerminal = vi.fn();

    const ok = openDirectoryInTerminal({
      path: '/workspace/demo/',
      preferredName: 'Demo Space',
      openTerminalInDirectory: openTerminal,
    });

    expect(ok).toBe(true);
    expect(openTerminal).toHaveBeenCalledWith('/workspace/demo', { preferredName: 'Demo Space' });
  });

  it('reports invalid directories without dispatching the terminal opener', () => {
    const openTerminal = vi.fn();
    const onInvalidDirectory = vi.fn();

    const ok = openDirectoryInTerminal({
      path: 'workspace/demo',
      openTerminalInDirectory: openTerminal,
      onInvalidDirectory,
    });

    expect(ok).toBe(false);
    expect(onInvalidDirectory).toHaveBeenCalledTimes(1);
    expect(openTerminal).not.toHaveBeenCalled();
  });
});
