import { beforeEach, describe, expect, it, vi } from 'vitest';

const bootMocks = vi.hoisted(() => {
  const owners: object[] = [];
  const lifecycles: Array<Readonly<{ synchronize: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>> = [];
  const closeProxyBootstrap = vi.fn();
  const createLifecycle = (onDispose?: () => void) => {
    let disposed = false;
    const lifecycle = Object.freeze({
      synchronize: vi.fn(),
      dispose: vi.fn(() => {
        if (disposed) return;
        disposed = true;
        onDispose?.();
      }),
    });
    lifecycles.push(lifecycle);
    return lifecycle;
  };
  return {
    owners,
    lifecycles,
    closeProxyBootstrap,
    createArtifactDirectConnectionConfig: vi.fn(({ source }: { source: unknown }) => Object.freeze({
      source,
      lifecycle: createLifecycle(),
    })),
    createProxyBootstrapOwner: vi.fn(() => {
      const owner = Object.freeze({ generation: owners.length + 1 });
      owners.push(owner);
      return owner;
    }),
    createProxyRuntimeTunnelConnectionConfig: vi.fn(({ source, proxyBootstrap }: {
      source: unknown;
      proxyBootstrap: object;
    }) => Object.freeze({
      source,
      lifecycle: createLifecycle(() => closeProxyBootstrap(proxyBootstrap)),
    })),
  };
});

vi.mock('@floegence/floe-webapp-boot', () => ({
  closeProxyBootstrap: bootMocks.closeProxyBootstrap,
  createArtifactDirectConnectionConfig: bootMocks.createArtifactDirectConnectionConfig,
  createProxyBootstrapOwner: bootMocks.createProxyBootstrapOwner,
  createProxyRuntimeTunnelConnectionConfig: bootMocks.createProxyRuntimeTunnelConnectionConfig,
}));

import { createEnvAppConnectionRuntime } from './connectionRuntime';

describe('createEnvAppConnectionRuntime', () => {
  beforeEach(() => {
    bootMocks.owners.length = 0;
    bootMocks.lifecycles.length = 0;
    bootMocks.closeProxyBootstrap.mockClear();
    bootMocks.createArtifactDirectConnectionConfig.mockClear();
    bootMocks.createProxyBootstrapOwner.mockClear();
    bootMocks.createProxyRuntimeTunnelConnectionConfig.mockClear();
  });

  it('keeps the upstream source identity while creating a fresh local lifecycle per generation', async () => {
    const source = Object.freeze({ acquire: vi.fn() });
    const localSource = vi.fn(() => source);
    const runtime = createEnvAppConnectionRuntime({
      localSource,
      remoteSource: () => Object.freeze({ acquire: vi.fn() }),
      proxyBootstrap: () => ({}),
    });

    const first = await runtime.createConfig('local');
    const second = await runtime.createConfig('local');

    expect(localSource).toHaveBeenCalledTimes(1);
    expect(first.config).not.toBe(second.config);
    expect(first.config.source).toBe(source);
    expect(second.config.source).toBe(source);
    expect(first.config.lifecycle).not.toBe(second.config.lifecycle);

    first.dispose();
    first.dispose();
    expect(first.config.lifecycle?.dispose).toHaveBeenCalledTimes(1);
    second.dispose();
  });

  it('creates and closes a distinct proxy owner for every remote generation', async () => {
    const source = Object.freeze({ acquire: vi.fn() });
    const remoteSource = vi.fn(async () => source);
    const runtime = createEnvAppConnectionRuntime({
      remoteSource,
      proxyBootstrap: () => ({}),
    });

    const first = await runtime.createConfig('remote');
    const second = await runtime.createConfig('remote');

    expect(remoteSource).toHaveBeenCalledTimes(1);
    expect(first.config.source).toBe(source);
    expect(second.config.source).toBe(source);
    expect(first.config.lifecycle).not.toBe(second.config.lifecycle);
    expect(bootMocks.createProxyBootstrapOwner).toHaveBeenCalledTimes(2);
    expect(bootMocks.owners[0]).not.toBe(bootMocks.owners[1]);

    first.dispose();
    second.dispose();
    expect(bootMocks.closeProxyBootstrap.mock.calls).toEqual([
      [bootMocks.owners[0]],
      [bootMocks.owners[1]],
    ]);
  });

  it('reuses the exact source while disconnect and replacement dispose distinct generations', async () => {
    const source = Object.freeze({ acquire: vi.fn() });
    const runtime = createEnvAppConnectionRuntime({
      localSource: () => source,
      remoteSource: () => Object.freeze({ acquire: vi.fn() }),
      proxyBootstrap: () => ({}),
    });

    const connected = await runtime.createConfig('local');
    connected.config.lifecycle?.dispose();

    const reconnected = await runtime.createConfig('local');
    const replacement = await runtime.createConfig('local');
    reconnected.config.lifecycle?.dispose();

    expect(connected.config.source).toBe(source);
    expect(reconnected.config.source).toBe(source);
    expect(replacement.config.source).toBe(source);
    expect(new Set([
      connected.config.lifecycle,
      reconnected.config.lifecycle,
      replacement.config.lifecycle,
    ]).size).toBe(3);
    expect(connected.config.lifecycle?.dispose).toHaveBeenCalledTimes(1);
    expect(reconnected.config.lifecycle?.dispose).toHaveBeenCalledTimes(1);
    expect(replacement.config.lifecycle?.dispose).not.toHaveBeenCalled();

    replacement.dispose();
  });

  it('closes an unowned proxy owner when the connection config factory fails', async () => {
    const runtime = createEnvAppConnectionRuntime({
      remoteSource: () => Object.freeze({ acquire: vi.fn() }),
      proxyBootstrap: () => ({}),
    });
    bootMocks.createProxyRuntimeTunnelConnectionConfig.mockImplementationOnce(() => {
      throw new Error('config failed');
    });

    await expect(runtime.createConfig('remote')).rejects.toThrow('config failed');
    expect(bootMocks.closeProxyBootstrap).toHaveBeenCalledTimes(1);
    expect(bootMocks.closeProxyBootstrap).toHaveBeenCalledWith(bootMocks.owners[0]);
  });
});
