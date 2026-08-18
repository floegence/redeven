import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  defaultLocalEnvironmentStateLayout,
  localEnvironmentStateLayout,
  resolveConfiguredDesktopCacheRoot,
  resolveConfiguredDesktopTempRoot,
  resolveConfiguredDesktopUserDataRoot,
  runtimeControlSocketPath,
} from './statePaths';

describe('statePaths', () => {
  it('resolves the default Local Environment state layout under the single layout', () => {
    expect(defaultLocalEnvironmentStateLayout({ HOME: '/Users/tester' }, () => '/ignored')).toEqual({
      stateRoot: '/Users/tester/.redeven',
      configPath: '/Users/tester/.redeven/local-environment/config.json',
      secretsFile: '/Users/tester/.redeven/local-environment/secrets.json',
      lockFile: '/Users/tester/.redeven/local-environment/agent.lock',
      stateDir: '/Users/tester/.redeven/local-environment',
      runtimeControlSocket: '/Users/tester/.redeven/local-environment/runtime/control.sock',
      diagnosticsDir: '/Users/tester/.redeven/local-environment/diagnostics',
      auditDir: '/Users/tester/.redeven/local-environment/audit',
      appsDir: '/Users/tester/.redeven/local-environment/apps',
      gatewayDir: '/Users/tester/.redeven/local-environment/gateway',
    });
  });

  it('resolves the explicit Local Environment layout helper to the same single layout', () => {
    expect(localEnvironmentStateLayout({ HOME: '/Users/tester' }, () => '/ignored')).toEqual(expect.objectContaining({
      configPath: '/Users/tester/.redeven/local-environment/config.json',
      stateDir: '/Users/tester/.redeven/local-environment',
      runtimeControlSocket: '/Users/tester/.redeven/local-environment/runtime/control.sock',
    }));
  });

  it('fails clearly when no home directory is available for implicit defaults', () => {
    expect(() => defaultLocalEnvironmentStateLayout({}, () => '')).toThrow('user home directory is unavailable');
  });

  it('gives an explicit development state root priority over the user profile fallback', () => {
    expect(defaultLocalEnvironmentStateLayout({
      HOME: '/Users/tester',
      REDEVEN_STATE_ROOT: '/tmp/redeven-dev-checkout',
    }, () => '/ignored')).toEqual(expect.objectContaining({
      stateRoot: '/tmp/redeven-dev-checkout',
      stateDir: '/tmp/redeven-dev-checkout/local-environment',
    }));
  });

  it('resolves an explicit task-owned Desktop temp root without falling back to the system temp directory', () => {
    expect(resolveConfiguredDesktopTempRoot({
      REDEVEN_DESKTOP_TEMP_ROOT: '/tmp/redeven-plugin-e2e/runtime-data',
      TMPDIR: '/var/folders/shared',
    })).toBe('/tmp/redeven-plugin-e2e/runtime-data');
    expect(resolveConfiguredDesktopTempRoot({ TMPDIR: '/var/folders/shared' })).toBeNull();
  });

  it('resolves task-owned Electron user-data and cache roots without falling back to the shared profile', () => {
    const env = {
      REDEVEN_DESKTOP_USER_DATA_ROOT: '/tmp/redeven-scope/user-data',
      REDEVEN_DESKTOP_CACHE_ROOT: '/tmp/redeven-scope/cache',
    };
    expect(resolveConfiguredDesktopUserDataRoot(env)).toBe('/tmp/redeven-scope/user-data');
    expect(resolveConfiguredDesktopCacheRoot(env)).toBe('/tmp/redeven-scope/cache');
    expect(resolveConfiguredDesktopUserDataRoot({})).toBeNull();
    expect(resolveConfiguredDesktopCacheRoot({})).toBeNull();
  });

  it.each(['darwin', 'linux'] as const)('uses a stable short control socket for long %s state roots', (platform) => {
    const stateRoot = path.join('/private/tmp', 'redeven-state-segment-'.repeat(8));
    const stateDir = path.join(stateRoot, 'local-environment');
    const socketPath = runtimeControlSocketPath(stateDir, platform);

    expect(Buffer.byteLength(path.join(stateDir, 'runtime', 'control.sock'))).toBeGreaterThan(100);
    expect(Buffer.byteLength(socketPath)).toBeLessThanOrEqual(100);
    expect(socketPath).toMatch(/^\/tmp\/redeven-runtime-[a-f0-9]{24}\.sock$/);
    expect(runtimeControlSocketPath(stateDir, platform)).toBe(socketPath);
  });

  it('does not expose a second local Flower state layout', async () => {
    const paths = await import('./statePaths');
    expect(Object.keys(paths).filter((key) => key.toLowerCase().includes('flower'))).toEqual([]);
  });
});
