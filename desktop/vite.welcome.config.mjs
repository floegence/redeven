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
  build: {
    outDir: path.resolve(desktopDir, 'dist', 'welcome'),
    emptyOutDir: true,
  },
});
