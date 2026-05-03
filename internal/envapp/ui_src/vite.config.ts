import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [wasm(), solid(), tailwindcss()],
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
    target: 'esnext',
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
