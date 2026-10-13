import { expect, it } from 'vitest';
import { buildDesktopWelcomeSnapshot } from './desktopWelcomeState';
import { mixedEnvironmentFixture } from '../testSupport/mixedEnvironmentFixture';
import { testDesktopPreferences } from '../testSupport/desktopTestHelpers';
import { resolveDesktopPlatformCapabilities } from '../shared/desktopPlatformCapabilities';
import { desktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';
import { desktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import { normalizeDesktopCloudEnvironmentRuntimeHealth } from '../shared/cloud';
import type { DesktopRuntimePlatform } from '../shared/desktopRuntimePlatform';
import { buildExternalLocalUIDesktopTarget } from './desktopTarget';

it.each([['darwin', 'macos'], ['linux', 'linux']] as const)('uses native local capabilities on %s', (host, expected) => {
  const { inputs } = mixedEnvironmentFixture();
  const snapshot = buildDesktopWelcomeSnapshot({ ...inputs, platformCapabilities: resolveDesktopPlatformCapabilities(host) });
  expect(snapshot.environments.find(entry => entry.kind === 'local_environment')?.runtime_platform).toBe(expected);
  expect(snapshot.environments.filter(entry => entry.kind === 'ssh_environment').every(entry => !entry.runtime_platform)).toBe(true);
});

it('uses Linux for WSL independently of the Desktop OS and report aliases', () => {
  const { inputs } = mixedEnvironmentFixture({ linkKind: 'wsl_environment' });
  const presences = Object.fromEntries(Object.entries(inputs.managedRuntimePresenceByTargetID)
    .map(([key, value]) => [key, { ...value, runtime_platform: 'windows' as const, runtime_linux_distribution: 'ubuntu' }]));
  const snapshot = buildDesktopWelcomeSnapshot({ ...inputs, managedRuntimePresenceByTargetID: presences });
  expect(snapshot.environments.find(entry => entry.kind === 'wsl_environment')?.runtime_platform).toBe('linux');
  expect(snapshot.environments.find(entry => entry.kind === 'wsl_environment')?.runtime_linux_distribution).toBeUndefined();
});

it.each(['ssh', 'local_container', 'ssh_container'] as const)('uses reported OS for %s and keeps older reports compatible', kind => {
  const { inputs, targets } = mixedEnvironmentFixture({ linkKind: 'ssh_environment' });
  const original = targets[0];
  const host_access = kind === 'local_container' ? { kind: 'local_host' as const } : original.host_access;
  const placement = kind === 'ssh' ? original.placement : { kind: 'container_process' as const,
    container_engine: 'docker' as const, container_id: 'os-test', container_ref: 'os-test',
    container_label: 'OS test', bridge_strategy: 'exec_stream' as const, runtime_root: '/runtime' };
  const id = desktopRuntimeTargetID(host_access, placement);
  const target = { ...original, id, host_access, placement };
  const source = Object.values(inputs.managedRuntimePresenceByTargetID).find(presence => presence.environment_id === original.id)!;
  const presence = { ...source, environment_id: id, placement_target_id: id, host_access, placement };
  const targetID = desktopCloudRuntimeLinkTargetID(kind === 'local_container' ? 'local_environment' : 'ssh_environment', id);
  for (const runtime_platform of ['macos', 'linux', 'windows', undefined] as const) {
    const snapshot = buildDesktopWelcomeSnapshot({ ...inputs,
      preferences: { ...inputs.preferences, saved_runtime_targets: [target] },
      managedRuntimePresenceByTargetID: { [targetID]: { ...presence, runtime_platform, runtime_linux_distribution: 'ubuntu' } },
    });
    const entry = snapshot.environments.find(entry => entry.id === id)!;
    expect(entry.runtime_platform).toBe(runtime_platform);
    expect(entry.runtime_linux_distribution).toBe(runtime_platform === 'linux' ? 'ubuntu' : undefined);
    expect(entry.runtime_health.status).toBe('online');
  }
  // Cached health remains authoritative when there is no live placement Presence.
  const snapshot = buildDesktopWelcomeSnapshot({ ...inputs,
    preferences: { ...inputs.preferences, saved_runtime_targets: [target] }, managedRuntimePresenceByTargetID: {},
    savedRuntimeTargetHealth: { [id]: { status: 'online', source: 'local_runtime_probe', checked_at_unix_ms: 1, runtime_platform: 'windows' } },
  });
  expect(snapshot.environments.find(entry => entry.id === id)?.runtime_platform).toBe('windows');
});

it.each(['linux', undefined] as const)('uses URL health platform %s rather than the hostname or Desktop', runtime_platform => {
  const preferences = testDesktopPreferences({ saved_environments: [{ id: 'external', label: 'windows.example',
    local_ui_url: 'http://windows.example:23998/', pinned: false, created_at_ms: 1, last_used_at_ms: 0 }] });
  const snapshot = buildDesktopWelcomeSnapshot({ preferences,
    savedExternalRuntimeHealth: { external: { status: 'online', source: 'external_local_ui_probe', checked_at_unix_ms: 1, runtime_platform, runtime_linux_distribution: 'fedora' } },
  });
  expect(snapshot.environments.find(entry => entry.id === 'external')?.runtime_platform).toBe(runtime_platform);
  expect(snapshot.environments.find(entry => entry.id === 'external')?.runtime_linux_distribution).toBe(runtime_platform === 'linux' ? 'fedora' : undefined);
});

it('keeps a saved URL health observation when an open older Runtime has no platform report', () => {
  const url = 'http://127.0.0.1:23998/';
  const target = buildExternalLocalUIDesktopTarget(url);
  const snapshot = buildDesktopWelcomeSnapshot({
    preferences: testDesktopPreferences({ saved_environments: [{ id: 'external', label: 'Runtime',
      local_ui_url: url, pinned: false, created_at_ms: 1, last_used_at_ms: 0 }] }),
    openSessions: [{ session_key: target.session_key, target, lifecycle: 'open', entry_url: url,
      startup: { local_ui_url: url, local_ui_urls: [url] } }],
    savedExternalRuntimeHealth: { external: { status: 'online', source: 'external_local_ui_probe',
      checked_at_unix_ms: 1, runtime_platform: 'linux', runtime_linux_distribution: 'fedora' } },
  });
  expect(snapshot.environments.find(entry => entry.id === 'external')).toMatchObject({
    runtime_platform: 'linux', runtime_linux_distribution: 'fedora', runtime_health: { status: 'online' },
  });
});

it.each(['online', 'offline'] as const)('shows only Cloud Runtime health platform for an %s Runtime', runtime_status => {
  const { inputs } = mixedEnvironmentFixture();
  for (const raw of ['darwin', 'linux', 'win32', 'unknown', undefined]) {
    const health = normalizeDesktopCloudEnvironmentRuntimeHealth({ env_public_id: 'env_0_1', runtime_status,
      observed_at_unix_ms: 1, runtime_platform: raw, runtime_linux_distribution: 'arch' })!;
    const controlPlanes = inputs.controlPlanes.map(source => ({ ...source,
      environments: source.environments.map(entry => entry.env_public_id === 'env_0_1' ? { ...entry, runtime_health: health } : entry),
    }));
    const snapshot = buildDesktopWelcomeSnapshot({ ...inputs, controlPlanes });
    const entry = snapshot.environments.find(entry => entry.kind === 'provider_environment' && entry.env_public_id === 'env_0_1')!;
    const expected: DesktopRuntimePlatform | undefined = raw === 'darwin' ? 'macos' : raw === 'win32' ? 'windows' : raw === 'linux' ? 'linux' : undefined;
    expect(entry.runtime_platform).toBe(expected);
    expect(entry.runtime_linux_distribution).toBe(expected === 'linux' ? 'arch' : undefined);
  }
});


it('shows a native Linux distribution only from its own Runtime observation', () => {
  const { inputs } = mixedEnvironmentFixture();
  const presences = Object.fromEntries(Object.entries(inputs.managedRuntimePresenceByTargetID)
    .map(([key, value]) => [key, { ...value, runtime_platform: 'linux' as const, runtime_linux_distribution: 'ubuntu' }]));
  for (const platform of ['linux', 'darwin'] as const) {
    const snapshot = buildDesktopWelcomeSnapshot({ ...inputs, platformCapabilities: resolveDesktopPlatformCapabilities(platform),
      managedRuntimePresenceByTargetID: presences });
    expect(snapshot.environments.find(entry => entry.kind === 'local_environment')?.runtime_linux_distribution)
      .toBe(platform === 'linux' ? 'ubuntu' : undefined);
  }
});

it('uses the running WSL Runtime ID rather than its editable registration name', () => {
  const { inputs } = mixedEnvironmentFixture({ linkKind: 'wsl_environment' });
  const presences = Object.fromEntries(Object.entries(inputs.managedRuntimePresenceByTargetID)
    .map(([key, value]) => [key, { ...value, runtime_platform: 'linux' as const, runtime_linux_distribution: 'debian' }]));
  const snapshot = buildDesktopWelcomeSnapshot({ ...inputs, managedRuntimePresenceByTargetID: presences });
  expect(snapshot.environments.find(entry => entry.kind === 'wsl_environment')?.runtime_linux_distribution).toBe('debian');
  const absent = buildDesktopWelcomeSnapshot(inputs);
  expect(absent.environments.find(entry => entry.kind === 'wsl_environment')?.runtime_linux_distribution).toBeUndefined();
});
