import { describe, expect, it } from 'vitest';
import { linkedEnvironmentFixture } from '../testSupport/linkedEnvironmentFixture';
import { buildEnvironmentLibraryDisplayGroups, splitPinnedEnvironmentGroupIDs } from './environmentLibraryProjection';
import { buildEnvironmentLibrarySummaryModel, environmentLibraryCount, runtimeTargetEnvironmentLibraryFilterValue, environmentProviderFilterValue, filterEnvironmentLibraryDisplayGroups, LOCAL_ENVIRONMENT_LIBRARY_FILTER, PROVIDER_ENVIRONMENT_LIBRARY_FILTER } from './viewModel';

describe('environment relationship contract', () => {
  it.each(['local_environment', 'ssh_environment', 'wsl_environment'] as const)('pairs %s once in either snapshot order', kind => {
    const { runtime, cloud } = linkedEnvironmentFixture(kind);
    for (const entries of [[runtime, cloud], [cloud, runtime]]) {
      const groups = buildEnvironmentLibraryDisplayGroups(entries);
      expect(groups).toHaveLength(1);
      expect(groups[0].primary_entry).toBe(runtime);
      expect(groups[0].provider_entry).toBe(cloud);
    }
  });
  it('matches search and source across either member of the relationship', () => {
    const { snapshot } = linkedEnvironmentFixture();
    expect(environmentLibraryCount(snapshot)).toBe(1);
    expect(filterEnvironmentLibraryDisplayGroups(snapshot, 'Cloud workspace', LOCAL_ENVIRONMENT_LIBRARY_FILTER)).toHaveLength(1);
    expect(filterEnvironmentLibraryDisplayGroups(snapshot, 'Development runtime', PROVIDER_ENVIRONMENT_LIBRARY_FILTER)).toHaveLength(1);
  });
  it('pins the group when either owner is pinned without changing the other owner', () => {
    const { runtime, cloud } = linkedEnvironmentFixture();
    for (const entries of [[{ ...runtime, pinned: true }, cloud], [runtime, { ...cloud, pinned: true }]]) {
      expect(splitPinnedEnvironmentGroupIDs(buildEnvironmentLibraryDisplayGroups(entries))).toEqual({
        pinned_group_ids: [runtime.id], regular_group_ids: [],
      });
    }
    expect(runtime.pinned).toBe(false);
    expect(cloud.pinned).toBe(false);
  });
  it('highlights the source owner and keeps every member searchable', () => {
    const { runtime, cloud, snapshot } = linkedEnvironmentFixture();
    for (const filter of [PROVIDER_ENVIRONMENT_LIBRARY_FILTER, environmentProviderFilterValue(cloud)]) {
      expect(filterEnvironmentLibraryDisplayGroups(snapshot, '', filter)[0].highlighted_owner_id).toBe(cloud.id);
    }
    expect(filterEnvironmentLibraryDisplayGroups(snapshot, '', runtimeTargetEnvironmentLibraryFilterValue(runtime.provider_runtime_link_target!.id))[0].highlighted_owner_id).toBe(runtime.id);
    for (const query of [runtime.label, cloud.label, cloud.env_public_id!, cloud.remote_environment_url!]) {
      expect(environmentLibraryCount(snapshot, query)).toBe(1);
    }
  });
  it('counts both owners windows while counting the relationship once', () => {
    const { runtime, cloud, snapshot } = linkedEnvironmentFixture();
    const withWindows = { ...snapshot, open_windows: [runtime.id, cloud.id].map(environment_id => ({
      ...snapshot.open_windows[0], environment_id,
    })) } as typeof snapshot;
    expect(buildEnvironmentLibrarySummaryModel(withWindows, snapshot.environments)).toMatchObject({ environment_count: 1, window_count: 2 });
  });
  it.each(['connecting', 'disconnecting', 'error'] as const)('preserves the pair and original owner state during %s', state => {
    const { runtime, cloud } = linkedEnvironmentFixture();
    const changedRuntime = { ...runtime, provider_runtime_link_target: { ...runtime.provider_runtime_link_target!, provider_connection_state: state } };
    const offlineCloud = { ...cloud, remote_route_state: 'offline' as const };
    const group = buildEnvironmentLibraryDisplayGroups([changedRuntime, offlineCloud])[0];
    expect(group.primary_entry).toBe(changedRuntime);
    expect(group.provider_entry).toBe(offlineCloud);
    expect(group.primary_entry.runtime_health.status).toBe('online');
  });
  it('keeps missing or unrelated owners independent', () => {
    const { runtime, cloud } = linkedEnvironmentFixture();
    expect(buildEnvironmentLibraryDisplayGroups([runtime])[0].provider_entry).toBeUndefined();
    expect(buildEnvironmentLibraryDisplayGroups([cloud])[0].primary_entry).toBe(cloud);
    expect(buildEnvironmentLibraryDisplayGroups([runtime, { ...cloud, provider_linked_runtime_summary: undefined }])).toHaveLength(2);
    const unbound = { ...runtime, provider_runtime_link_target: { ...runtime.provider_runtime_link_target!, provider_link_state: 'unbound' as const } };
    expect(buildEnvironmentLibraryDisplayGroups([unbound, { ...cloud, provider_linked_runtime_summary: undefined }])).toHaveLength(2);
  });
  it('does not retain a stale pair after unlinking', () => {
    const { runtime, cloud } = linkedEnvironmentFixture();
    const unlinked = { ...runtime, provider_runtime_link_target: { ...runtime.provider_runtime_link_target!, provider_link_state: 'unbound' as const } };
    expect(buildEnvironmentLibraryDisplayGroups([unlinked, cloud])).toHaveLength(2);
  });
});
