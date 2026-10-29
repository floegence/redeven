import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';
import { fileURLToPath } from 'node:url';
const coreDist = fileURLToPath(new URL('./node_modules/@floegence/floe-webapp-core/dist/', import.meta.url));

export default defineConfig({
  server: { fs: { allow: ['..'] } },
  resolve: {
    conditions: ['browser'], dedupe: ['solid-js'],
    alias: [
      { find: /^lucide-solid$/, replacement: fileURLToPath(new URL('./node_modules/lucide-solid/dist/source/lucide-solid.jsx', import.meta.url)) },
      { find: /^@floegence\/floe-webapp-core\/graph\.css$/, replacement: `${coreDist}graph.css` },
      { find: /^@floegence\/floe-webapp-core\/(chat|chat-media|code-highlight|file-browser|graph|icons|layout|loading|markdown|ui)$/, replacement: `${coreDist}$1.js` },
      { find: /^@floegence\/floe-webapp-core$/, replacement: `${coreDist}index.js` },
      { find: /^marked$/, replacement: fileURLToPath(new URL('./node_modules/marked/lib/marked.esm.js', import.meta.url)) },
      { find: /^thinking-orbs\/engine$/, replacement: fileURLToPath(new URL('./node_modules/thinking-orbs/dist/engine.es.js', import.meta.url)) },
    ],
  },
  plugins: [solid({
      // Tests consume generated JavaScript; compact output avoids large pretty-printed intermediates.
      babel: { compact: true }, dev: false, hot: false })],
  test: {
    environment: 'jsdom',
    server: { deps: { inline: [/\.css$/] } },
    include: ['src/welcome/**/*.client.test.tsx', '../internal/flower_ui/src/**/*.client.test.ts'],
    maxWorkers: 1,
  },
});
