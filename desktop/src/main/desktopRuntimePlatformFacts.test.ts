import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DesktopStateStore } from './desktopStateStore';
import { retainDesktopRuntimePlatformFacts } from './desktopRuntimePlatformFacts';
import { buildDesktopWelcomeSnapshot } from './desktopWelcomeState';
import { mixedEnvironmentFixture } from '../testSupport/mixedEnvironmentFixture';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it('retains a detected distribution through disconnect and Desktop restart, then updates on a new observation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-platform-facts-')); dirs.push(dir);
  const file = path.join(dir, 'desktop-ui-state.json');
  const store = new DesktopStateStore(file);
  const { inputs } = mixedEnvironmentFixture({ linkKind: 'ssh_environment' });
  const live = buildDesktopWelcomeSnapshot({ ...inputs, managedRuntimePresenceByTargetID: Object.fromEntries(
    Object.entries(inputs.managedRuntimePresenceByTargetID).map(([key, presence]) => [key, {
      ...presence, runtime_platform: 'linux' as const, runtime_linux_distribution: 'ubuntu',
    }]),
  ) });
  const initial = retainDesktopRuntimePlatformFacts(live.environments, store);
  const runtime = initial.find(entry => entry.kind === 'ssh_environment')!;
  expect(runtime.runtime_linux_distribution).toBe('ubuntu');
  const offline = buildDesktopWelcomeSnapshot({ ...inputs, openSessions: [], managedRuntimePresenceByTargetID: {} });
  const reopened = new DesktopStateStore(file);
  const retained = retainDesktopRuntimePlatformFacts(offline.environments, reopened).find(entry => entry.id === runtime.id)!;
  expect(retained.runtime_platform).toBe('linux');
  expect(retained.runtime_linux_distribution).toBe('ubuntu');
  expect(retained.runtime_health.status).toBe('offline');
  const next = retainDesktopRuntimePlatformFacts([{ ...retained, runtime_platform: 'linux' as const,
    runtime_health: { ...retained.runtime_health, status: 'online' },
    runtime_linux_distribution: 'debian' }], reopened)[0];
  expect(next.runtime_linux_distribution).toBe('debian');
  const changedOS = retainDesktopRuntimePlatformFacts([{ ...next, runtime_platform: 'windows' as const,
    runtime_linux_distribution: undefined }], reopened)[0];
  expect(changedOS.runtime_platform).toBe('windows');
  expect(changedOS.runtime_linux_distribution).toBeUndefined();
});

it('does not let a missing report or another environment replace a known system', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-platform-facts-')); dirs.push(dir);
  const store = new DesktopStateStore(path.join(dir, 'state.json'));
  const { inputs } = mixedEnvironmentFixture();
  const runtime = buildDesktopWelcomeSnapshot(inputs).environments.find(entry => entry.kind === 'ssh_environment')!;
  retainDesktopRuntimePlatformFacts([{ ...runtime, runtime_platform: 'linux', runtime_linux_distribution: 'fedora' }], store);
  const [legacy, unrelated] = retainDesktopRuntimePlatformFacts([{ ...runtime, runtime_platform: 'linux' },
    { ...runtime, id: 'another-runtime', runtime_platform: undefined }], store);
  expect(legacy.runtime_linux_distribution).toBe('fedora');
  expect(unrelated.runtime_platform).toBeUndefined();
  expect(unrelated.runtime_linux_distribution).toBeUndefined();
});

it.each(['local_environment', 'wsl_environment', 'ssh_environment', 'provider_environment', 'gateway_environment', 'external_local_ui'] as const)(
  'keeps %s facts while offline and ignores a stale Gateway catalog', kind => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-platform-facts-')); dirs.push(dir);
    const store = new DesktopStateStore(path.join(dir, 'state.json'));
    const { inputs } = mixedEnvironmentFixture();
    const source = buildDesktopWelcomeSnapshot(inputs).environments[0];
    const observed = { ...source, kind, runtime_platform: 'linux' as const, runtime_linux_distribution: 'ubuntu',
      open_session_key: 'observed-session', runtime_health: { ...source.runtime_health, status: 'online' as const } };
    retainDesktopRuntimePlatformFacts([observed], store);
    const disconnected = { ...observed, open_session_key: '', runtime_platform: undefined, runtime_linux_distribution: undefined,
      runtime_health: { ...source.runtime_health, status: 'offline' as const } };
    expect(retainDesktopRuntimePlatformFacts([disconnected], store)[0]).toMatchObject({
      runtime_platform: 'linux', runtime_linux_distribution: 'ubuntu', runtime_health: { status: 'offline' },
    });
    if (kind === 'gateway_environment') {
      retainDesktopRuntimePlatformFacts([{ ...observed, runtime_platform: 'windows' }], store);
      const catalog = { ...disconnected, runtime_platform: 'linux' as const,
        runtime_health: { ...source.runtime_health, status: 'online' as const } };
      expect(retainDesktopRuntimePlatformFacts([catalog], store)[0].runtime_platform).toBe('windows');
    }
  },
);

it('does not reuse facts when a saved URL changes and does not write unchanged snapshots', () => {
  const { inputs } = mixedEnvironmentFixture();
  const source = buildDesktopWelcomeSnapshot(inputs).environments[0];
  const entry = { ...source, kind: 'external_local_ui' as const, secondary_text: 'https://old.example/',
    runtime_platform: 'linux' as const, runtime_linux_distribution: 'debian' };
  let facts = {};
  let writes = 0;
  const store = { runtimePlatformFacts: () => facts, setRuntimePlatformFacts: (value: typeof facts) => { facts = value; writes += 1; } };
  retainDesktopRuntimePlatformFacts([entry], store);
  expect(retainDesktopRuntimePlatformFacts([entry], store)[0]).toBe(entry);
  expect(writes).toBe(1);
  expect(retainDesktopRuntimePlatformFacts([{ ...entry, secondary_text: 'https://new.example/',
    runtime_platform: undefined, runtime_linux_distribution: undefined }], store)[0].runtime_platform).toBeUndefined();
});
