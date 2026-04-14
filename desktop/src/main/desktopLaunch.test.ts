import { describe, expect, it } from 'vitest';

import {
  BOOTSTRAP_TICKET_ENV_NAME,
  buildDesktopRuntimeArgs,
  buildDesktopRuntimeEnvironment,
  buildDesktopRuntimeLaunchPlan,
  buildDesktopRuntimeSpawnPlan,
  ENV_TOKEN_ENV_NAME,
} from './desktopLaunch';
import {
  testManagedAccess,
  testManagedControlPlaneEnvironment,
  testManagedLocalEnvironment,
} from '../testSupport/desktopTestHelpers';

describe('desktopLaunch', () => {
  it('builds desktop-managed args from persistent local settings', () => {
    const environment = testManagedLocalEnvironment('default', {
      access: testManagedAccess({
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'secret',
        local_ui_password_configured: true,
      }),
    });

    expect(buildDesktopRuntimeArgs(environment)).toEqual([
      'run',
      '--mode',
      'desktop',
      '--desktop-managed',
      '--local-ui-bind',
      '0.0.0.0:24000',
      '--password-stdin',
    ]);
  });

  it('adds one-shot environment bootstrap args and secret env vars to the spawn plan', () => {
    const environment = testManagedControlPlaneEnvironment(
      'https://region.example.invalid',
      'env_123',
      {
        access: testManagedAccess({
          local_ui_bind: '127.0.0.1:0',
          local_ui_password: 'secret',
          local_ui_password_configured: true,
        }),
      },
    );

    const plan = buildDesktopRuntimeSpawnPlan(
      '/tmp/startup.json',
      environment,
      { HOME: '/Users/tester' },
      {
        bootstrap: {
          kind: 'env_token',
          controlplane_url: 'https://region.example.invalid',
          env_id: 'env_123',
          env_token: 'token-123',
        },
      },
    );
    expect(plan.args).toEqual([
      'run',
      '--mode',
      'desktop',
      '--desktop-managed',
      '--local-ui-bind',
      '127.0.0.1:0',
      '--config-path',
      '/Users/tester/.redeven/scopes/controlplane/https__region.example.invalid/env_123/config.json',
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
    expect(plan.state_layout).toEqual(expect.objectContaining({
      scopeKey: 'controlplane/https__region.example.invalid/env_123',
      configPath: '/Users/tester/.redeven/scopes/controlplane/https__region.example.invalid/env_123/config.json',
      stateDir: '/Users/tester/.redeven/scopes/controlplane/https__region.example.invalid/env_123',
      runtimeStateFile: '/Users/tester/.redeven/scopes/controlplane/https__region.example.invalid/env_123/runtime/local-ui.json',
    }));
  });

  it('adds one-shot bootstrap ticket env vars without keeping stale environment tokens', () => {
    const environment = testManagedControlPlaneEnvironment('https://region.example.invalid', 'env_123', {
      access: testManagedAccess({
        local_ui_bind: '127.0.0.1:0',
      }),
    });

    const env = buildDesktopRuntimeEnvironment(environment, {
      HOME: '/Users/tester',
      [ENV_TOKEN_ENV_NAME]: 'old-token',
    }, {
      bootstrap: {
        kind: 'bootstrap_ticket',
        controlplane_url: 'https://region.example.invalid',
        env_id: 'env_123',
        bootstrap_ticket: 'ticket-123',
      },
    });

    expect(env[ENV_TOKEN_ENV_NAME]).toBeUndefined();
    expect(env[BOOTSTRAP_TICKET_ENV_NAME]).toBe('ticket-123');
  });

  it('removes stale secret env vars when the current settings do not use them', () => {
    const environment = testManagedLocalEnvironment('default', {
      access: testManagedAccess({
        local_ui_bind: '127.0.0.1:0',
      }),
    });

    const env = buildDesktopRuntimeEnvironment(environment, {
      HOME: '/Users/tester',
      [ENV_TOKEN_ENV_NAME]: 'old-token',
      [BOOTSTRAP_TICKET_ENV_NAME]: 'old-ticket',
    });

    expect(env[ENV_TOKEN_ENV_NAME]).toBeUndefined();
    expect(env[BOOTSTRAP_TICKET_ENV_NAME]).toBeUndefined();
    expect(env.HOME).toBe('/Users/tester');
  });

  it('builds a launch plan with the local default scope when no bootstrap target is provided', () => {
    const environment = testManagedLocalEnvironment('default', {
      access: testManagedAccess({
        local_ui_bind: '127.0.0.1:0',
      }),
    });

    const plan = buildDesktopRuntimeLaunchPlan(environment, { HOME: '/Users/tester' });
    expect(plan.args).toEqual([
      'run',
      '--mode',
      'desktop',
      '--desktop-managed',
      '--local-ui-bind',
      '127.0.0.1:0',
      '--config-path',
      '/Users/tester/.redeven/scopes/local/default/config.json',
    ]);
    expect(plan.state_layout).toEqual(expect.objectContaining({
      scopeKey: 'local/default',
      configPath: '/Users/tester/.redeven/scopes/local/default/config.json',
      stateDir: '/Users/tester/.redeven/scopes/local/default',
      runtimeStateFile: '/Users/tester/.redeven/scopes/local/default/runtime/local-ui.json',
    }));
  });
});
