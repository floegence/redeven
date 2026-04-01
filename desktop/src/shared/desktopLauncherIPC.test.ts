import { describe, expect, it } from 'vitest';

import { normalizeDesktopLauncherActionRequest } from './desktopLauncherIPC';

describe('desktopLauncherIPC', () => {
  it('normalizes launcher actions and trims remote urls', () => {
    expect(normalizeDesktopLauncherActionRequest({ kind: 'open_this_device' })).toEqual({ kind: 'open_this_device' });
    expect(normalizeDesktopLauncherActionRequest({ kind: 'open_advanced_settings' })).toEqual({ kind: 'open_advanced_settings' });
    expect(normalizeDesktopLauncherActionRequest({ kind: 'return_to_current_device' })).toEqual({ kind: 'return_to_current_device' });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'open_remote_device',
      external_local_ui_url: '  http://192.168.1.11:24000/  ',
    })).toEqual({
      kind: 'open_remote_device',
      external_local_ui_url: 'http://192.168.1.11:24000/',
    });
  });

  it('rejects unsupported launcher actions', () => {
    expect(normalizeDesktopLauncherActionRequest({ kind: 'switch_device' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest(null)).toBeNull();
  });
});
