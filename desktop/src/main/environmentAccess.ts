import { createHash } from 'node:crypto';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { EnvironmentAccessRoute } from '../shared/environmentAccess';
import type { DesktopPreferences } from './desktopPreferences';

export type EnvironmentAccessPreferences = Readonly<{
  version: 1;
  observations: Readonly<Record<string, Readonly<{ binding: string; identity: string; observed_at_ms: number }>>>;
  defaults: Readonly<Record<string, string>>;
}>;

export function normalizeEnvironmentAccessPreferences(value: unknown): EnvironmentAccessPreferences | undefined {
  if (value === undefined) return undefined;
  const data = value as EnvironmentAccessPreferences;
  const object = (input: unknown) => !!input && typeof input === 'object' && !Array.isArray(input);
  if (!object(data) || data.version !== 1 || !object(data.observations) || !object(data.defaults)
    || Object.values(data.observations).some(item => !item || !Number.isFinite(item.observed_at_ms) || item.observed_at_ms < 0 || !/^[a-f0-9]{64}$/u.test(item.binding) || !/^runtime:[a-f0-9]{64}$/u.test(item.identity))
    || Object.values(data.defaults).some(item => typeof item !== 'string' || !item)) {
    throw new Error('Environment access preferences are invalid; the original file has been preserved.');
  }
  return data;
}

/** Excludes labels, health and transient listener ports; includes the configured owner. */
export function environmentAccessBinding(entry: DesktopEnvironmentEntry): string {
  const config = entry.kind === 'gateway_environment'
    ? [entry.gateway_id, entry.gateway_env_id, entry.gateway_identity_fingerprint, entry.gateway_endpoint_label, entry.gateway_environment_profile_access_route?.kind, entry.gateway_environment_profile_access_route?.url]
    : entry.kind === 'external_local_ui' ? [entry.id, entry.local_ui_url]
    : [entry.id, entry.managed_runtime_host_access, entry.managed_runtime_placement, entry.local_environment_ui_bind];
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

export function rememberEnvironmentIdentity(preferences: DesktopPreferences, entry: DesktopEnvironmentEntry, identity: string): DesktopPreferences {
  if (!/^runtime:[a-f0-9]{64}$/u.test(identity) || entry.kind === 'provider_environment') return preferences;
  const binding = environmentAccessBinding(entry);
  const state = preferences.environment_access ?? { version: 1, observations: {}, defaults: {} };
  const previous = state.observations[entry.id];
  if (previous?.binding === binding && previous.identity === identity) return preferences;
  const selected = state.defaults[identity] ?? state.defaults[entry.id];
  return { ...preferences, environment_access: { ...state,
    defaults: selected ? { ...state.defaults, [identity]: selected } : state.defaults,
    observations: { ...state.observations, [entry.id]: { binding, identity, observed_at_ms: previous?.observed_at_ms ?? entry.created_at_ms } },
  } };
}

function routes(entry: DesktopEnvironmentEntry): readonly EnvironmentAccessRoute[] {
  if (entry.kind === 'provider_environment') return [];
  if (entry.kind !== 'gateway_environment') return [{ id: `${entry.id}:direct`, environment_id: entry.id, kind: 'direct', label: entry.label, is_open: entry.is_open }];
  return (['gateway_proxy', 'direct_url'] as const).filter(mode => entry.gateway_environment_access_capabilities?.includes(mode === 'gateway_proxy' ? 'open_via_gateway' : 'open_direct'))
    .map(kind => ({ id: `${entry.id}:${kind}`, environment_id: entry.id, kind, label: entry.label, gateway_id: entry.gateway_id,
      gateway_label: entry.gateway_label, is_open: entry.is_open && entry.gateway_open_access_mode === kind }));
}

export function decorateEnvironmentAccess(entries: readonly DesktopEnvironmentEntry[], preferences: DesktopPreferences): DesktopEnvironmentEntry[] {
  const identityFor = (entry: DesktopEnvironmentEntry) => {
    const observed = preferences.environment_access?.observations[entry.id];
    return observed?.binding === environmentAccessBinding(entry) ? observed.identity : undefined;
  };
  const groups = new Map<string, DesktopEnvironmentEntry[]>();
  for (const entry of entries) {
    if (entry.kind === 'provider_environment') continue;
    const key = identityFor(entry) ?? entry.id;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const projections = new Map<string, Partial<DesktopEnvironmentEntry>>();
  for (const [key, members] of groups) {
    const rank = (entry: DesktopEnvironmentEntry) => entry.provider_runtime_link_target?.env_public_id ? 0 : entry.kind === 'gateway_environment' ? 3 : entry.kind === 'external_local_ui' ? 2 : 1;
    const age = (entry: DesktopEnvironmentEntry) => preferences.environment_access?.observations[entry.id]?.observed_at_ms ?? entry.created_at_ms;
    members.sort((a, b) => rank(a) - rank(b)
      || age(a) - age(b) || a.id.localeCompare(b.id));
    const owner = members[0]!;
    const accessRoutes = members.flatMap(routes);
    const stored = preferences.environment_access?.defaults[key];
    // First registration owns the implicit default, independent of probe order.
    const original = [...members].sort((a, b) => age(a) - age(b) || rank(a) - rank(b) || a.id.localeCompare(b.id))[0]!;
    const legacyDefault = original.kind === 'gateway_environment' ? `${original.id}:${original.gateway_environment_profile?.access_mode ?? 'direct_url'}` : `${original.id}:direct`;
    const selected = stored ?? legacyDefault;
    for (const entry of members) projections.set(entry.id, {
      verified_runtime_identity: identityFor(entry), access_group_id: owner.id, access_preference_key: key,
      access_routes: accessRoutes, default_access_route_id: selected,
      default_access_route_missing: !accessRoutes.some(route => route.id === selected),
    });
  }
  return entries.map(entry => ({ ...entry, ...projections.get(entry.id) }));
}

export function selectEnvironmentAccessRoute(preferences: DesktopPreferences, entries: readonly DesktopEnvironmentEntry[], environmentID: string, routeID: string): DesktopPreferences {
  const entry = entries.find(candidate => candidate.id === environmentID);
  if (!entry?.access_preference_key || !entry.access_routes?.some(route => route.id === routeID)) throw new Error('Choose an access route belonging to this environment.');
  const state = preferences.environment_access ?? { version: 1, observations: {}, defaults: {} };
  return { ...preferences, environment_access: { ...state, defaults: { ...state.defaults, [entry.access_preference_key]: routeID } } };
}

export function removalNeedsAccessReplacement(entry: DesktopEnvironmentEntry, removedIDs: readonly string[]): boolean {
  return Boolean(entry.access_routes?.some(route => removedIDs.includes(route.environment_id) && route.id === entry.default_access_route_id)
    && entry.access_routes.some(route => !removedIDs.includes(route.environment_id)));
}
