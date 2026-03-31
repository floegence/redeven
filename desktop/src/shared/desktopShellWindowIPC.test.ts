import { describe, expect, it } from 'vitest';

import {
  normalizeDesktopShellOpenWindowRequest,
  normalizeDesktopShellWindowKind,
} from './desktopShellWindowIPC';

describe('desktopShellWindowIPC', () => {
  it('normalizes supported window kinds', () => {
    expect(normalizeDesktopShellWindowKind(' connect ')).toBe('connect');
    expect(normalizeDesktopShellWindowKind('SETTINGS')).toBe('settings');
  });

  it('normalizes open-window requests', () => {
    expect(normalizeDesktopShellOpenWindowRequest({ kind: ' connect ' })).toEqual({ kind: 'connect' });
  });

  it('rejects unsupported window kinds', () => {
    expect(normalizeDesktopShellWindowKind('dashboard')).toBe('');
    expect(normalizeDesktopShellOpenWindowRequest({ kind: 'dashboard' })).toBeNull();
  });
});
