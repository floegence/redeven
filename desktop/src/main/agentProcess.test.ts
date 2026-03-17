import { describe, expect, it } from 'vitest';

import { buildManagedAgentArgs, parseStartupReport } from './agentProcess';

describe('agentProcess', () => {
  it('builds the desktop-managed agent startup arguments', () => {
    expect(buildManagedAgentArgs('/tmp/startup.json')).toEqual([
      'run',
      '--mode',
      'desktop',
      '--desktop-managed',
      '--local-ui-bind',
      '127.0.0.1:0',
      '--startup-report-file',
      '/tmp/startup.json',
    ]);
  });

  it('parses the startup report payload returned by the bundled agent', () => {
    expect(parseStartupReport(JSON.stringify({
      local_ui_url: 'http://127.0.0.1:43123/',
      local_ui_urls: ['http://127.0.0.1:43123/'],
      effective_run_mode: 'hybrid',
      remote_enabled: true,
      desktop_managed: true,
    }))).toEqual({
      local_ui_url: 'http://127.0.0.1:43123/',
      local_ui_urls: ['http://127.0.0.1:43123/'],
      effective_run_mode: 'hybrid',
      remote_enabled: true,
      desktop_managed: true,
    });
  });

  it('rejects startup reports without a local ui url', () => {
    expect(() => parseStartupReport('{}')).toThrow('startup report missing local_ui_url');
  });
});
