import { describe, expect, it } from 'vitest';

import { normalizeDesktopLauncherActionRequest } from './desktopLauncherIPC';

describe('desktopLauncherIPC', () => {
  it('normalizes launcher actions and trims Environment inputs', () => {
    expect(normalizeDesktopLauncherActionRequest({ kind: 'open_this_device' })).toEqual({ kind: 'open_this_device' });
    expect(normalizeDesktopLauncherActionRequest({ kind: 'return_to_current_device' })).toEqual({ kind: 'return_to_current_device' });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'open_remote_device',
      external_local_ui_url: '  http://192.168.1.11:24000/  ',
    })).toEqual({
      kind: 'open_remote_device',
      external_local_ui_url: 'http://192.168.1.11:24000/',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'upsert_saved_environment',
      environment_id: ' env-1 ',
      label: ' Work laptop ',
      external_local_ui_url: ' http://192.168.1.11:24000/ ',
    })).toEqual({
      kind: 'upsert_saved_environment',
      environment_id: 'env-1',
      label: 'Work laptop',
      external_local_ui_url: 'http://192.168.1.11:24000/',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'delete_saved_environment',
      environment_id: ' env-1 ',
    })).toEqual({
      kind: 'delete_saved_environment',
      environment_id: 'env-1',
    });
  });

  it('rejects unsupported or incomplete launcher actions', () => {
    expect(normalizeDesktopLauncherActionRequest({ kind: 'open_advanced_settings' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'delete_saved_environment', environment_id: '   ' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest(null)).toBeNull();
  });
});
