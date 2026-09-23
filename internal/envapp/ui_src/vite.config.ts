import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import { createReloadPlaceholderScript } from '@floegence/floe-webapp-core/reload-placeholder';
import { pdfAssetsPlugin } from '@floegence/floe-webapp-core/pdf-assets';

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

export default defineConfig({
  plugins: [{
    name: 'redeven-document-reload-presentation',
    transformIndexHtml: {
      order: 'pre',
      handler(_html, context) {
        if (path.basename(context.filename) !== 'index.html') return;
        return [{ tag: 'script', injectTo: 'head-prepend', children: createReloadPlaceholderScript({
          storageKey: 'redeven-envapp:reload-layout-v2', scopeStorageKey: 'redeven_env_public_id',
        }) }];
      },
    },
  }, solid(), tailwindcss(), chunkModuleManifest(), pdfAssetsPlugin()],
  resolve: {
    alias: [
      { find: /^@floegence\/floe-webapp-core\/(chat|chat-media|icons|layout|loading|ui)$/, replacement: path.resolve(__dirname, 'node_modules/@floegence/floe-webapp-core/dist/$1.js') },
      { find: /^@floegence\/floe-webapp-core$/, replacement: path.resolve(__dirname, 'node_modules/@floegence/floe-webapp-core/dist/index.js') },
      { find: /^marked$/, replacement: path.resolve(__dirname, 'node_modules/marked/lib/marked.esm.js') },
      { find: /^thinking-orbs\/engine$/, replacement: path.resolve(__dirname, 'node_modules/thinking-orbs/dist/engine.es.js') },
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
    rolldownOptions: { input: { index: path.resolve(__dirname, 'index.html'), access: path.resolve(__dirname, 'access.html'), browser: path.resolve(__dirname, 'browser.html') } },
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
    execArgv: ['--no-experimental-webstorage'],
    environmentOptions: {
      jsdom: { url: 'https://localhost/_redeven_proxy/env/' },
    },
    setupFiles: [path.resolve(__dirname, 'src/test/vitestDomPlatform.ts')],
  },
  worker: {
    format: 'es',
  },
});
