import { describe, expect, it } from 'vitest';

import { validateDesktopSettingsDraft } from './desktopPreferences';
import {
  buildDesktopAgentArgs,
  buildDesktopAgentEnvironment,
  buildDesktopAgentSpawnPlan,
  ENV_TOKEN_ENV_NAME,
  LOCAL_UI_PASSWORD_ENV_NAME,
} from './desktopLaunch';

describe('desktopLaunch', () => {
  it('builds desktop-managed args from persistent local settings', () => {
    const preferences = validateDesktopSettingsDraft({
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: 'secret',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    });

    expect(buildDesktopAgentArgs(preferences)).toEqual([
      'run',
      '--mode',
      'desktop',
      '--desktop-managed',
      '--local-ui-bind',
      '0.0.0.0:24000',
      '--password-env',
      LOCAL_UI_PASSWORD_ENV_NAME,
    ]);
  });

  it('adds one-shot bootstrap args and secret env vars to the spawn plan', () => {
    const preferences = validateDesktopSettingsDraft({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: 'secret',
      controlplane_url: 'https://region.example.invalid',
      env_id: 'env_123',
      env_token: 'token-123',
    });

    const plan = buildDesktopAgentSpawnPlan('/tmp/startup.json', preferences, { HOME: '/Users/tester' });
    expect(plan.args).toEqual([
      'run',
      '--mode',
      'desktop',
      '--desktop-managed',
      '--local-ui-bind',
      '127.0.0.1:0',
      '--password-env',
      LOCAL_UI_PASSWORD_ENV_NAME,
      '--controlplane',
      'https://region.example.invalid',
      '--env-id',
      'env_123',
      '--env-token-env',
      ENV_TOKEN_ENV_NAME,
      '--startup-report-file',
      '/tmp/startup.json',
    ]);
    expect(plan.env[LOCAL_UI_PASSWORD_ENV_NAME]).toBe('secret');
    expect(plan.env[ENV_TOKEN_ENV_NAME]).toBe('token-123');
    expect(plan.uses_pending_bootstrap).toBe(true);
  });

  it('removes stale secret env vars when the current settings do not use them', () => {
    const preferences = validateDesktopSettingsDraft({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    });

    const env = buildDesktopAgentEnvironment(preferences, {
      HOME: '/Users/tester',
      [LOCAL_UI_PASSWORD_ENV_NAME]: 'old-password',
      [ENV_TOKEN_ENV_NAME]: 'old-token',
    });

    expect(env[LOCAL_UI_PASSWORD_ENV_NAME]).toBeUndefined();
    expect(env[ENV_TOKEN_ENV_NAME]).toBeUndefined();
    expect(env.HOME).toBe('/Users/tester');
  });
});
