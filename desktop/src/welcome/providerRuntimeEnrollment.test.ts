import { describe, expect, it } from 'vitest';

import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import {
  providerRuntimeDirectSetupCandidate,
  providerRuntimeDirectSetupCandidates,
} from './providerRuntimeEnrollment';

function entry(overrides: Partial<DesktopEnvironmentEntry>): DesktopEnvironmentEntry {
  return {
    id: 'entry',
    kind: 'external_local_ui',
    label: 'Entry',
    local_ui_url: '',
    secondary_text: '',
    pinned: false,
    tag: 'Saved',
    category: 'saved',
    window_state: 'closed',
    is_open: false,
    is_opening: false,
    runtime_health: {
      status: 'offline',
      checked_at_unix_ms: 0,
      freshness: 'unknown',
      source: 'external_local_ui_probe',
    },
    runtime_operations: {} as DesktopEnvironmentEntry['runtime_operations'],
    open_session_key: '',
    open_action: 'open',
    can_edit: true,
    can_delete: true,
    created_at_ms: 1,
    last_used_at_ms: 1,
    ...overrides,
  };
}

describe('providerRuntimeDirectSetupCandidates', () => {
  it('offers only explicit direct Runtime targets and preserves their credential boundary', () => {
    const candidates = providerRuntimeDirectSetupCandidates([
      entry({ id: 'provider', kind: 'provider_environment' }),
      entry({ id: 'url', kind: 'external_local_ui' }),
      entry({
        id: 'local-container',
        kind: 'local_environment',
        label: 'Local container',
        secondary_text: 'dev-container',
        managed_runtime_host_access: { kind: 'local_host' },
        managed_runtime_placement: {
          kind: 'container_process',
          container_engine: 'docker',
          container_id: 'container-id',
          container_ref: 'dev-container',
          container_label: 'dev-container',
          runtime_root: '/workspace/.redeven',
          bridge_strategy: 'exec_stream',
        },
      }),
      entry({
        id: 'ssh-host',
        kind: 'ssh_environment',
        label: 'Build host',
        secondary_text: 'alice@build.example:2222',
        managed_runtime_host_access: {
          kind: 'ssh_host',
          ssh: {
            ssh_destination: 'alice@build.example',
            ssh_port: 2222,
            auth_mode: 'key_agent',
            connect_timeout_seconds: 15,
          },
        },
        managed_runtime_placement: {
          kind: 'host_process',
          runtime_root: '/opt/redeven',
        },
      }),
    ], 'provider');

    expect(candidates).toEqual([
      expect.objectContaining({
        environment_id: 'local-container',
        connection_kind: 'local_container',
        host_access: { kind: 'local_host' },
      }),
      expect.objectContaining({
        environment_id: 'ssh-host',
        connection_kind: 'ssh_host',
        host_access: expect.objectContaining({ kind: 'ssh_host' }),
      }),
    ]);
  });

  it('uses an existing Provider association instead of list order', () => {
    const linkedTarget = {
      id: 'ssh:linked' as const,
      kind: 'ssh_environment' as const,
      environment_id: 'ssh-linked',
      label: 'Linked host',
      runtime_key: 'linked',
      runtime_url: '',
      runtime_running: false,
      runtime_openable: false,
      runtime_control_status: {
        state: 'missing' as const,
        reason_code: 'not_started' as const,
        message: 'Not started.',
      },
      provider_connection_state: 'unlinked' as const,
      provider_link_state: 'linked' as const,
      provider_origin: 'https://provider.example',
      provider_id: 'provider-demo',
      env_public_id: 'env-demo',
      can_connect_provider: false,
      can_disconnect_provider: true,
    };
    const entries = [
      entry({
        id: 'provider',
        kind: 'provider_environment',
        provider_origin: 'https://provider.example',
        provider_id: 'provider-demo',
        env_public_id: 'env-demo',
        provider_linked_runtime_summary: {
          runtime_target_id: linkedTarget.id,
          runtime_kind: linkedTarget.kind,
          label: linkedTarget.label,
          provider_connection_state: linkedTarget.provider_connection_state,
        },
      }),
      entry({
        id: 'local-first',
        kind: 'local_environment',
        managed_runtime_host_access: { kind: 'local_host' },
        managed_runtime_placement: { kind: 'host_process', runtime_root: '/tmp/local' },
      }),
      entry({
        id: 'ssh-linked',
        kind: 'ssh_environment',
        provider_runtime_link_target: linkedTarget,
        managed_runtime_host_access: {
          kind: 'ssh_host',
          ssh: {
            ssh_destination: 'dev@example.test',
            ssh_port: null,
            auth_mode: 'key_agent',
            connect_timeout_seconds: null,
          },
        },
        managed_runtime_placement: { kind: 'host_process', runtime_root: '/opt/redeven' },
      }),
    ];

    expect(providerRuntimeDirectSetupCandidate(entries, 'provider')?.environment_id).toBe('ssh-linked');
  });

  it('refuses to select between unrelated candidate connections', () => {
    const entries = [
      entry({ id: 'provider', kind: 'provider_environment' }),
      entry({
        id: 'local-a',
        kind: 'local_environment',
        managed_runtime_host_access: { kind: 'local_host' },
        managed_runtime_placement: { kind: 'host_process', runtime_root: '/tmp/a' },
      }),
      entry({
        id: 'local-b',
        kind: 'local_environment',
        managed_runtime_host_access: { kind: 'local_host' },
        managed_runtime_placement: { kind: 'host_process', runtime_root: '/tmp/b' },
      }),
    ];

    expect(providerRuntimeDirectSetupCandidate(entries, 'provider')).toBeNull();
  });
});
