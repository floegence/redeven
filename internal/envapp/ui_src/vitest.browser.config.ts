import { defineConfig, mergeConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import axe from 'axe-core';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import type { Frame, Page } from 'playwright';
import viteConfig from './vite.config';

const configuredBrowserPort = Number.parseInt(process.env.REDEVEN_VITEST_BROWSER_PORT ?? '', 10);

async function readinessFrame(page: Page): Promise<Frame> {
  for (const frame of page.frames()) {
    if (await frame.locator('.ai-readiness-boundary').count() > 0) return frame;
  }
  throw new Error('AI readiness test frame is unavailable');
}

async function terminalPanelFrame(page: Page): Promise<Frame> {
  for (const frame of page.frames()) {
    if (await frame.locator('[data-testid="terminal-content"]').count() > 0) return frame;
  }
  throw new Error('Terminal panel test frame is unavailable');
}

function hashPngRegion(
  image: ReturnType<typeof PNG.sync.read>,
  region: Readonly<{ x: number; y: number; width: number; height: number }>,
): string {
  const hash = createHash('sha256');
  const left = Math.max(0, Math.min(image.width, Math.floor(region.x)));
  const top = Math.max(0, Math.min(image.height, Math.floor(region.y)));
  const right = Math.max(left, Math.min(image.width, Math.ceil(region.x + region.width)));
  const bottom = Math.max(top, Math.min(image.height, Math.ceil(region.y + region.height)));
  for (let row = top; row < bottom; row += 1) {
    const start = (row * image.width + left) * 4;
    const end = (row * image.width + right) * 4;
    hash.update(image.data.subarray(start, end));
  }
  return hash.digest('hex');
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
        inspectTerminalSharedGeometryScreenshot: async ({ page }) => {
          const frame = await terminalPanelFrame(page);
          const body = frame.locator('body');
          const terminal = frame.locator('[data-testid="terminal-content"]').first();
          const [bodyBox, terminalBox, screenshot] = await Promise.all([
            body.boundingBox(),
            terminal.boundingBox(),
            body.screenshot({ type: 'png' }),
          ]);
          if (!bodyBox || !terminalBox) throw new Error('Terminal screenshot geometry is unavailable');
          const image = PNG.sync.read(screenshot);
          const scaleX = image.width / bodyBox.width;
          const scaleY = image.height / bodyBox.height;
          const safeCanvasRegion = {
            x: (terminalBox.x - bodyBox.x) * scaleX,
            y: (terminalBox.y - bodyBox.y) * scaleY,
            width: Math.max(1, Math.min(32, terminalBox.width * scaleX)),
            height: Math.max(1, Math.min(32, terminalBox.height * scaleY)),
          };
          return {
            fullHash: createHash('sha256').update(image.data).digest('hex'),
            safeCanvasHash: hashPngRegion(image, safeCanvasRegion),
            canvasWidth: terminalBox.width,
            canvasHeight: terminalBox.height,
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
