import { describe, expect, it, vi } from 'vitest';
import { createFlowerWorkingDirectoryNavigation } from './workingDirectoryNavigation';

describe('Flower working directory host navigation', () => {
  it('requests new components and explicitly centers terminals without serializing a shell command', async () => {
    const openFileBrowserAtPath = vi.fn(async () => undefined);
    const openTerminalInDirectory = vi.fn();
    const navigation = createFlowerWorkingDirectoryNavigation({
      availability: () => ({ browse: { enabled: true }, terminal: { enabled: true } }),
      invalidDirectoryMessage: () => 'Unavailable directory',
      openFileBrowserAtPath,
      openTerminalInDirectory,
    });
    const request = { thread_id: 'thread-b', path: "/workspace/中文 folder's;$HOME" };
    await navigation.openWorkingDirectoryInFileBrowser!(request);
    await navigation.openWorkingDirectoryInTerminal!(request);
    expect(openFileBrowserAtPath).toHaveBeenCalledExactlyOnceWith(request.path, {
      title: "中文 folder's;$HOME", openStrategy: 'create_new',
    });
    expect(openTerminalInDirectory).toHaveBeenCalledExactlyOnceWith(request.path, {
      preferredName: "中文 folder's;$HOME", openStrategy: 'create_new', workbenchAnchor: null,
    });
  });

  it('rechecks permission at execution and rejects invalid paths before dispatch', async () => {
    let enabled = true;
    const openFileBrowserAtPath = vi.fn(async () => undefined);
    const openTerminalInDirectory = vi.fn();
    const navigation = createFlowerWorkingDirectoryNavigation({
      availability: () => ({ browse: { enabled }, terminal: { enabled, reason: 'Permission revoked' } }),
      invalidDirectoryMessage: () => 'Unavailable directory',
      openFileBrowserAtPath, openTerminalInDirectory,
    });
    await expect(navigation.openWorkingDirectoryInFileBrowser!({ thread_id: 'thread', path: 'relative' })).rejects.toThrow('Unavailable directory');
    enabled = false;
    await expect(navigation.openWorkingDirectoryInTerminal!({ thread_id: 'thread', path: '/workspace' })).rejects.toThrow('Permission revoked');
    expect(openFileBrowserAtPath).not.toHaveBeenCalled();
    expect(openTerminalInDirectory).not.toHaveBeenCalled();
  });
});
