import type { ArtifactSource } from '@floegence/flowersec-core';
import type { PrivateLoopbackArtifactSourceV1 } from '@floegence/flowersec-core/browser';
import type { ConnectConfig } from '@floegence/floe-webapp-protocol';
import type { ProxyBootstrapOwnerOptions } from '@floegence/floe-webapp-boot';

export type EnvAppConnectionMode = 'local' | 'remote';

export type EnvAppConnectionConfigLease = Readonly<{
  config: ConnectConfig;
  dispose(): void;
}>;

export type EnvAppLocalConnection =
  | Readonly<{
    kind: 'public_tls';
    source: () => ArtifactSource | Promise<ArtifactSource>;
  }>
  | Readonly<{
    kind: 'desktop_private_bridge_v2';
    origin: string;
    source: () => PrivateLoopbackArtifactSourceV1 | Promise<PrivateLoopbackArtifactSourceV1>;
  }>;

export type EnvAppConnectionRuntimeOptions = Readonly<{
  local?: EnvAppLocalConnection;
  remoteSource: () => ArtifactSource | Promise<ArtifactSource>;
  proxyBootstrap: () => ProxyBootstrapOwnerOptions | Promise<ProxyBootstrapOwnerOptions>;
}>;

export type EnvAppConnectionRuntime = Readonly<{
  createConfig(mode: EnvAppConnectionMode): Promise<EnvAppConnectionConfigLease>;
}>;

type BootModule = typeof import('@floegence/floe-webapp-boot');

let bootModulePromise: Promise<BootModule> | undefined;

function loadBootModule(): Promise<BootModule> {
  if (bootModulePromise) return bootModulePromise;
  const request = import('@floegence/floe-webapp-boot').catch((error) => {
    if (bootModulePromise === request) bootModulePromise = undefined;
    throw error;
  });
  bootModulePromise = request;
  return request;
}

function createCachedSource<Source>(
  factory: () => Source | Promise<Source>,
): () => Promise<Source> {
  let sourcePromise: Promise<Source> | undefined;
  return () => {
    if (sourcePromise) return sourcePromise;
    const request = Promise.resolve().then(factory).catch((error) => {
      if (sourcePromise === request) sourcePromise = undefined;
      throw error;
    });
    sourcePromise = request;
    return request;
  };
}

function createConfigLease(config: ConnectConfig): EnvAppConnectionConfigLease {
  let disposed = false;
  return Object.freeze({
    config,
    dispose() {
      if (disposed) return;
      disposed = true;
      config.lifecycle?.dispose();
    },
  });
}

export function createEnvAppConnectionRuntime(
  options: EnvAppConnectionRuntimeOptions,
): EnvAppConnectionRuntime {
  const local = options.local?.kind === 'desktop_private_bridge_v2'
    ? {
      kind: options.local.kind,
      origin: options.local.origin,
      source: createCachedSource(options.local.source),
    } as const
    : options.local
      ? { kind: options.local.kind, source: createCachedSource(options.local.source) } as const
      : undefined;
  const remoteSource = createCachedSource(options.remoteSource);

  return Object.freeze({
    async createConfig(mode) {
      if (mode === 'local') {
        if (!local) throw new Error('Local connection is unavailable');
        const boot = await loadBootModule();
        if (local.kind === 'desktop_private_bridge_v2') {
          const source = await local.source();
          return createConfigLease(boot.createPrivateLoopbackDirectConnectionConfig({
            source,
            privateLoopback: { origin: local.origin },
          }));
        }
        return createConfigLease(boot.createArtifactDirectConnectionConfig({
          source: await local.source(),
        }));
      }

      const [boot, source, proxyBootstrapOptions] = await Promise.all([
        loadBootModule(),
        remoteSource(),
        options.proxyBootstrap(),
      ]);
      const proxyBootstrap = boot.createProxyBootstrapOwner(proxyBootstrapOptions ?? {});
      try {
        const config = boot.createProxyRuntimeTunnelConnectionConfig({
          source,
          proxyBootstrap,
        });
        return createConfigLease(config);
      } catch (error) {
        boot.closeProxyBootstrap(proxyBootstrap);
        throw error;
      }
    },
  });
}
