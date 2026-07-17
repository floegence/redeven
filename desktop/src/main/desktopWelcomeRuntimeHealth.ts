import type { DesktopRuntimeHealth } from '../shared/desktopRuntimeHealth';
import type { DesktopManagedRuntimePresence } from '../shared/desktopRuntimePresence';
import type { DesktopProviderRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';

export type DesktopWelcomeRuntimeHealthSlot =
  | 'local_environment'
  | 'external_local_ui'
  | 'ssh_environment'
  | 'runtime_target';

export type DesktopWelcomeRuntimeHealthProbeEvent = Readonly<{
  target_id: string;
  target_kind: DesktopWelcomeRuntimeHealthSlot;
  duration_ms: number;
  outcome: 'success' | 'failed';
  message?: string;
}>;

export type DesktopWelcomeRuntimeHealthProbeResult = Readonly<{
  health?: DesktopRuntimeHealth;
  presence?: DesktopManagedRuntimePresence;
}>;

export type DesktopWelcomeRuntimeHealthTarget = Readonly<{
  key: string;
  probe_coordinator_key?: string;
  environment_id: string;
  slot: DesktopWelcomeRuntimeHealthSlot;
  presence_target_id?: DesktopProviderRuntimeLinkTargetID;
  auto_refresh_enabled: boolean;
  checking_health: DesktopRuntimeHealth;
  probe: () => Promise<DesktopWelcomeRuntimeHealthProbeResult>;
  project_shared_result?: (
    result: DesktopWelcomeRuntimeHealthProbeResult,
  ) => DesktopWelcomeRuntimeHealthProbeResult;
}>;

export type DesktopWelcomeRuntimeHealthSnapshot = Readonly<{
  localRuntimeHealth: Readonly<Record<string, DesktopRuntimeHealth>>;
  savedExternalRuntimeHealth: Readonly<Record<string, DesktopRuntimeHealth>>;
  savedSSHRuntimeHealth: Readonly<Record<string, DesktopRuntimeHealth>>;
  savedRuntimeTargetHealth: Readonly<Record<string, DesktopRuntimeHealth>>;
  managedRuntimePresenceByTargetID: Readonly<Record<string, DesktopManagedRuntimePresence>>;
}>;

type CacheEntry = {
  generation: number;
  target: DesktopWelcomeRuntimeHealthTarget;
  health?: DesktopRuntimeHealth;
  presence?: DesktopManagedRuntimePresence;
};

type RefreshTask = Readonly<{
  generation: number;
  promise: Promise<void>;
}>;

const DEFAULT_FRESH_HEALTH_TTL_MS = 30_000;

export function desktopWelcomeRuntimeHealthIsFresh(
  health: DesktopRuntimeHealth | null | undefined,
  nowUnixMS: number = Date.now(),
  freshHealthTTLMS: number = DEFAULT_FRESH_HEALTH_TTL_MS,
): health is DesktopRuntimeHealth {
  return health?.freshness === 'fresh'
    && nowUnixMS - health.checked_at_unix_ms < freshHealthTTLMS;
}

function withFreshness(
  health: DesktopRuntimeHealth,
  freshness: NonNullable<DesktopRuntimeHealth['freshness']>,
): DesktopRuntimeHealth {
  return {
    ...health,
    freshness,
  };
}

export class DesktopWelcomeRuntimeHealthStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, RefreshTask>();
  private readonly coordinatedProbes = new Map<string, Promise<DesktopWelcomeRuntimeHealthProbeResult>>();

  constructor(
    private readonly onChange: () => void,
    private readonly onProbeEvent: (event: DesktopWelcomeRuntimeHealthProbeEvent) => void = () => undefined,
    private readonly freshHealthTTLMS = DEFAULT_FRESH_HEALTH_TTL_MS,
  ) {}

  prime(
    targets: readonly DesktopWelcomeRuntimeHealthTarget[],
    options: Readonly<{ pruneMissing?: boolean }> = {},
  ): void {
    if (options.pruneMissing === true) {
      this.retainTargets(targets);
    }
    for (const target of targets) {
      const previous = this.cache.get(target.key);
      if (previous) {
        this.cache.set(target.key, {
          ...previous,
          target,
        });
        continue;
      }
      this.cache.set(target.key, {
        generation: 0,
        target,
      });
    }
  }

  snapshot(): DesktopWelcomeRuntimeHealthSnapshot {
    const localRuntimeHealth: Record<string, DesktopRuntimeHealth> = {};
    const savedExternalRuntimeHealth: Record<string, DesktopRuntimeHealth> = {};
    const savedSSHRuntimeHealth: Record<string, DesktopRuntimeHealth> = {};
    const savedRuntimeTargetHealth: Record<string, DesktopRuntimeHealth> = {};
    const managedRuntimePresenceByTargetID: Record<string, DesktopManagedRuntimePresence> = {};

    for (const entry of this.cache.values()) {
      if (entry.health) {
        switch (entry.target.slot) {
          case 'local_environment':
            localRuntimeHealth[entry.target.environment_id] = entry.health;
            break;
          case 'external_local_ui':
            savedExternalRuntimeHealth[entry.target.environment_id] = entry.health;
            break;
          case 'ssh_environment':
            savedSSHRuntimeHealth[entry.target.environment_id] = entry.health;
            break;
          case 'runtime_target':
            savedRuntimeTargetHealth[entry.target.environment_id] = entry.health;
            break;
        }
      }
      if (entry.presence) {
        managedRuntimePresenceByTargetID[entry.presence.target_id] = entry.presence;
      }
    }

    return {
      localRuntimeHealth,
      savedExternalRuntimeHealth,
      savedSSHRuntimeHealth,
      savedRuntimeTargetHealth,
      managedRuntimePresenceByTargetID,
    };
  }

  refresh(
    targets: readonly DesktopWelcomeRuntimeHealthTarget[],
    options: Readonly<{ force?: boolean; pruneMissing?: boolean }> = {},
  ): Promise<void> {
    if (options.pruneMissing === true) {
      this.retainTargets(targets);
    }
    const tasks = targets.map((target) => this.refreshTarget(target, options));
    return Promise.all(tasks).then(() => undefined);
  }

  private retainTargets(targets: readonly DesktopWelcomeRuntimeHealthTarget[]): void {
    const targetKeys = new Set(targets.map((target) => target.key));
    for (const key of this.cache.keys()) {
      if (!targetKeys.has(key)) {
        this.cache.delete(key);
      }
    }
    for (const key of this.inFlight.keys()) {
      if (!targetKeys.has(key)) {
        this.inFlight.delete(key);
      }
    }
  }

  private refreshTarget(
    target: DesktopWelcomeRuntimeHealthTarget,
    options: Readonly<{ force?: boolean }>,
  ): Promise<void> {
    const existingTask = this.inFlight.get(target.key);
    if (existingTask) {
      return existingTask.promise;
    }

    const previous = this.cache.get(target.key);
    if (
      options.force !== true
      && desktopWelcomeRuntimeHealthIsFresh(previous?.health, Date.now(), this.freshHealthTTLMS)
    ) {
      return Promise.resolve();
    }
    const generation = (previous?.generation ?? 0) + 1;
    this.cache.set(target.key, {
      generation,
      target,
      health: withFreshness(previous?.health ?? target.checking_health, 'checking'),
      presence: undefined,
    });
    this.onChange();

    const startedAt = Date.now();
    const promise = this.runProbe(target)
      .then((result) => {
        if (this.cache.get(target.key)?.generation !== generation) {
          return;
        }
        this.cache.set(target.key, {
          generation,
          target,
          health: result.health ? withFreshness(result.health, 'fresh') : undefined,
          presence: result.presence,
        });
        this.onProbeEvent({
          target_id: target.environment_id,
          target_kind: target.slot,
          duration_ms: Date.now() - startedAt,
          outcome: 'success',
        });
      })
      .catch((error) => {
        if (this.cache.get(target.key)?.generation !== generation) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.cache.set(target.key, {
          generation,
          target,
          health: withFreshness({
            ...target.checking_health,
            checked_at_unix_ms: Date.now(),
            offline_reason: message || target.checking_health.offline_reason,
          }, 'failed'),
          presence: undefined,
        });
        this.onProbeEvent({
          target_id: target.environment_id,
          target_kind: target.slot,
          duration_ms: Date.now() - startedAt,
          outcome: 'failed',
          message,
        });
      })
      .finally(() => {
        const currentTask = this.inFlight.get(target.key);
        if (currentTask?.generation === generation) {
          this.inFlight.delete(target.key);
        }
        this.onChange();
      });

    this.inFlight.set(target.key, {
      generation,
      promise,
    });
    return promise;
  }

  private runProbe(
    target: DesktopWelcomeRuntimeHealthTarget,
  ): Promise<DesktopWelcomeRuntimeHealthProbeResult> {
    const coordinatorKey = target.probe_coordinator_key;
    if (!coordinatorKey) {
      return target.probe();
    }
    let shared = this.coordinatedProbes.get(coordinatorKey);
    if (!shared) {
      shared = target.probe().finally(() => {
        if (this.coordinatedProbes.get(coordinatorKey) === shared) {
          this.coordinatedProbes.delete(coordinatorKey);
        }
      });
      this.coordinatedProbes.set(coordinatorKey, shared);
    }
    return shared.then((result) => target.project_shared_result?.(result) ?? result);
  }
}
