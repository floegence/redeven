import type { ArtifactSource } from '@floegence/flowersec-core';
import type { ConnectConfig } from '@floegence/floe-webapp-protocol';
import type { ProxyBootstrapOwnerOptions } from '@floegence/floe-webapp-boot';

export type EnvAppConnectionMode = 'local' | 'remote';

export type EnvAppConnectionConfigLease = Readonly<{
  config: ConnectConfig;
  dispose(): void;
}>;

export type EnvAppConnectionRuntimeOptions = Readonly<{
  localSource?: () => ArtifactSource | Promise<ArtifactSource>;
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

function createCachedSource(
  factory: () => ArtifactSource | Promise<ArtifactSource>,
): () => Promise<ArtifactSource> {
  let sourcePromise: Promise<ArtifactSource> | undefined;
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
  const localSource = options.localSource ? createCachedSource(options.localSource) : undefined;
  const remoteSource = createCachedSource(options.remoteSource);

  return Object.freeze({
    async createConfig(mode) {
      const [boot, source, proxyBootstrapOptions] = await Promise.all([
        loadBootModule(),
        mode === 'local'
          ? localSource?.() ?? Promise.reject(new Error('Local connection is unavailable'))
          : remoteSource(),
        mode === 'remote' ? options.proxyBootstrap() : undefined,
      ]);

      if (mode === 'local') {
        return createConfigLease(boot.createArtifactDirectConnectionConfig({ source }));
      }

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
