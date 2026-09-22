import { describe, expect, it } from 'vitest';
import { mixedEnvironmentFixture } from '../testSupport/mixedEnvironmentFixture';
import { buildEnvironmentLibraryDisplayGroups } from '../welcome/environmentLibraryProjection';
import { buildDesktopWelcomeSnapshot } from './desktopWelcomeState';
import { DesktopWelcomeRuntimeHealthStore, desktopWelcomeOnlineRuntimeHealth, type DesktopWelcomeRuntimeHealthProbeResult, type DesktopWelcomeRuntimeHealthTarget } from './desktopWelcomeRuntimeHealth';
import { buildLocalEnvironmentDesktopTarget, buildSSHDesktopTarget, buildWSLDesktopTarget, type DesktopSessionSummary } from './desktopTarget';

describe('Welcome health refresh relationship continuity', () => {
  it.each((['local_environment', 'ssh_environment', 'wsl_environment'] as const).flatMap(linkKind =>
    [false, true].map(open => ({ linkKind, open }))))(
    'keeps the $linkKind pair during refresh with an open window: $open', async ({ linkKind, open }) => {
      const { inputs } = mixedEnvironmentFixture({ linkKind });
      const store = new DesktopWelcomeRuntimeHealthStore(() => undefined);
      const targets: DesktopWelcomeRuntimeHealthTarget[] = Object.values(inputs.managedRuntimePresenceByTargetID).map(presence => ({
        key: presence.target_id,
        environment_id: presence.environment_id,
        slot: presence.kind === 'local_environment' ? 'local_environment' : 'runtime_target',
        auto_refresh_enabled: true,
        checking_health: { status: 'offline', checked_at_unix_ms: 0, source: 'local_runtime_probe' },
        probe: async () => ({ presence, health: desktopWelcomeOnlineRuntimeHealth('local_runtime_probe', presence) }),
      }));
      const openSessions: DesktopSessionSummary[] = [];
      const snapshot = () => buildDesktopWelcomeSnapshot({ ...inputs, ...store.snapshot(), openSessions });
      const groups = () => buildEnvironmentLibraryDisplayGroups(snapshot().environments);
      await store.refresh(targets);
      const initialGroups = groups();
      const pair = initialGroups.find(group => group.provider_entry)!;
      expect(pair.primary_entry.kind).toBe(linkKind);
      const linkedTarget = targets.find(target => target.environment_id === pair.id)!;
      if (open) {
        const runtime = pair.primary_entry;
        const registration = inputs.preferences.saved_runtime_targets.find(target => target.id === runtime.id);
        const sessionTarget = runtime.kind === 'local_environment'
          ? buildLocalEnvironmentDesktopTarget(inputs.preferences.local_environment)
          : registration?.host_access.kind === 'wsl_host'
            ? buildWSLDesktopTarget(registration.host_access, registration.id, registration.label)
            : buildSSHDesktopTarget(runtime.ssh_details!, { environmentID: runtime.id, label: runtime.label });
        openSessions.push({
          session_key: sessionTarget.session_key, target: sessionTarget, lifecycle: 'open',
          startup: { local_ui_url: runtime.local_ui_url, local_ui_urls: [runtime.local_ui_url],
            started_at_unix_ms: runtime.runtime_started_at_unix_ms,
            runtime_service: { ...runtime.runtime_service!, bindings: {
              ...runtime.runtime_service!.bindings!, provider_link: { state: 'unbound', remote_enabled: false },
            } },
          },
        });
      }
      let resolve!: (result: DesktopWelcomeRuntimeHealthProbeResult) => void;
      const pending = store.refresh([{ ...linkedTarget, probe: () => new Promise(done => { resolve = done; }) }], { force: true });
      expect(store.snapshot().managedRuntimePresenceByTargetID[linkedTarget.key]).toBeUndefined();
      const during = groups();
      expect(during.map(group => [group.id, group.member_ids])).toEqual(initialGroups.map(group => [group.id, group.member_ids]));
      const refreshing = during.find(group => group.id === pair.id)!;
      expect(refreshing.primary_entry.runtime_health.freshness).toBe('checking');
      expect(refreshing.primary_entry.runtime_started_at_unix_ms).toBe(pair.primary_entry.runtime_started_at_unix_ms);
      expect(refreshing.provider_entry?.provider_linked_runtime_summary?.runtime_target_id).toBe(linkedTarget.key);
      expect(refreshing.primary_entry.provider_runtime_link_target?.runtime_control_status.state).toBe('missing');
      resolve(await linkedTarget.probe());
      await pending;
      expect(groups().map(group => [group.id, group.member_ids])).toEqual(initialGroups.map(group => [group.id, group.member_ids]));

      // A completed unlink is authoritative; continuity must not retain a stale pair.
      const observed = await linkedTarget.probe();
      const unboundService = { ...observed.health!.runtime_service!, bindings: {
        ...observed.health!.runtime_service!.bindings!, provider_link: { state: 'unbound' as const, remote_enabled: false },
      } };
      await store.refresh([{ ...linkedTarget, probe: async () => ({
        health: { ...observed.health!, runtime_service: unboundService },
        presence: { ...observed.presence!, runtime_service: unboundService },
      }) }], { force: true });
      expect(groups()).toHaveLength(initialGroups.length + 1);
      expect(groups().every(group => !group.provider_entry)).toBe(true);
    },
  );
});
