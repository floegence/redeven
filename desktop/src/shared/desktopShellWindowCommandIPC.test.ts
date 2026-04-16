import { describe, expect, it } from 'vitest';

import {
  normalizeDesktopShellWindowCommand,
  normalizeDesktopShellWindowCommandRequest,
  normalizeDesktopShellWindowCommandResponse,
  normalizeDesktopShellWindowState,
} from './desktopShellWindowCommandIPC';

describe('desktopShellWindowCommandIPC', () => {
  it('normalizes supported window commands', () => {
    expect(normalizeDesktopShellWindowCommand(' minimize_window ')).toBe('minimize');
    expect(normalizeDesktopShellWindowCommand('MAXIMIZE')).toBe('toggle_maximize');
    expect(normalizeDesktopShellWindowCommand('toggle_fullscreen')).toBe('toggle_full_screen');
    expect(normalizeDesktopShellWindowCommand(' close_window ')).toBe('close');
  });

  it('normalizes valid command requests', () => {
    expect(normalizeDesktopShellWindowCommandRequest({ command: 'maximize' })).toEqual({
      command: 'toggle_maximize',
    });
  });

  it('rejects unsupported commands', () => {
    expect(normalizeDesktopShellWindowCommand('launch')).toBe('');
    expect(normalizeDesktopShellWindowCommandRequest({ command: 'launch' })).toBeNull();
  });

  it('normalizes window state payloads', () => {
    expect(normalizeDesktopShellWindowState({
      minimized: true,
      maximized: false,
      full_screen: true,
      minimizable: true,
      maximizable: true,
      full_screenable: false,
      closable: true,
    })).toEqual({
      minimized: true,
      maximized: false,
      full_screen: true,
      minimizable: true,
      maximizable: true,
      full_screenable: false,
      closable: true,
    });
  });

  it('normalizes command responses', () => {
    expect(normalizeDesktopShellWindowCommandResponse({
      ok: true,
      performed: true,
      state: {
        minimized: false,
        maximized: true,
        full_screen: false,
        minimizable: true,
        maximizable: true,
        full_screenable: true,
        closable: true,
      },
      message: ' updated ',
    })).toEqual({
      ok: true,
      performed: true,
      state: {
        minimized: false,
        maximized: true,
        full_screen: false,
        minimizable: true,
        maximizable: true,
        full_screenable: true,
        closable: true,
      },
      message: 'updated',
    });
  });
});
