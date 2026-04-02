import { describe, expect, it } from 'vitest';

import {
  normalizeDesktopShellOpenWindowRequest,
  normalizeDesktopShellWindowKind,
} from './desktopShellWindowIPC';

describe('desktopShellWindowIPC', () => {
  it('normalizes supported window kinds', () => {
    expect(normalizeDesktopShellWindowKind(' connect ')).toBe('connection_center');
    expect(normalizeDesktopShellWindowKind('CONNECTION_CENTER')).toBe('connection_center');
    expect(normalizeDesktopShellWindowKind('SETTINGS')).toBe('settings');
    expect(normalizeDesktopShellWindowKind('advanced_settings')).toBe('settings');
  });

  it('normalizes open-window requests', () => {
    expect(normalizeDesktopShellOpenWindowRequest({ kind: ' connect ' })).toEqual({ kind: 'connection_center' });
  });

  it('rejects unsupported window kinds', () => {
    expect(normalizeDesktopShellWindowKind('dashboard')).toBe('');
    expect(normalizeDesktopShellOpenWindowRequest({ kind: 'dashboard' })).toBeNull();
  });
});
