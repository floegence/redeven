import { describe, expect, it } from 'vitest';
import { buildDesktopWelcomeSnapshot } from './desktopWelcomeState';
import { runtimeConnectionFixture } from '../testSupport/runtimeConnectionFixture';
import { buildEnvironmentLibraryDisplayGroups } from '../welcome/environmentLibraryProjection';
import { buildEnvironmentLibrarySummaryModel, environmentLibraryCount, filterEnvironmentLibraryDisplayGroups, GATEWAY_ENVIRONMENT_LIBRARY_FILTER, PROVIDER_ENVIRONMENT_LIBRARY_FILTER } from '../welcome/viewModel';

describe('Runtime connection ownership from raw snapshot inputs', () => {
  it.each(['local_environment', 'ssh_environment', 'wsl_environment'] as const)(
    'keeps %s, offline Cloud and both Gateway connections in one group with restricted Cloud management', kind => {
      const { inputs } = runtimeConnectionFixture({ kind, cloudManagement: false });
      const snapshot = buildDesktopWelcomeSnapshot({ ...inputs, controlPlanes: inputs.controlPlanes.map(source => ({
        ...source, environments: source.environments.map(environment => ({ ...environment, status: 'offline' as const })),
      })) });
      const groups = buildEnvironmentLibraryDisplayGroups(snapshot.environments);
      const runtime = groups.find(group => group.primary_entry.kind === kind && group.primary_entry.runtime_service?.gateway_memberships?.length)!;
      expect(runtime.provider_entry?.env_public_id).toBe('env_0_0');
      expect(runtime.gateway_entries).toHaveLength(2);
      expect(runtime.member_ids).toHaveLength(4);
      expect(runtime.primary_entry.provider_runtime_link_target?.can_disconnect_cloud).toBe(false);
      expect(groups).toHaveLength(8);
      expect(environmentLibraryCount(groups, '', GATEWAY_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);
      expect(filterEnvironmentLibraryDisplayGroups(groups, 'Office', PROVIDER_ENVIRONMENT_LIBRARY_FILTER)).toContain(runtime);
    },
  );

  it.each([true, false])('preserves catalog identity and group ownership with an open Gateway window (available=%s)', gatewayAvailable => {
    const { snapshot } = runtimeConnectionFixture({ gatewayWindow: true, gatewayAvailable });
    const ids = snapshot.environments.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = buildEnvironmentLibraryDisplayGroups(snapshot.environments);
    const runtime = groups.find(group => group.primary_entry.runtime_service?.gateway_memberships?.length)!;
    expect(runtime.gateway_entries).toHaveLength(2);
    expect(runtime.gateway_entries?.[0]).toMatchObject({ is_open: true, gateway_member: { runtime_public_id: 'runtime_fixture' } });
    expect(runtime.gateway_entries?.every(entry => entry.access_group_id === runtime.id)).toBe(true);
    expect(groups).toHaveLength(8);
    expect(snapshot.open_windows).toHaveLength(1);
    expect(buildEnvironmentLibrarySummaryModel(snapshot, groups).window_count).toBe(1);
  });

  it('does not group another Runtime even when its labels and addresses match', () => {
    const { inputs } = runtimeConnectionFixture();
    const snapshot = buildDesktopWelcomeSnapshot({ ...inputs, gatewaySources: inputs.gatewaySources.map(source => ({
      ...source, environments: source.environments.map(member => ({ ...member, runtime_public_id: 'another-runtime' })),
    })) });
    expect(buildEnvironmentLibraryDisplayGroups(snapshot.environments)).toHaveLength(10);
  });

  it.each(['local_environment', 'ssh_environment', 'wsl_environment'] as const)(
    'preserves %s ownership during a health check without live presence', kind => {
      const { inputs, snapshot } = runtimeConnectionFixture({ kind, cloudManagement: false });
      const runtime = snapshot.environments.find(entry => entry.kind === kind && entry.runtime_service?.gateway_memberships?.length)!;
      const health = { ...runtime.runtime_health, runtime_service: runtime.runtime_service, freshness: 'checking' as const };
      const checking = buildDesktopWelcomeSnapshot({ ...inputs, managedRuntimePresenceByTargetID: {},
        localRuntimeHealth: kind === 'local_environment' ? { [runtime.id]: health } : {},
        savedRuntimeTargetHealth: kind !== 'local_environment' ? { [runtime.id]: health } : {},
      });
      const group = buildEnvironmentLibraryDisplayGroups(checking.environments).find(group => group.id === runtime.id)!;
      expect(group.provider_entry?.env_public_id).toBe('env_0_0');
      expect(group.gateway_entries).toHaveLength(2);
      expect(group.primary_entry.runtime_health.freshness).toBe('checking');
    },
  );

  it('retains the Gateway perspective and filter before Desktop is authorized for its directory', () => {
    const { inputs } = runtimeConnectionFixture();
    const snapshot = buildDesktopWelcomeSnapshot({ ...inputs, gatewaySources: [] });
    const groups = buildEnvironmentLibraryDisplayGroups(snapshot.environments);
    const group = groups.find(group => group.gateway_tab_id)!;
    expect(group.gateway_entries).toBeUndefined();
    expect(group.provider_entry).toBeDefined();
    expect(environmentLibraryCount(groups, '', GATEWAY_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);
    expect(groups).toHaveLength(8);
  });
});
