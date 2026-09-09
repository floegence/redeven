import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
  resolve: { conditions: ['browser'], dedupe: ['solid-js'] },
  plugins: [solid({ dev: false, hot: false })],
  test: {
    environment: 'jsdom',
    include: ['src/welcome/**/*.client.test.tsx'],
    maxWorkers: 1,
  },
});
