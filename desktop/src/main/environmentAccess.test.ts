import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import { decorateEnvironmentAccess, environmentAccessBinding, rememberEnvironmentIdentity, selectEnvironmentAccessRoute, removalNeedsAccessReplacement, normalizeEnvironmentAccessPreferences } from './environmentAccess';
import { defaultDesktopPreferences, defaultDesktopPreferencesPaths, createPlaintextSecretCodec, saveDesktopPreferences, loadDesktopPreferences } from './desktopPreferences';
import { memberFixture } from '../testSupport/gatewayMembershipFixture';
const identity = `runtime:${'a'.repeat(64)}`;
const direct = { id: 'direct', kind: 'external_local_ui', label: 'Same', local_ui_url: 'https://runtime.example', created_at_ms: 1 } as DesktopEnvironmentEntry;
const other = { ...direct, id: 'other', created_at_ms: 2 };
const gateway = { id: 'gateway:gw:env:member', kind: 'gateway_environment', label: 'Same', gateway_id: 'gw', gateway_env_id: 'member',
  gateway_identity_fingerprint: 'fingerprint', gateway_member: memberFixture, created_at_ms: 2 } as DesktopEnvironmentEntry;

describe('environment access ownership', () => {
  it('keeps member authority isolated from public health and independent Runtime routes', () => {
    let prefs = rememberEnvironmentIdentity(defaultDesktopPreferences(), direct, identity);
    expect(rememberEnvironmentIdentity(prefs, gateway, identity)).toBe(prefs);
    prefs = rememberEnvironmentIdentity(prefs, other, identity);
    const entries = decorateEnvironmentAccess([direct, other, gateway], prefs);
    expect(entries[0]?.access_routes).toHaveLength(2);
    expect(entries[1]?.access_group_id).toBe(direct.id);
    expect(entries[2]?.access_group_id).toBe(gateway.id);
    expect(entries[2]?.access_routes).toEqual([expect.objectContaining({ id: `${gateway.id}:member`, kind: 'gateway_member' })]);
    expect(() => selectEnvironmentAccessRoute(prefs, entries, direct.id, `${gateway.id}:member`)).toThrow();
  });
  it('preserves independently verified direct routing and explicit replacement', () => {
    let prefs = rememberEnvironmentIdentity(rememberEnvironmentIdentity(defaultDesktopPreferences(), other, identity), direct, identity);
    let entries = decorateEnvironmentAccess([other, direct], prefs);
    expect(entries[0]?.default_access_route_id).toBe('direct:direct');
    prefs = selectEnvironmentAccessRoute(prefs, entries, direct.id, 'other:direct');
    entries = decorateEnvironmentAccess([direct, other], prefs);
    expect(entries[0]?.default_access_route_id).toBe('other:direct');
    expect(removalNeedsAccessReplacement(entries[1]!, ['other'])).toBe(true);
    expect(removalNeedsAccessReplacement(entries[1]!, ['direct'])).toBe(false);
    expect(decorateEnvironmentAccess([direct], prefs)[0]?.default_access_route_missing).toBe(true);
  });
  it('fences member identity and version changes and detaches edited direct destinations', () => {
    for (const patch of [{ gateway_identity_fingerprint: 'other' }, { gateway_member: { ...memberFixture, member_version: 2 } }, { gateway_env_id: 'other' }]) {
      expect(environmentAccessBinding({ ...gateway, ...patch })).not.toBe(environmentAccessBinding(gateway));
    }
    const prefs = rememberEnvironmentIdentity(rememberEnvironmentIdentity(defaultDesktopPreferences(), other, identity), direct, identity);
    expect(decorateEnvironmentAccess([{ ...direct, local_ui_url: 'https://other.example' }, other], prefs)[0]?.access_group_id).toBe(direct.id);
    expect(decorateEnvironmentAccess([{ ...direct, local_ui_url: 'https://other.example' }, other], prefs)[0]?.access_routes).toHaveLength(1);
  });
  it('deletes legacy Gateway observations and defaults once without losing direct preferences', () => {
    const observation = { binding: 'a'.repeat(64), identity, observed_at_ms: 1 };
    expect(normalizeEnvironmentAccessPreferences({ version: 1,
      observations: { [gateway.id]: observation, direct: observation },
      defaults: { [identity]: `${gateway.id}:gateway_proxy`, direct: 'direct:direct', [gateway.id]: `${gateway.id}:direct` },
    })).toEqual({ version: 2, observations: { direct: observation }, defaults: { direct: 'direct:direct' } });
  });
});

describe('access preference persistence', () => {
  it('preserves current state and rejects malformed or future state read-only', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-access-preferences-'));
    const paths = defaultDesktopPreferencesPaths(dir, { stateRoot: path.join(dir, 'runtime') });
    const codec = createPlaintextSecretCodec();
    try {
      const preferences = rememberEnvironmentIdentity(defaultDesktopPreferences(), direct, identity);
      await saveDesktopPreferences(paths, preferences, codec);
      expect((await loadDesktopPreferences(paths, codec)).environment_access).toEqual(preferences.environment_access);
      const stored = JSON.parse(await fs.readFile(paths.preferencesFile, 'utf8'));
      delete stored.environment_access; stored.version = 14;
      await fs.writeFile(paths.preferencesFile, JSON.stringify(stored));
      expect((await loadDesktopPreferences(paths, codec)).environment_access).toBeUndefined();
      for (const state of [{ version: 3, observations: {}, defaults: {} }, { version: 1, observations: [], defaults: {} }, { version: 2, observations: {}, defaults: { x: false } }]) {
        const bytes = JSON.stringify({ ...stored, environment_access: state });
        await fs.writeFile(paths.preferencesFile, bytes);
        await expect(loadDesktopPreferences(paths, codec)).rejects.toThrow('original file has been preserved');
        expect(await fs.readFile(paths.preferencesFile, 'utf8')).toBe(bytes);
      }
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
