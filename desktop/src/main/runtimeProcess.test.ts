import { describe, expect, it } from 'vitest';

import { launchStartedFreshManagedRuntime } from './runtimeProcess';
import { parseStartupReport } from './startup';

describe('runtimeProcess', () => {
  it('parses the startup report payload returned by the bundled runtime', () => {
    expect(parseStartupReport(JSON.stringify({
      local_ui_url: 'http://127.0.0.1:43123/',
      local_ui_urls: ['http://127.0.0.1:43123/'],
      password_required: true,
      effective_run_mode: 'hybrid',
      remote_enabled: true,
      desktop_managed: true,
      state_dir: '/Users/tester/.redeven',
      diagnostics_enabled: true,
      pid: 4242,
    }))).toEqual({
      local_ui_url: 'http://127.0.0.1:43123/',
      local_ui_urls: ['http://127.0.0.1:43123/'],
      password_required: true,
      effective_run_mode: 'hybrid',
      remote_enabled: true,
      desktop_managed: true,
      state_dir: '/Users/tester/.redeven',
      diagnostics_enabled: true,
      pid: 4242,
    });
  });

  it('rejects startup reports without a local ui url', () => {
    expect(() => parseStartupReport('{}')).toThrow('startup report missing local_ui_url');
  });

  it('treats attached launches as not freshly managed even after a spawn attempt', () => {
    expect(launchStartedFreshManagedRuntime({
      kind: 'ready',
      spawned: true,
      managedRuntime: {
        child: null,
        startup: {
          local_ui_url: 'http://127.0.0.1:43123/',
          local_ui_urls: ['http://127.0.0.1:43123/'],
          password_required: true,
          effective_run_mode: 'desktop',
          remote_enabled: true,
          desktop_managed: true,
          pid: 4242,
        },
        reportDir: null,
        reportFile: null,
        attached: true,
        stop: async () => undefined,
      },
    })).toBe(false);

    expect(launchStartedFreshManagedRuntime({
      kind: 'ready',
      spawned: true,
      managedRuntime: {
        child: null,
        startup: {
          local_ui_url: 'http://127.0.0.1:43123/',
          local_ui_urls: ['http://127.0.0.1:43123/'],
          password_required: false,
          effective_run_mode: 'desktop',
          remote_enabled: true,
          desktop_managed: true,
          pid: 4242,
        },
        reportDir: '/tmp/redeven',
        reportFile: '/tmp/redeven/startup.json',
        attached: false,
        stop: async () => undefined,
      },
    })).toBe(true);
  });
});
