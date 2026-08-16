import { fileURLToPath } from 'node:url';
import { defineConfig } from '../../../internal/envapp/ui_src/node_modules/vite/dist/node/index.js';

function fixturePort(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a valid port`);
  return JSON.stringify(value);
}

export default defineConfig({
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  resolve: {
    alias: {
      '@floegence/redevplugin-ui/plugin': fileURLToPath(new URL('../../../internal/envapp/ui_src/node_modules/@floegence/redevplugin-ui/dist/plugin.js', import.meta.url)),
    },
  },
  define: {
    __IO_SMOKE_HTTP_PORT__: fixturePort('REDEVPLUGIN_IO_SMOKE_HTTP_PORT', 18080),
    __IO_SMOKE_WS_PORT__: fixturePort('REDEVPLUGIN_IO_SMOKE_WS_PORT', 18080),
    __IO_SMOKE_TCP_PORT__: fixturePort('REDEVPLUGIN_IO_SMOKE_TCP_PORT', 18081),
    __IO_SMOKE_UDP_PORT__: fixturePort('REDEVPLUGIN_IO_SMOKE_UDP_PORT', 18082),
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/ui', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./ui/app.js', import.meta.url)),
      output: {
        format: 'iife',
        name: 'ReDevPluginIOSmoke',
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
