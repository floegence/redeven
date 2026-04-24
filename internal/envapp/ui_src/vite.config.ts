import path from 'node:path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  optimizeDeps: {
    exclude: [
      '@floegence/floe-webapp-core',
      '@floegence/floe-webapp-core/editor',
      'monaco-editor',
    ],
  },
  // The Env App is served under /_redeven_proxy/env/ by the runtime.
  base: '/_redeven_proxy/env/',
  build: {
    outDir: path.resolve(__dirname, '../ui/dist/env'),
    emptyOutDir: true,
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
  worker: {
    format: 'es',
  },
});
