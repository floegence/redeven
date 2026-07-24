import { defineConfig, mergeConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import viteConfig from './vite.config';

const configuredBrowserPort = Number.parseInt(process.env.REDEVEN_VITEST_BROWSER_PORT ?? '', 10);

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
      provider: playwright(),
      api: Number.isInteger(configuredBrowserPort) && configuredBrowserPort > 0
        ? { port: configuredBrowserPort }
        : undefined,
      commands: {
        emulateMediaPreferences: async (
          { page },
          preferences: {
            forcedColors?: null | 'active' | 'none';
            reducedMotion?: null | 'reduce' | 'no-preference';
          },
        ) => {
          await page.emulateMedia(preferences);
        },
      },
      instances: [
        {
          browser: 'chromium',
        },
      ],
    },
  },
}));
