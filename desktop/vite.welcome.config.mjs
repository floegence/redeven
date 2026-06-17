import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import solid from 'vite-plugin-solid';

const desktopDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(desktopDir, 'src', 'welcome'),
  base: './',
  plugins: [solid(), tailwindcss()],
  publicDir: false,
  resolve: {
    alias: [
      { find: /^@floegence\/floe-webapp-core\/(icons|layout|loading|ui)$/, replacement: path.resolve(desktopDir, 'node_modules', '@floegence', 'floe-webapp-core', 'dist', '$1.js') },
      { find: /^@floegence\/floe-webapp-core$/, replacement: path.resolve(desktopDir, 'node_modules', '@floegence', 'floe-webapp-core', 'dist', 'index.js') },
      { find: /^marked$/, replacement: path.resolve(desktopDir, 'node_modules', 'marked', 'lib', 'marked.esm.js') },
    ],
    dedupe: ['solid-js'],
  },
  build: {
    outDir: path.resolve(desktopDir, 'dist', 'welcome'),
    emptyOutDir: true,
  },
});
