import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import { decorateEnvironmentAccess, environmentAccessBinding, rememberEnvironmentIdentity, selectEnvironmentAccessRoute, removalNeedsAccessReplacement } from './environmentAccess';
import { defaultDesktopPreferences, defaultDesktopPreferencesPaths, createPlaintextSecretCodec, saveDesktopPreferences, loadDesktopPreferences } from './desktopPreferences';
const identity = `runtime:${'a'.repeat(64)}`;
const direct = { id: 'direct', kind: 'external_local_ui', label: 'Same', local_ui_url: 'https://runtime.example', created_at_ms: 1 } as unknown as DesktopEnvironmentEntry;
const gateway = { id: 'gw', kind: 'gateway_environment', label: 'Same', gateway_id: 'gateway', gateway_env_id: 'env',
  gateway_endpoint_label: 'https://gateway.example', gateway_trust_state: 'paired', gateway_environment_profile: { access_mode: 'gateway_proxy' },
  gateway_environment_profile_access_route: { kind: 'url', url: 'https://runtime.example' },
  gateway_environment_access_capabilities: ['open_direct', 'open_via_gateway'], created_at_ms: 2 } as unknown as DesktopEnvironmentEntry;

describe('environment access ownership', () => {
 it('never groups by label or URL, and preserves direct default when a verified Gateway is added', () => {
  let prefs = defaultDesktopPreferences();
  expect(decorateEnvironmentAccess([direct, gateway], prefs)[1]?.access_group_id).not.toBe('direct');
  prefs = rememberEnvironmentIdentity(prefs, direct, identity);
  prefs = rememberEnvironmentIdentity(prefs, gateway, identity);
  const entries = decorateEnvironmentAccess([direct, gateway], prefs);
  expect(entries[1]?.access_group_id).toBe('direct');
  expect(entries[0]?.default_access_route_id).toBe('direct:direct');
  expect(entries[0]?.access_routes).toHaveLength(3);
 });
 it('keeps the original registration default regardless of probe completion order', () => {
  const prefs = rememberEnvironmentIdentity(rememberEnvironmentIdentity(defaultDesktopPreferences(), gateway, identity), direct, identity);
  expect(decorateEnvironmentAccess([gateway, direct], prefs)[0]?.default_access_route_id).toBe('direct:direct');
  const earlierGateway = { ...gateway, created_at_ms: 0 };
  const earlierPrefs = rememberEnvironmentIdentity(rememberEnvironmentIdentity(defaultDesktopPreferences(), earlierGateway, identity), direct, identity);
  expect(decorateEnvironmentAccess([earlierGateway, direct], earlierPrefs)[0]?.default_access_route_id).toBe('gw:gateway_proxy');
  expect(decorateEnvironmentAccess([{ ...earlierGateway, created_at_ms: 9999 }, direct], earlierPrefs)[0]?.default_access_route_id).toBe('gw:gateway_proxy');
 });
 it('only changes default on explicit save and rejects unrelated route choices', () => {
  let prefs = rememberEnvironmentIdentity(rememberEnvironmentIdentity(defaultDesktopPreferences(), direct, identity), gateway, identity);
  const entries = decorateEnvironmentAccess([direct, gateway], prefs);
  prefs = selectEnvironmentAccessRoute(prefs, entries, 'direct', 'gw:gateway_proxy');
  expect(decorateEnvironmentAccess([direct, gateway], prefs)[0]?.default_access_route_id).toBe('gw:gateway_proxy');
  expect(() => selectEnvironmentAccessRoute(prefs, entries, 'direct', 'missing')).toThrow();
 });
 it('detaches edited targets and changed identities without transferring a saved default', () => {
  let prefs = rememberEnvironmentIdentity(rememberEnvironmentIdentity(defaultDesktopPreferences(), direct, identity), gateway, identity);
  prefs = selectEnvironmentAccessRoute(prefs, decorateEnvironmentAccess([direct, gateway], prefs), 'direct', 'gw:gateway_proxy');
  const changed = { ...gateway, gateway_environment_profile_access_route: { kind: 'url' as const, url: 'https://other.example' } };
  expect(environmentAccessBinding(changed)).not.toBe(environmentAccessBinding(gateway));
  const entries = decorateEnvironmentAccess([direct, changed], prefs);
  expect(entries[1]?.access_group_id).not.toBe('direct');
  expect(entries[0]?.default_access_route_missing).toBe(true);
  prefs = rememberEnvironmentIdentity(prefs, gateway, `runtime:${'b'.repeat(64)}`);
  expect(decorateEnvironmentAccess([direct, gateway], prefs)[1]?.access_group_id).not.toBe('direct');
 });
});


describe('access preference persistence', () => {
  it('preserves observations and explicit defaults, upgrades missing state, and rejects malformed state read-only', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-access-preferences-'));
    const paths = defaultDesktopPreferencesPaths(dir, { stateRoot: path.join(dir, 'runtime') });
    const codec = createPlaintextSecretCodec();
    try {
      let preferences = rememberEnvironmentIdentity(rememberEnvironmentIdentity(defaultDesktopPreferences(), direct, identity), gateway, identity);
      const entries = decorateEnvironmentAccess([direct, gateway], preferences);
      preferences = selectEnvironmentAccessRoute(preferences, entries, direct.id, 'gw:gateway_proxy');
      expect(removalNeedsAccessReplacement(decorateEnvironmentAccess([direct, gateway], preferences)[1], [gateway.id])).toBe(true);
      expect(removalNeedsAccessReplacement(entries[1], [gateway.id])).toBe(false);
      await saveDesktopPreferences(paths, preferences, codec);
      expect((await loadDesktopPreferences(paths, codec)).environment_access).toEqual(preferences.environment_access);
      const stored = JSON.parse(await fs.readFile(paths.preferencesFile, 'utf8'));
      delete stored.environment_access; stored.version = 14;
      await fs.writeFile(paths.preferencesFile, JSON.stringify(stored));
      expect((await loadDesktopPreferences(paths, codec)).environment_access).toBeUndefined();
      for (const state of [{ version: 2, observations: {}, defaults: {} }, { version: 1, observations: [], defaults: {} }, { version: 1, observations: {}, defaults: { x: false } }]) {
        const bytes = JSON.stringify({ ...stored, environment_access: state });
        await fs.writeFile(paths.preferencesFile, bytes);
        await expect(loadDesktopPreferences(paths, codec)).rejects.toThrow('original file has been preserved');
        expect(await fs.readFile(paths.preferencesFile, 'utf8')).toBe(bytes);
      }
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
