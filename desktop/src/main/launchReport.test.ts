import { describe, expect, it } from 'vitest';

import { formatBlockedLaunchDiagnostics, parseLaunchReport } from './launchReport';

describe('launchReport', () => {
  it('parses a ready launch report payload', () => {
    expect(parseLaunchReport(JSON.stringify({
      status: 'ready',
      local_ui_url: 'http://127.0.0.1:43123/',
      local_ui_urls: ['http://127.0.0.1:43123/'],
      local_ui_bridge_url: 'http://127.0.0.1:43124/',
      password_required: true,
      effective_run_mode: 'hybrid',
      remote_enabled: true,
      desktop_managed: true,
      started_at_unix_ms: 1778751234567,
      state_dir: '/Users/tester/.redeven',
      diagnostics_enabled: true,
    }))).toEqual({
      status: 'ready',
      startup: {
        local_ui_url: 'http://127.0.0.1:43123/',
        local_ui_urls: ['http://127.0.0.1:43123/'],
        local_ui_bridge_url: 'http://127.0.0.1:43124/',
        password_required: true,
        effective_run_mode: 'hybrid',
        remote_enabled: true,
        desktop_managed: true,
        started_at_unix_ms: 1778751234567,
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
      local_ui_bridge_url: 'http://127.0.0.1:43124/',
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
        local_ui_bridge_url: 'http://127.0.0.1:43124/',
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
        lock_path: '/Users/tester/.redeven/local-environment/agent.lock',
        state_dir: '/Users/tester/.redeven/local-environment',
        config_path: '/Users/tester/.redeven/local-environment/config.json',
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
        state_root: undefined,
        state_dir: undefined,
        runtime_control_socket_path: undefined,
      },
      diagnostics: {
        lock_path: '/Users/tester/.redeven/local-environment/agent.lock',
        state_dir: '/Users/tester/.redeven/local-environment',
        runtime_control_socket_path: undefined,
        attach_state: undefined,
        failure_code: undefined,
        lock_pid: undefined,
        pid_alive: undefined,
        socket_reachable: undefined,
        target_url: undefined,
        config_path: '/Users/tester/.redeven/local-environment/config.json',
        command: 'redeven run',
      },
    });
  });

  it('rejects an invalid trusted bridge URL when present', () => {
    expect(() => parseLaunchReport(JSON.stringify({
      status: 'ready',
      local_ui_url: 'http://100.126.191.114:23998/',
      local_ui_urls: ['http://100.126.191.114:23998/'],
      local_ui_bridge_url: 'http://100.126.191.114:43124/',
    }))).toThrow(/loopback/iu);
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
        state_dir: '/Users/tester/.redeven/local-environment',
        lock_path: '/Users/tester/.redeven/local-environment/agent.lock',
        config_path: '/Users/tester/.redeven/local-environment/config.json',
        command: 'redeven run',
        target_url: 'http://192.168.1.11:24000/',
      },
    });
    expect(diagnostics).toContain('code: state_dir_locked');
    expect(diagnostics).toContain('lock owner mode: remote');
    expect(diagnostics).toContain('state dir: /Users/tester/.redeven/local-environment');
    expect(diagnostics).toContain('config path: /Users/tester/.redeven/local-environment/config.json');
    expect(diagnostics).toContain('command: redeven run');
    expect(diagnostics).toContain('target url: http://192.168.1.11:24000/');
  });

  it('strictly parses a plugin state recovery proposal', () => {
    const digest = 'a'.repeat(64);
    expect(parseLaunchReport(JSON.stringify({
      status: 'blocked',
      code: 'plugin_state_recovery_required',
      message: 'Plugin state recovery requires explicit review.',
      plugin_state_recovery: {
        plan_sha256: digest,
        root_identity_sha256: 'b'.repeat(64),
        source_snapshot_sha256: 'c'.repeat(64),
        source_entry_count: 96,
        source_bytes: 1132957,
        has_retained_quarantine: true,
        has_source_recovery_journal: false,
      },
    }))).toMatchObject({
      status: 'blocked',
      code: 'plugin_state_recovery_required',
      plugin_state_recovery: {
        plan_sha256: digest,
        source_entry_count: 96,
      },
    });
  });

  it.each([
    undefined,
    { plan_sha256: 'A'.repeat(64), root_identity_sha256: 'b'.repeat(64), source_snapshot_sha256: 'c'.repeat(64), source_entry_count: 1, source_bytes: 0, has_retained_quarantine: false, has_source_recovery_journal: false },
    { plan_sha256: 'a'.repeat(64), root_identity_sha256: 'b'.repeat(64), source_snapshot_sha256: 'c'.repeat(64), source_entry_count: 0, source_bytes: 0, has_retained_quarantine: false, has_source_recovery_journal: false },
    { plan_sha256: 'a'.repeat(64), root_identity_sha256: 'b'.repeat(64), source_snapshot_sha256: 'c'.repeat(64), source_entry_count: 1, source_bytes: 0, has_retained_quarantine: false, has_source_recovery_journal: false, archive_path: '/secret' },
  ])('rejects malformed plugin state recovery proposal %#', (pluginStateRecovery) => {
    expect(() => parseLaunchReport(JSON.stringify({
      status: 'blocked',
      code: 'plugin_state_recovery_required',
      message: 'review required',
      ...(pluginStateRecovery === undefined ? {} : { plugin_state_recovery: pluginStateRecovery }),
    }))).toThrow(/plugin_state_recovery/iu);
  });
});
