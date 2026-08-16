import { describe, expect, it } from 'vitest';

import {
  DESKTOP_AUTO_START_RUNTIME_ENV_NAME,
  RUNTIME_SECRET_ENV_NAMES,
  buildDesktopRuntimeArgs,
  buildDesktopRuntimeEnvironment,
  buildDesktopRuntimeLaunchPlan,
  buildDesktopRuntimeSpawnPlan,
  desktopAutoStartRuntimeEnabled,
} from './desktopLaunch';
import {
  testLocalAccess,
  testProviderBoundLocalEnvironment,
  testLocalEnvironment,
} from '../testSupport/desktopTestHelpers';

describe('desktopLaunch', () => {
  it('requires an explicit opt-in before Desktop auto-starts the local runtime', () => {
    expect(desktopAutoStartRuntimeEnabled()).toBe(false);
    expect(desktopAutoStartRuntimeEnabled('1')).toBe(true);
    expect(desktopAutoStartRuntimeEnabled('TRUE')).toBe(true);
    expect(desktopAutoStartRuntimeEnabled('off')).toBe(false);
    expect(DESKTOP_AUTO_START_RUNTIME_ENV_NAME).toBe('REDEVEN_DESKTOP_AUTO_START_RUNTIME');
  });

  it('builds desktop-mode args from persistent local settings', () => {
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

  it('still rejects a configured-but-empty password for network access', () => {
    const environment = testLocalEnvironment({
      access: testLocalAccess({
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: '',
        local_ui_password_configured: true,
        plaintext_network_exposure_acknowledgement: { version: 1, bind: '0.0.0.0:24000' },
      }),
    });

    expect(() => buildDesktopRuntimeArgs(environment)).toThrow('requires a configured password');
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
    });

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
      '--presentation',
      'machine',
      '--local-ui-bind',
      '127.0.0.1:0',
      '--state-root',
      '/Users/tester/.redeven',
      '--startup-secrets-stdin',
    ]);
  });

  it('removes every stale runtime secret when unused', () => {
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
    });

    for (const name of RUNTIME_SECRET_ENV_NAMES) {
      expect(env[name]).toBeUndefined();
    }
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

  it('uses the development Local UI bind override without changing saved production settings', () => {
    const environment = testLocalEnvironment({
      access: testLocalAccess({
        local_ui_bind: 'localhost:23998',
      }),
    });

    const plan = buildDesktopRuntimeLaunchPlan(environment, {
      HOME: '/Users/tester',
      REDEVEN_STATE_ROOT: '/tmp/redeven-dev-checkout',
      REDEVEN_DESKTOP_LOCAL_UI_BIND: 'localhost:24147',
    });

    expect(plan.args).toContain('localhost:24147');
    expect(plan.args).not.toContain('localhost:23998');
    expect(plan.state_layout.stateRoot).toBe('/tmp/redeven-dev-checkout');
    expect(environment.local_hosting?.access.local_ui_bind).toBe('localhost:23998');
  });

  it('omits a stale configured-but-empty loopback password from the runtime envelope', () => {
    const environment = testLocalEnvironment({
      access: testLocalAccess({
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        local_ui_password_configured: true,
      }),
    });

    const plan = buildDesktopRuntimeLaunchPlan(environment, { HOME: '/Users/tester' });

    expect(JSON.parse(plan.startup_secrets_stdin)).toEqual({ version: 1 });
  });
});
