import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  optimizeDeps: {
    include: [
      '@chenglou/pretext',
      '@floegence/flowersec-core/streamio',
      'docx-preview',
      'exceljs',
    ],
    exclude: ['@floegence/floe-webapp-core'],
  },
  test: {
    include: ['src/**/*.browser.test.tsx'],
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [
        {
          browser: 'chromium',
        },
      ],
    },
  },
}));
