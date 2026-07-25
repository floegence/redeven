import { defineConfig, mergeConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import axe from 'axe-core';
import { PNG } from 'pngjs';
import type { Frame, Page } from 'playwright';
import viteConfig from './vite.config';

const configuredBrowserPort = Number.parseInt(process.env.REDEVEN_VITEST_BROWSER_PORT ?? '', 10);

async function readinessFrame(page: Page): Promise<Frame> {
  for (const frame of page.frames()) {
    if (await frame.locator('.ai-readiness-boundary').count() > 0) return frame;
  }
  throw new Error('AI readiness test frame is unavailable');
}

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
        auditReadinessAccessibility: async ({ page }) => {
          const frame = await readinessFrame(page);
          await frame.addScriptTag({ content: axe.source });
          return frame.evaluate(async () => {
            const runtime = (globalThis as unknown as Readonly<{
              axe: Readonly<{
                run: (context: Element) => Promise<Readonly<{
                  violations: readonly Readonly<{
                    id: string;
                    impact: string | null;
                    description: string;
                    nodes: readonly Readonly<{ target: readonly unknown[] }>[];
                  }>[];
                }>>;
              }>;
            }>).axe;
            const root = document.querySelector('.ai-readiness-boundary');
            if (!root) throw new Error('AI readiness boundary is unavailable');
            const results = await runtime.run(root);
            return results.violations
              .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
              .map((violation) => ({
                id: violation.id,
                impact: violation.impact,
                description: violation.description,
                targets: violation.nodes.flatMap((node) => node.target.map(String)),
              }));
          });
        },
        inspectReadinessScreenshot: async ({ page }) => {
          const frame = await readinessFrame(page);
          const metrics = await frame.evaluate(() => ({
            cssWidth: window.innerWidth,
            cssHeight: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
          }));
          const screenshot = await frame.locator('body').screenshot({ type: 'png' });
          const image = PNG.sync.read(screenshot);
          const colorBuckets = new Set<string>();
          let opaquePixels = 0;
          for (let offset = 0; offset < image.data.length; offset += 4) {
            if (image.data[offset + 3] === 0) continue;
            opaquePixels += 1;
            colorBuckets.add(`${image.data[offset] >> 4}:${image.data[offset + 1] >> 4}:${image.data[offset + 2] >> 4}`);
          }
          return {
            width: image.width,
            height: image.height,
            opaquePixels,
            distinctColorBuckets: colorBuckets.size,
            ...metrics,
          };
        },
        sizeReadinessFrame: async ({ page }, size: Readonly<{ width: number; height: number }>) => {
          const frame = await readinessFrame(page);
          const frameElement = await frame.frameElement();
          await frameElement.evaluate((element, nextSize) => {
            Object.assign((element as HTMLElement).style, {
              position: 'fixed',
              inset: '0',
              width: `${nextSize.width}px`,
              height: `${nextSize.height}px`,
              zIndex: '2147483647',
            });
          }, size);
          await frame.waitForFunction(
            (nextSize) => window.innerWidth === nextSize.width && window.innerHeight === nextSize.height,
            size,
          );
        },
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
