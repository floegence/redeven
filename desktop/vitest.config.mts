import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';
import { fileURLToPath } from 'node:url';

const coreDist = fileURLToPath(new URL('./node_modules/@floegence/floe-webapp-core/dist/', import.meta.url));
const markedDist = fileURLToPath(new URL('./node_modules/marked/lib/marked.esm.js', import.meta.url));
const thinkingOrbsEngine = fileURLToPath(new URL('./node_modules/thinking-orbs/dist/engine.es.js', import.meta.url));
export default defineConfig({
  server: {
    fs: {
      allow: ['..'],
    },
  },
  resolve: {
    conditions: ['node'],
    alias: [
      { find: /^@floegence\/floe-webapp-core\/(chat|chat-media|code-highlight|file-browser|icons|layout|loading|markdown|ui)$/, replacement: `${coreDist}$1.js` },
      { find: /^@floegence\/floe-webapp-core$/, replacement: `${coreDist}index.js` },
      { find: /^lucide-solid$/, replacement: fileURLToPath(new URL('./node_modules/lucide-solid/dist/source/lucide-solid.jsx', import.meta.url)) },
      { find: /^marked$/, replacement: markedDist },
      { find: /^thinking-orbs\/engine$/, replacement: thinkingOrbsEngine },
    ],
    dedupe: ['solid-js'],
  },
  plugins: [
    solid({
      // Tests consume generated JavaScript; compact output avoids large pretty-printed intermediates.
      babel: { compact: true },
      ssr: true,
      dev: false,
      hot: false,
      solid: {
        generate: 'ssr',
      },
    }),
  ],
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/*.client.test.{ts,tsx}', '../internal/flower_ui/src/**/*.client.test.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', '../internal/flower_ui/src/**/*.test.ts'],
    maxWorkers: 1,
    testTimeout: 10_000,
  },
});
