import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayServiceHostOptions } from './gatewayServiceHost';
import type { RuntimeHostCommandOptions } from './runtimeHostAccess';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), run: vi.fn(), release: vi.fn() }));
vi.mock('./runtimePackageCache', async importOriginal => ({
  ...await importOriginal<typeof import('./runtimePackageCache')>(),
  prepareDesktopRuntimeUploadAsset: mocks.prepare,
}));
vi.mock('./runtimeHostAccess', async importOriginal => ({
  ...await importOriginal<typeof import('./runtimeHostAccess')>(),
  createLocalRuntimeHostExecutor: () => ({ host_access: { kind: 'local_host' }, run: mocks.run, release: mocks.release }),
}));
import { ensureManagedGatewayServiceReady } from './gatewayServiceHost';

const options = {
  hostAccess: { kind: 'local_host' }, placement: { kind: 'host_process', runtime_root: '/fixture' },
  stateRoot: '/fixture/state', releaseTag: 'v0.0.0-test', releaseBaseURL: '',
  assetCacheRoot: '/fixture/cache', tempRoot: '/fixture/temp', sshCredentialScope: 'update-test',
  sshTransportManager: {} as GatewayServiceHostOptions['sshTransportManager'],
} satisfies GatewayServiceHostOptions;

describe('Gateway package preparation and service replacement', () => {
  const events: string[] = [];
  let packageStatus = 'ready';
  let running = true;
  beforeEach(() => {
    vi.resetAllMocks(); events.length = 0; packageStatus = 'ready'; running = true;
    mocks.release.mockResolvedValue(undefined);
    mocks.prepare.mockImplementation(async () => {
      events.push('prepare');
      return { archiveData: Buffer.from('verified fixture archive'), cacheEntry: null, source: 'source_build' };
    });
    mocks.run.mockImplementation(async (argv: string[], commandOptions?: RuntimeHostCommandOptions) => {
      const script = argv[2];
      if (commandOptions?.stdinData) { events.push('install'); packageStatus = 'ready'; return { stdout: '', stderr: '' }; }
      if (script.includes('exec "$binary" service-stop')) { events.push('stop'); running = false; return { stdout: '', stderr: '' }; }
      if (script.includes('exec "$binary" service-start')) { events.push('start'); running = true; return { stdout: '', stderr: '' }; }
      if (script.includes('service-status --state-root')) return { stdout: JSON.stringify({ status: running ? 'running' : 'not_running' }), stderr: '' };
      if (script.includes('gateway_package_is_ready')) return { stdout: `status=${packageStatus}\nbinary_path=/fixture/state/managed/bin/redeven-gateway\nstamp_path=/fixture/state/managed/managed-gateway.stamp\n`, stderr: '' };
      return { stdout: 'Darwin\narm64\n', stderr: '' };
    });
  });

  it.each([{ forceUpdate: true }, { forceRestart: true }])('keeps the existing service untouched when preparation fails: %j', async intent => {
    packageStatus = 'build_identity_mismatch';
    mocks.prepare.mockRejectedValue(new Error('package preparation unavailable'));
    await expect(ensureManagedGatewayServiceReady({ ...options, ...intent })).rejects.toThrow('package preparation unavailable');
    expect(events).toEqual([]);
    expect(running).toBe(true);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('prepares the package before stopping and replacing a running Gateway', async () => {
    await ensureManagedGatewayServiceReady({ ...options, forceUpdate: true });
    expect(events).toEqual(['prepare', 'stop', 'install', 'start']);
    expect(running).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ packageKind: 'gateway' }));
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('restarts an already matching Gateway without rebuilding its package', async () => {
    await ensureManagedGatewayServiceReady({ ...options, forceRestart: true });
    expect(events).toEqual(['stop', 'start']);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('refuses replacement if the old Gateway still reports running', async () => {
    mocks.run.mockImplementation(async (argv: string[], commandOptions?: RuntimeHostCommandOptions) => {
      if (commandOptions?.stdinData) throw new Error('must not install');
      if (argv[2].includes('service-status --state-root')) return { stdout: '{"status":"running"}', stderr: '' };
      if (argv[2].includes('gateway_package_is_ready')) return { stdout: 'status=ready\nbinary_path=/fixture/binary\nstamp_path=/fixture/stamp\n', stderr: '' };
      return { stdout: 'Darwin\narm64\n', stderr: '' };
    });
    await expect(ensureManagedGatewayServiceReady({ ...options, forceUpdate: true })).rejects.toThrow('still reports running');
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
