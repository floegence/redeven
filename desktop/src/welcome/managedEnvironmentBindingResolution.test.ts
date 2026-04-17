import { describe, expect, it } from 'vitest';

import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import {
  describeManagedEnvironmentBindingResolution,
  resolveManagedEnvironmentBindingResolution,
} from './managedEnvironmentBindingResolution';

function managedEnvironmentEntry(
  overrides: Partial<DesktopEnvironmentEntry> = {},
): DesktopEnvironmentEntry {
  return {
    id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
    kind: 'managed_environment',
    label: 'Demo Sandbox',
    local_ui_url: '',
    secondary_text: 'https://cp.example.invalid · env_demo',
    managed_environment_kind: 'controlplane',
    managed_local_scope_kind: 'controlplane',
    managed_environment_name: '',
    managed_local_ui_bind: 'localhost:23998',
    managed_local_ui_password_configured: false,
    managed_local_owner: 'desktop',
    managed_has_local_hosting: true,
    managed_has_remote_desktop: true,
    managed_preferred_open_route: 'auto',
    default_open_route: 'local_host',
    provider_origin: 'https://cp.example.invalid',
    provider_id: 'redeven_portal',
    env_public_id: 'env_demo',
    pinned: false,
    tag: 'Managed',
    category: 'managed',
    window_state: 'closed',
    is_open: false,
    is_opening: false,
    runtime_health: {
      status: 'offline',
      checked_at_unix_ms: 0,
      source: 'local_runtime_probe',
      offline_reason_code: 'not_started',
      offline_reason: 'Serve the runtime first',
    },
    runtime_control_capability: 'start_stop',
    open_session_key: '',
    open_action_label: 'Open',
    can_edit: true,
    can_delete: true,
    can_save: false,
    last_used_at_ms: 0,
    ...overrides,
  };
}

describe('managedEnvironmentBindingResolution', () => {
  it('reuses an existing provider-bound entry instead of creating a duplicate', () => {
    const resolution = resolveManagedEnvironmentBindingResolution({
      mode: 'create',
      environment_id: 'local:lab',
      use_control_plane_binding: true,
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'redeven_portal',
      env_public_id: 'env_demo',
    }, [
      managedEnvironmentEntry(),
      managedEnvironmentEntry({
        id: 'local:lab',
        provider_origin: '',
        provider_id: '',
        env_public_id: '',
        managed_environment_kind: 'local',
        managed_local_scope_kind: 'local',
        managed_environment_name: 'lab',
        secondary_text: 'localhost:23998',
      }),
    ]);

    expect(resolution).toEqual(expect.objectContaining({
      kind: 'attachable_existing_local_host',
      existing_entry: expect.objectContaining({
        label: 'Demo Sandbox',
      }),
    }));

    expect(describeManagedEnvironmentBindingResolution(resolution, { isCreate: true })).toEqual(expect.objectContaining({
      title: 'Desktop already manages a Local Serve for "Demo Sandbox".',
      save_label: 'Save & Reuse',
      connect_label: 'Save & Connect',
      save_disabled: false,
      connect_disabled: false,
    }));
  });

  it('surfaces an explicit focus result when the reused entry is already open', () => {
    const resolution = resolveManagedEnvironmentBindingResolution({
      mode: 'create',
      environment_id: '',
      use_control_plane_binding: true,
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'redeven_portal',
      env_public_id: 'env_demo',
    }, [
      managedEnvironmentEntry({
        is_open: true,
        open_session_key: 'env:cp:https%3A%2F%2Fcp.example.invalid:env:env_demo:local_host',
        open_action_label: 'Focus',
      }),
    ]);

    expect(resolution?.kind).toBe('focus_existing_open_session');
    expect(describeManagedEnvironmentBindingResolution(resolution, { isCreate: true })).toEqual(expect.objectContaining({
      title: 'This provider Local Serve is already open as "Demo Sandbox".',
      connect_label: 'Save & Focus',
      connect_disabled: false,
    }));
  });

  it('blocks duplicate binding when another host process owns the local environment', () => {
    const resolution = resolveManagedEnvironmentBindingResolution({
      mode: 'create',
      environment_id: '',
      use_control_plane_binding: true,
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'redeven_portal',
      env_public_id: 'env_demo',
    }, [
      managedEnvironmentEntry({
        managed_local_owner: 'agent',
      }),
    ]);

    expect(resolution?.kind).toBe('blocked_by_external_local_owner');
    expect(describeManagedEnvironmentBindingResolution(resolution, { isCreate: true })).toEqual(expect.objectContaining({
      description: 'Desktop cannot take over that Local Serve host from this launcher session.',
      save_disabled: true,
      connect_disabled: true,
      connect_label: 'Blocked',
    }));
  });
});
