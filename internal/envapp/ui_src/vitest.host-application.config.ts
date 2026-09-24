import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import base from './vitest.browser.config';

// Pointer and appearance contracts apply to desktop and mobile browser engines.
// Electron-only drag regions and codec qualification use their existing suites.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['src/styles/hostApplicationPointer.browser.test.tsx', 'src/styles/hostApplicationAppearance.browser.test.tsx'],
    browser: {
      ...base.test?.browser,
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
    },
  },
});
