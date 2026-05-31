import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

const coreDist = new URL('./node_modules/@floegence/floe-webapp-core/dist/', import.meta.url).pathname;
export default defineConfig({
  server: {
    fs: {
      allow: ['..'],
    },
  },
  resolve: {
    conditions: ['node'],
    alias: [
      { find: /^@floegence\/floe-webapp-core\/(icons|layout|loading|ui)$/, replacement: `${coreDist}$1.js` },
      { find: /^@floegence\/floe-webapp-core$/, replacement: `${coreDist}index.js` },
    ],
    dedupe: ['solid-js'],
  },
  plugins: [
    solid({
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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', '../internal/flower_ui/src/**/*.test.ts', '../internal/flower_ui/src/**/*.test.tsx'],
    testTimeout: 10_000,
  },
});
