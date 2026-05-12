import { describe, expect, it } from 'vitest';

import {
  BOOTSTRAP_TICKET_ENV_NAME,
  DESKTOP_OWNER_ID_ENV_NAME,
  buildDesktopRuntimeArgs,
  buildDesktopRuntimeEnvironment,
  buildDesktopRuntimeLaunchPlan,
  buildDesktopRuntimeSpawnPlan,
} from './desktopLaunch';
import {
  testLocalAccess,
  testProviderBoundLocalEnvironment,
  testLocalEnvironment,
} from '../testSupport/desktopTestHelpers';

describe('desktopLaunch', () => {
  it('builds desktop-managed args from persistent local settings', () => {
    const environment = testLocalEnvironment({
      access: testLocalAccess({
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

  it('adds one-shot bootstrap ticket args and secret env vars to the spawn plan', () => {
    const environment = testProviderBoundLocalEnvironment(
      'https://region.example.invalid',
      'env_123',
      {
        access: testLocalAccess({
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
        desktopOwnerID: 'desktop-owner-1',
        bootstrap: {
          kind: 'bootstrap_ticket',
          controlplane_url: 'https://region.example.invalid',
          env_id: 'env_123',
          bootstrap_ticket: 'ticket-123',
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
      '--state-root',
      '/Users/tester/.redeven',
      '--password-stdin',
      '--controlplane',
      'https://region.example.invalid',
      '--env-id',
      'env_123',
      '--bootstrap-ticket-env',
      BOOTSTRAP_TICKET_ENV_NAME,
      '--startup-report-file',
      '/tmp/startup.json',
    ]);
    expect(plan.password_stdin).toBe('secret');
    expect(plan.env[BOOTSTRAP_TICKET_ENV_NAME]).toBe('ticket-123');
    expect(plan.env[DESKTOP_OWNER_ID_ENV_NAME]).toBe('desktop-owner-1');
    expect(plan.state_layout).toEqual(expect.objectContaining({
      configPath: '/Users/tester/.redeven/local-environment/config.json',
      stateDir: '/Users/tester/.redeven/local-environment',
      runtimeStateFile: '/Users/tester/.redeven/local-environment/runtime/local-ui.json',
    }));
  });

  it('adds one-shot bootstrap ticket and Desktop owner env vars', () => {
    const environment = testProviderBoundLocalEnvironment('https://region.example.invalid', 'env_123', {
      access: testLocalAccess({
        local_ui_bind: '127.0.0.1:0',
      }),
    });

    const env = buildDesktopRuntimeEnvironment(environment, {
      HOME: '/Users/tester',
    }, {
      bootstrap: {
        kind: 'bootstrap_ticket',
        controlplane_url: 'https://region.example.invalid',
        env_id: 'env_123',
        bootstrap_ticket: 'ticket-123',
      },
      desktopOwnerID: 'desktop-owner-1',
    });

    expect(env[BOOTSTRAP_TICKET_ENV_NAME]).toBe('ticket-123');
    expect(env[DESKTOP_OWNER_ID_ENV_NAME]).toBe('desktop-owner-1');
  });

  it('does not emit provider bootstrap flags without a one-shot ticket', () => {
    const environment = testProviderBoundLocalEnvironment('https://region.example.invalid', 'env_123', {
      access: testLocalAccess({
        local_ui_bind: '127.0.0.1:0',
      }),
    });

    expect(buildDesktopRuntimeArgs(environment, {
      stateRoot: '/Users/tester/.redeven',
    })).toEqual([
      'run',
      '--mode',
      'desktop',
      '--desktop-managed',
      '--local-ui-bind',
      '127.0.0.1:0',
      '--state-root',
      '/Users/tester/.redeven',
    ]);
  });

  it('removes stale bootstrap ticket and Desktop owner env vars when the current settings do not use them', () => {
    const environment = testLocalEnvironment({
      access: testLocalAccess({
        local_ui_bind: '127.0.0.1:0',
      }),
    });

    const env = buildDesktopRuntimeEnvironment(environment, {
      HOME: '/Users/tester',
      [BOOTSTRAP_TICKET_ENV_NAME]: 'old-ticket',
      [DESKTOP_OWNER_ID_ENV_NAME]: 'old-owner',
    });

    expect(env[BOOTSTRAP_TICKET_ENV_NAME]).toBeUndefined();
    expect(env[DESKTOP_OWNER_ID_ENV_NAME]).toBeUndefined();
    expect(env.HOME).toBe('/Users/tester');
  });

  it('builds a launch plan with the Local Environment layout when no bootstrap target is provided', () => {
    const environment = testLocalEnvironment({
      access: testLocalAccess({
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
      '--state-root',
      '/Users/tester/.redeven',
    ]);
    expect(plan.state_layout).toEqual(expect.objectContaining({
      configPath: '/Users/tester/.redeven/local-environment/config.json',
      stateDir: '/Users/tester/.redeven/local-environment',
      runtimeStateFile: '/Users/tester/.redeven/local-environment/runtime/local-ui.json',
    }));
  });
});
