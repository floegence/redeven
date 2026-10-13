import { DesktopWelcomeRuntimePoller } from '../main/desktopWelcomeRuntimePoller';
import { DesktopWelcomeRuntimeHealthStore, desktopWelcomeOnlineRuntimeHealth, type DesktopWelcomeRuntimeHealthProbeResult,
  type DesktopWelcomeRuntimeHealthTarget } from '../main/desktopWelcomeRuntimeHealth';
import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { runtimeGatewayAccessFixture, type GatewayRuntimeFixtureKind, type GatewayRuntimeFixtureState } from './runtimeGatewayAccessFixture';

/** Exercise the production observer and snapshot projection, including withdrawn live Presence. */
export async function runtimeGatewayBackgroundProbeFixture(kind: GatewayRuntimeFixtureKind, state: GatewayRuntimeFixtureState = 'ready', startedAtUnixMS?: number) {
  const fixture = runtimeGatewayAccessFixture(kind, state, startedAtUnixMS);
  const store = new DesktopWelcomeRuntimeHealthStore(() => undefined);
  const resultFor = (state: GatewayRuntimeFixtureState): DesktopWelcomeRuntimeHealthProbeResult => {
    const current = runtimeGatewayAccessFixture(kind, state);
    const presence = current.presence && { ...current.presence, started_at_unix_ms: fixture.presence?.started_at_unix_ms };
    if (!presence) return {};
    return { presence, health: presence.running ? desktopWelcomeOnlineRuntimeHealth(current.environment.runtime_health.source, presence) : {
      status: 'offline', checked_at_unix_ms: Date.now(), source: current.environment.runtime_health.source,
      offline_reason_code: 'not_started', offline_reason: 'Runtime stopped.',
    } };
  };
  let probe = async () => resultFor(state);
  const target: DesktopWelcomeRuntimeHealthTarget = {
    key: fixture.environment.id, environment_id: fixture.environment.id,
    slot: kind === 'local' ? 'local_environment' : 'runtime_target', auto_refresh_enabled: true,
    checking_health: { status: 'offline', checked_at_unix_ms: 0, source: fixture.environment.runtime_health.source, offline_reason_code: 'unverified' },
    probe: () => probe(),
  };
  const poller = new DesktopWelcomeRuntimePoller(options => store.refresh([target], { ...options, mode: 'auto' }), async () => undefined);
  const snapshot = () => {
    const snapshot = buildDesktopWelcomeSnapshot({ ...fixture.inputs, ...store.snapshot() });
    return { ...snapshot, environments: snapshot.environments.filter(environment => environment.id === fixture.environment.id) };
  };
  await poller.poll();
  return {
    ...fixture, store, snapshot, poller,
    holdNextProbe() {
      let resolve!: (value: DesktopWelcomeRuntimeHealthProbeResult) => void;
      const response = new Promise<DesktopWelcomeRuntimeHealthProbeResult>(done => { resolve = done; });
      probe = () => response;
      return (nextState = state) => resolve(resultFor(nextState));
    },
    beginProbe() {
      let resolve!: (value: DesktopWelcomeRuntimeHealthProbeResult) => void;
      let reject!: (error: Error) => void;
      probe = () => new Promise((done, failed) => { resolve = done; reject = failed; });
      const pending = poller.poll();
      return { checking: snapshot(), async finish(nextState = state) { resolve(resultFor(nextState)); await pending; return snapshot(); },
        async fail() { reject(new Error('Fixture SSH probe failed.')); await pending; return snapshot(); } };
    },
  };
}
