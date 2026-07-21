import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import wasm from 'vite-plugin-wasm';
import solid from 'vite-plugin-solid';

import {
  REDEVEN_ENVAPP_ENABLE_PLUGIN_UI_ENV,
  resolveEnvAppPluginUIEnabled,
} from './src/build/envAppBuildFeatures';
import { REDEVEN_ENV_APP_BASE_PATH } from './src/build/envAppBasePath';

function normalizeBuildModuleId(moduleId: string): string {
  const normalized = moduleId.split('?')[0]!.replaceAll('\\', '/').replace(/^\0/u, 'virtual:');
  const nodeModulesMarker = '/node_modules/';
  const nodeModulesIndex = normalized.lastIndexOf(nodeModulesMarker);
  if (nodeModulesIndex >= 0) return normalized.slice(nodeModulesIndex + nodeModulesMarker.length);
  const relative = path.relative(__dirname, normalized).replaceAll('\\', '/');
  return relative.startsWith('../') ? normalized : relative;
}

function chunkModuleManifest(): Plugin {
  return {
    name: 'redeven-chunk-module-manifest',
    generateBundle(_options, bundle) {
      const chunks = Object.fromEntries(Object.values(bundle)
        .filter((item) => item.type === 'chunk')
        .map((item) => [item.fileName, {
          imports: item.imports,
          dynamicImports: item.dynamicImports,
          modules: Object.keys(item.modules).map(normalizeBuildModuleId).sort(),
        }]));
      this.emitFile({
        type: 'asset',
        fileName: '.vite/chunk-modules.json',
        source: `${JSON.stringify({ schema_version: 1, chunks }, null, 2)}\n`,
      });
    },
  };
}

function envAppBuildFeatures(): Plugin {
  return {
    name: 'redeven-env-app-build-features',
    config(_config, { command }) {
      const pluginUIEnabled = resolveEnvAppPluginUIEnabled(
        command,
        process.env[REDEVEN_ENVAPP_ENABLE_PLUGIN_UI_ENV],
      );
      return {
        define: {
          __REDEVEN_PLUGIN_UI_ENABLED__: JSON.stringify(pluginUIEnabled),
        },
      };
    },
  };
}

export default defineConfig({
  plugins: [envAppBuildFeatures(), wasm(), solid(), tailwindcss(), chunkModuleManifest()],
  resolve: {
    alias: [
      { find: /^@floegence\/floe-webapp-core\/(icons|layout|loading|ui)$/, replacement: path.resolve(__dirname, 'node_modules/@floegence/floe-webapp-core/dist/$1.js') },
      { find: /^@floegence\/floe-webapp-core$/, replacement: path.resolve(__dirname, 'node_modules/@floegence/floe-webapp-core/dist/index.js') },
      { find: /^marked$/, replacement: path.resolve(__dirname, 'node_modules/marked/lib/marked.esm.js') },
    ],
    dedupe: ['solid-js'],
  },
  optimizeDeps: {
    exclude: [
      '@floegence/floe-webapp-core',
      '@floegence/floe-webapp-core/editor',
      'monaco-editor',
    ],
  },
  // The Env App is served under /_redeven_proxy/env/ by the runtime.
  base: REDEVEN_ENV_APP_BASE_PATH,
  build: {
    target: 'esnext',
    outDir: path.resolve(__dirname, '../ui/dist/env'),
    emptyOutDir: true,
    manifest: true,
  },
  server: {
    host: true,
    port: 8096,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 8096,
    strictPort: true,
  },
  test: {
    setupFiles: [path.resolve(__dirname, 'src/test/vitestDomPlatform.ts')],
  },
  worker: {
    format: 'es',
  },
});
