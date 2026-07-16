import { describe, expect, it } from 'vitest';

import {
  DESKTOP_OWNER_ID_ENV_NAME,
  RUNTIME_SECRET_ENV_NAMES,
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
        plaintext_network_exposure_acknowledgement: { version: 1, bind: '0.0.0.0:24000' },
      }),
    });

    expect(buildDesktopRuntimeArgs(environment)).toEqual([
      'run',
      '--mode',
      'desktop',
      '--desktop-managed',
      '--presentation',
      'machine',
      '--local-ui-bind',
      '0.0.0.0:24000',
      '--acknowledge-plaintext-network-exposure',
      '--startup-secrets-stdin',
    ]);
  });

  it('blocks a saved network bind until its exact canonical bind is reviewed', () => {
    const missingReview = testLocalEnvironment({
      access: testLocalAccess({
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'secret',
        local_ui_password_configured: true,
      }),
    });
    expect(() => buildDesktopRuntimeArgs(missingReview)).toThrow('Review network exposure');

    const staleReview = testLocalEnvironment({
      access: testLocalAccess({
        local_ui_bind: '0.0.0.0:24001',
        local_ui_password: 'secret',
        local_ui_password_configured: true,
        plaintext_network_exposure_acknowledgement: { version: 1, bind: '0.0.0.0:24000' },
      }),
    });
    expect(() => buildDesktopRuntimeArgs(staleReview)).toThrow('Review network exposure');
  });

  it('adds one-shot bootstrap metadata and a private stdin envelope to the spawn plan', () => {
    const environment = testProviderBoundLocalEnvironment(
      'https://redeven.test',
      'env_123',
      {
        accessPointOrigin: 'https://dev.redeven.test',
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
          provider_origin: 'https://redeven.test',
          controlplane_url: 'https://dev.redeven.test',
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
      '--presentation',
      'machine',
      '--local-ui-bind',
      '127.0.0.1:0',
      '--state-root',
      '/Users/tester/.redeven',
      '--startup-secrets-stdin',
      '--provider-origin',
      'https://redeven.test',
      '--controlplane',
      'https://dev.redeven.test',
      '--env-id',
      'env_123',
      '--startup-report-file',
      '/tmp/startup.json',
    ]);
    expect(JSON.parse(plan.startup_secrets_stdin)).toEqual({
      version: 1,
      local_ui_password: 'secret',
      bootstrap_ticket: 'ticket-123',
    });
    for (const name of RUNTIME_SECRET_ENV_NAMES) {
      expect(plan.env[name]).toBeUndefined();
    }
    expect(plan.env[DESKTOP_OWNER_ID_ENV_NAME]).toBe('desktop-owner-1');
    expect(plan.state_layout).toEqual(expect.objectContaining({
      configPath: '/Users/tester/.redeven/local-environment/config.json',
      stateDir: '/Users/tester/.redeven/local-environment',
      runtimeControlSocket: '/Users/tester/.redeven/local-environment/runtime/control.sock',
    }));
  });

  it('keeps only non-secret Desktop metadata in the runtime environment', () => {
    const environment = testProviderBoundLocalEnvironment('https://redeven.test', 'env_123', {
      accessPointOrigin: 'https://dev.redeven.test',
      access: testLocalAccess({
        local_ui_bind: '127.0.0.1:0',
      }),
    });

    const env = buildDesktopRuntimeEnvironment(environment, {
      HOME: '/Users/tester',
    }, {
      desktopOwnerID: 'desktop-owner-1',
    });

    expect(env[DESKTOP_OWNER_ID_ENV_NAME]).toBe('desktop-owner-1');
    for (const name of RUNTIME_SECRET_ENV_NAMES) {
      expect(env[name]).toBeUndefined();
    }
  });

  it('does not emit provider bootstrap flags without a one-shot ticket', () => {
    const environment = testProviderBoundLocalEnvironment('https://redeven.test', 'env_123', {
      accessPointOrigin: 'https://dev.redeven.test',
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
      '--presentation',
      'machine',
      '--local-ui-bind',
      '127.0.0.1:0',
      '--state-root',
      '/Users/tester/.redeven',
      '--startup-secrets-stdin',
    ]);
  });

  it('removes every stale runtime secret and Desktop owner env vars when unused', () => {
    const environment = testLocalEnvironment({
      access: testLocalAccess({
        local_ui_bind: '127.0.0.1:0',
      }),
    });

    const env = buildDesktopRuntimeEnvironment(environment, {
      HOME: '/Users/tester',
      REDEVEN_LOCAL_UI_PASSWORD: 'old-password',
      REDEVEN_BOOTSTRAP_TICKET: 'old-ticket',
      REDEVEN_DESKTOP_BOOTSTRAP_TICKET: 'legacy-ticket',
      [DESKTOP_OWNER_ID_ENV_NAME]: 'old-owner',
    });

    for (const name of RUNTIME_SECRET_ENV_NAMES) {
      expect(env[name]).toBeUndefined();
    }
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
      '--presentation',
      'machine',
      '--local-ui-bind',
      '127.0.0.1:0',
      '--state-root',
      '/Users/tester/.redeven',
      '--startup-secrets-stdin',
    ]);
    expect(JSON.parse(plan.startup_secrets_stdin)).toEqual({ version: 1 });
    expect(plan.state_layout).toEqual(expect.objectContaining({
      configPath: '/Users/tester/.redeven/local-environment/config.json',
      stateDir: '/Users/tester/.redeven/local-environment',
      runtimeControlSocket: '/Users/tester/.redeven/local-environment/runtime/control.sock',
    }));
  });
});
