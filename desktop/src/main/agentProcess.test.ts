import { describe, expect, it } from 'vitest';

import { launchStartedFreshManagedRuntime } from './agentProcess';
import { parseStartupReport } from './startup';

describe('agentProcess', () => {
  it('parses the startup report payload returned by the bundled agent', () => {
    expect(parseStartupReport(JSON.stringify({
      local_ui_url: 'http://127.0.0.1:43123/',
      local_ui_urls: ['http://127.0.0.1:43123/'],
      effective_run_mode: 'hybrid',
      remote_enabled: true,
      desktop_managed: true,
      state_dir: '/Users/tester/.redeven',
      diagnostics_enabled: true,
    }))).toEqual({
      local_ui_url: 'http://127.0.0.1:43123/',
      local_ui_urls: ['http://127.0.0.1:43123/'],
      effective_run_mode: 'hybrid',
      remote_enabled: true,
      desktop_managed: true,
      state_dir: '/Users/tester/.redeven',
      diagnostics_enabled: true,
    });
  });

  it('rejects startup reports without a local ui url', () => {
    expect(() => parseStartupReport('{}')).toThrow('startup report missing local_ui_url');
  });

  it('treats attached launches as not freshly managed even after a spawn attempt', () => {
    expect(launchStartedFreshManagedRuntime({
      kind: 'ready',
      spawned: true,
      managedAgent: {
        child: null,
        startup: {
          local_ui_url: 'http://127.0.0.1:43123/',
          local_ui_urls: ['http://127.0.0.1:43123/'],
          effective_run_mode: 'desktop',
          remote_enabled: true,
          desktop_managed: true,
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
      managedAgent: {
        child: null,
        startup: {
          local_ui_url: 'http://127.0.0.1:43123/',
          local_ui_urls: ['http://127.0.0.1:43123/'],
          effective_run_mode: 'desktop',
          remote_enabled: true,
          desktop_managed: true,
        },
        reportDir: '/tmp/redeven',
        reportFile: '/tmp/redeven/startup.json',
        attached: false,
        stop: async () => undefined,
      },
    })).toBe(true);
  });
});
