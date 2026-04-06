import { describe, expect, it } from 'vitest';

import { validateDesktopSettingsDraft } from './desktopPreferences';
import {
  buildDesktopAgentArgs,
  buildDesktopAgentLaunchPlan,
  buildDesktopAgentEnvironment,
  buildDesktopAgentSpawnPlan,
  ENV_TOKEN_ENV_NAME,
} from './desktopLaunch';

describe('desktopLaunch', () => {
  it('builds desktop-managed args from persistent local settings', () => {
    const preferences = validateDesktopSettingsDraft({
      local_ui_bind: '0.0.0.0:24000',
      local_ui_password: 'secret',
      local_ui_password_mode: 'replace',
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
      '--password-stdin',
    ]);
  });

  it('adds one-shot bootstrap args and secret env vars to the spawn plan', () => {
    const preferences = validateDesktopSettingsDraft({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: 'secret',
      local_ui_password_mode: 'replace',
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
      '--config-path',
      '/Users/tester/.redeven/envs/env_123/config.json',
      '--password-stdin',
      '--controlplane',
      'https://region.example.invalid',
      '--env-id',
      'env_123',
      '--env-token-env',
      ENV_TOKEN_ENV_NAME,
      '--startup-report-file',
      '/tmp/startup.json',
    ]);
    expect(plan.password_stdin).toBe('secret');
    expect(plan.env[ENV_TOKEN_ENV_NAME]).toBe('token-123');
    expect(plan.uses_pending_bootstrap).toBe(true);
    expect(plan.state_layout).toEqual({
      configPath: '/Users/tester/.redeven/envs/env_123/config.json',
      stateDir: '/Users/tester/.redeven/envs/env_123',
      runtimeStateFile: '/Users/tester/.redeven/envs/env_123/runtime/local-ui.json',
    });
  });

  it('removes stale secret env vars when the current settings do not use them', () => {
    const preferences = validateDesktopSettingsDraft({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      local_ui_password_mode: 'replace',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    });

    const env = buildDesktopAgentEnvironment(preferences, {
      HOME: '/Users/tester',
      [ENV_TOKEN_ENV_NAME]: 'old-token',
    });

    expect(env[ENV_TOKEN_ENV_NAME]).toBeUndefined();
    expect(env.HOME).toBe('/Users/tester');
  });

  it('builds a launch plan with the global managed state path when no bootstrap target is pending', () => {
    const preferences = validateDesktopSettingsDraft({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      local_ui_password_mode: 'replace',
      controlplane_url: '',
      env_id: '',
      env_token: '',
    });

    const plan = buildDesktopAgentLaunchPlan(preferences, { HOME: '/Users/tester' });
    expect(plan.args).toEqual([
      'run',
      '--mode',
      'desktop',
      '--desktop-managed',
      '--local-ui-bind',
      '127.0.0.1:0',
      '--config-path',
      '/Users/tester/.redeven/config.json',
    ]);
    expect(plan.state_layout).toEqual({
      configPath: '/Users/tester/.redeven/config.json',
      stateDir: '/Users/tester/.redeven',
      runtimeStateFile: '/Users/tester/.redeven/runtime/local-ui.json',
    });
  });
});
