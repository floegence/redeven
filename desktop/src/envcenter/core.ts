import type { EnvironmentEntry, EnvironmentPresentation, EnvironmentRecoveryAction, EnvironmentFailure } from './contracts';
/** Already verified host facts are projected without inventing identity matches. */
export function matchesEnvironmentSearch(searchText: string, query: string): boolean {
  const clean = query.trim().toLowerCase();
  return clean === '' || searchText.toLowerCase().includes(clean);
}
export function filterEnvironmentFacts<T>(entries: readonly T[], query: string,
  text: (entry: T) => string, accepts: (entry: T) => boolean = () => true): readonly T[] {
  return entries.filter(entry => matchesEnvironmentSearch(text(entry), query) && accepts(entry));
}

/** Normalize product error semantics once; hosts localize recovery actions. */
export function classifyEnvironmentFailure(code: string): import('./contracts').EnvironmentFailure {
  if (/AUTH|SESSION_EXPIRED|ACCESS_EXPIRED|CHALLENGE_EXPIRED|FACTOR_INVALID/.test(code)) return 'authentication';
  if (/CLIPBOARD|POPUP|BROWSER_PERMISSION/.test(code)) return 'browser';
  if (/DENIED|FORBIDDEN|REVOKED|BINDING_REQUIRED/.test(code)) return 'permission';
  if (/UNSUPPORTED|INCOMPATIBLE|PROTOCOL_VERSION/.test(code)) return 'unsupported';
  if (/OFFLINE|UNREACHABLE|CONNECTION_FAILED/.test(code)) return 'offline';
  if (/CONFLICT|REVISION/.test(code)) return 'conflict';
  if (/BUSY|CAPACITY|RATE_LIMIT/.test(code)) return 'capacity';
  if (/PASSWORD_LENGTH|PASSWORD_COMMON|INVALID_TARGET|INVALID_ORIGIN|NOT_CONFIGURED/.test(code)) return 'configuration';
  if (/CANCEL/.test(code)) return 'canceled';
  return 'unknown';
}

/** Terminal outcomes cannot be revived by duplicated or delayed host events. */
export function reduceEnvironmentOperation(
  current: import('./contracts').EnvironmentOperationState | undefined,
  event: import('./contracts').EnvironmentOperationEvent,
): import('./contracts').EnvironmentOperationState {
  if (!current) return event;
  if (current.id !== event.id || event.sequence <= current.sequence || current.status !== 'running') return current;
  return event;
}

/** Route identity is an exact tuple, never a display name or network address. */
export function projectEnvironment(environment: EnvironmentEntry, presentationID?: string): EnvironmentPresentation {
  const gateway = environment.gateway_id?.trim() ?? '';
  const member = environment.gateway_env_id?.trim() ?? '';
  const id = presentationID ?? environment.access_group_id ?? environment.id;
  const target = gateway && member && id ? {
    environment_id: id, gateway_id: gateway, gateway_env_id: member, label: environment.label,
  } : undefined;
  return {
    identity: JSON.stringify([gateway, member, id]),
    label: environment.label,
    hostname: environment.gateway_member?.metadata.hostname ?? '',
    connected: environment.gateway_member?.connected === true,
    openAvailable: environment.runtime_operations.open.availability === 'available',
    target,
  };
}

export function environmentRecovery(failure: EnvironmentFailure): EnvironmentRecoveryAction {
  return ({ authentication: 'sign_in', permission: 'request_access', offline: 'check_connection',
    unsupported: 'update_target', conflict: 'refresh', capacity: 'wait', configuration: 'configure',
    browser: 'browser_settings', canceled: 'none', unknown: 'retry' } as const)[failure];
}

/** Owner-issued generations and revisions, never arrival time, select snapshots. */
export function selectEnvironmentSnapshot<T>(current: T, next: T,
  version: (value: T) => { generation: number; revision: number }): T {
  const before = version(current), after = version(next);
  if (before.generation !== after.generation) return after.generation > before.generation ? next : current;
  if (before.revision > 0 || after.revision > 0) return after.revision > before.revision ? next : current;
  return next;
}
