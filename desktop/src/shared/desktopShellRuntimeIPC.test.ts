import { describe, expect, it } from 'vitest';

import {
  normalizeDesktopShellRuntimeAction,
  normalizeDesktopShellRuntimeActionRequest,
  normalizeDesktopShellRuntimeActionResponse,
} from './desktopShellRuntimeIPC';

describe('desktopShellRuntimeIPC', () => {
  it('normalizes supported runtime actions', () => {
    expect(normalizeDesktopShellRuntimeAction(' restart ')).toBe('restart_managed_runtime');
    expect(normalizeDesktopShellRuntimeAction('RESTART_RUNTIME')).toBe('restart_managed_runtime');
    expect(normalizeDesktopShellRuntimeAction('restart_managed_runtime')).toBe('restart_managed_runtime');
  });

  it('normalizes action requests and responses', () => {
    expect(normalizeDesktopShellRuntimeActionRequest({ action: 'restart' })).toEqual({
      action: 'restart_managed_runtime',
    });
    expect(normalizeDesktopShellRuntimeActionResponse({ ok: true, started: true, message: 'done' })).toEqual({
      ok: true,
      started: true,
      message: 'done',
    });
  });

  it('rejects unsupported actions', () => {
    expect(normalizeDesktopShellRuntimeAction('open_settings')).toBe('');
    expect(normalizeDesktopShellRuntimeActionRequest({ action: 'open_settings' })).toBeNull();
    expect(normalizeDesktopShellRuntimeActionResponse(null)).toEqual({
      ok: false,
      started: false,
      message: 'Desktop runtime action failed.',
    });
  });
});
