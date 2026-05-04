import { describe, expect, it } from 'vitest';

import { formatBlockedLaunchDiagnostics, parseLaunchReport } from './launchReport';

describe('launchReport', () => {
  it('parses a ready launch report payload', () => {
    expect(parseLaunchReport(JSON.stringify({
      status: 'ready',
      local_ui_url: 'http://127.0.0.1:43123/',
      local_ui_urls: ['http://127.0.0.1:43123/'],
      password_required: true,
      effective_run_mode: 'hybrid',
      remote_enabled: true,
      desktop_managed: true,
      state_dir: '/Users/tester/.redeven',
      diagnostics_enabled: true,
    }))).toEqual({
      status: 'ready',
      startup: {
        local_ui_url: 'http://127.0.0.1:43123/',
        local_ui_urls: ['http://127.0.0.1:43123/'],
        password_required: true,
        effective_run_mode: 'hybrid',
        remote_enabled: true,
        desktop_managed: true,
        state_dir: '/Users/tester/.redeven',
        diagnostics_enabled: true,
      },
    });
  });

  it('parses an attached launch report payload', () => {
    expect(parseLaunchReport(JSON.stringify({
      status: 'attached',
      local_ui_url: 'http://127.0.0.1:43123/',
      local_ui_urls: ['http://127.0.0.1:43123/'],
      password_required: false,
      effective_run_mode: 'local',
      remote_enabled: false,
      desktop_managed: false,
      state_dir: '/Users/tester/.redeven',
      diagnostics_enabled: false,
    }))).toEqual({
      status: 'attached',
      startup: {
        local_ui_url: 'http://127.0.0.1:43123/',
        local_ui_urls: ['http://127.0.0.1:43123/'],
        password_required: false,
        effective_run_mode: 'local',
        remote_enabled: false,
        desktop_managed: false,
        state_dir: '/Users/tester/.redeven',
        diagnostics_enabled: false,
      },
    });
  });

  it('parses a blocked launch report payload', () => {
    expect(parseLaunchReport(JSON.stringify({
      status: 'blocked',
      code: 'state_dir_locked',
      message: 'Another Redeven runtime instance is already using this state directory.',
      lock_owner: {
        pid: 42,
        mode: 'remote',
        local_ui_enabled: false,
      },
      diagnostics: {
        lock_path: '/Users/tester/.redeven/agent.lock',
        state_dir: '/Users/tester/.redeven',
        config_path: '/Users/tester/.redeven/config.json',
        command: 'redeven run',
      },
    }))).toEqual({
      status: 'blocked',
      code: 'state_dir_locked',
      message: 'Another Redeven runtime instance is already using this state directory.',
      lock_owner: {
        pid: 42,
        mode: 'remote',
        local_ui_enabled: false,
        desktop_managed: undefined,
        config_path: undefined,
        state_dir: undefined,
        runtime_state_path: undefined,
      },
      diagnostics: {
        lock_path: '/Users/tester/.redeven/agent.lock',
        state_dir: '/Users/tester/.redeven',
        runtime_state_path: undefined,
        target_url: undefined,
        config_path: '/Users/tester/.redeven/config.json',
        command: 'redeven run',
      },
    });
  });

  it('formats blocked diagnostics for clipboard export', () => {
    const diagnostics = formatBlockedLaunchDiagnostics({
      status: 'blocked',
      code: 'state_dir_locked',
      message: 'blocked',
      lock_owner: {
        pid: 42,
        mode: 'remote',
        local_ui_enabled: false,
      },
      diagnostics: {
        state_dir: '/Users/tester/.redeven',
        lock_path: '/Users/tester/.redeven/agent.lock',
        config_path: '/Users/tester/.redeven/config.json',
        command: 'redeven run',
        target_url: 'http://192.168.1.11:24000/',
      },
    });
    expect(diagnostics).toContain('code: state_dir_locked');
    expect(diagnostics).toContain('lock owner mode: remote');
    expect(diagnostics).toContain('state dir: /Users/tester/.redeven');
    expect(diagnostics).toContain('config path: /Users/tester/.redeven/config.json');
    expect(diagnostics).toContain('command: redeven run');
    expect(diagnostics).toContain('target url: http://192.168.1.11:24000/');
  });
});
