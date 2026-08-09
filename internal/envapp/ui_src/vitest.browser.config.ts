import { defineConfig, mergeConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import axe from 'axe-core';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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

function inspectPaintedPixels(image: ReturnType<typeof PNG.sync.read>): Readonly<{
  paintedPixels: number;
  distinctColorBuckets: number;
}> {
  const buckets = new Map<string, number>();
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] === 0) continue;
    const key = `${image.data[offset] >> 3}:${image.data[offset + 1] >> 3}:${image.data[offset + 2] >> 3}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const [backgroundKey = '0:0:0'] = [...buckets.entries()]
    .sort((left, right) => right[1] - left[1])[0] ?? [];
  const [backgroundRed, backgroundGreen, backgroundBlue] = backgroundKey
    .split(':')
    .map((value) => Number(value) << 3);
  let paintedPixels = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] === 0) continue;
    const distance = Math.abs(image.data[offset] - backgroundRed)
      + Math.abs(image.data[offset + 1] - backgroundGreen)
      + Math.abs(image.data[offset + 2] - backgroundBlue);
    if (distance > 36) paintedPixels += 1;
  }
  return { paintedPixels, distinctColorBuckets: buckets.size };
}

export default mergeConfig(viteConfig, defineConfig({
  optimizeDeps: {
    include: [
      '@chenglou/pretext',
      'docx-preview',
      'exceljs',
    ],
    exclude: ['@floegence/floe-webapp-core'],
  },
  test: {
    fileParallelism: false,
    include: ['src/**/*.browser.test.tsx'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          args: ['--enable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
        },
      }),
      api: Number.isInteger(configuredBrowserPort) && configuredBrowserPort > 0
        ? { port: configuredBrowserPort }
        : undefined,
      commands: {
        installTerminalAgentIconRoutes: async ({ page }) => {
          await page.route('**/_redeven_proxy/env/agent-cli-icons/*.svg', async (route) => {
            const fileName = new URL(route.request().url()).pathname.split('/').at(-1) ?? '';
            if (!/^[a-z-]+\.svg$/.test(fileName)) {
              await route.abort();
              return;
            }
            try {
              const body = await readFile(new URL(`./public/agent-cli-icons/${fileName}`, import.meta.url));
              await route.fulfill({ status: 200, contentType: 'image/svg+xml', body });
            } catch {
              await route.fulfill({ status: 404, body: 'Not found' });
            }
          });
        },
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
        inspectTerminalAvatarScreenshot: async ({ page }, sessionId: string) => {
          const frame = await terminalPanelFrame(page);
          const avatar = frame.locator(`[data-terminal-session-avatar="${sessionId}"]`).first();
          const mark = avatar.locator('svg, img, .bg-current').filter({ visible: true }).first();
          const [avatarBox, markBox, screenshot] = await Promise.all([
            avatar.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return { width: rect.width, height: rect.height };
            }),
            mark.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return { width: rect.width, height: rect.height };
            }),
            avatar.screenshot({ type: 'png' }),
          ]);
          const image = PNG.sync.read(screenshot);
          return {
            screenshotHash: createHash('sha256').update(image.data).digest('hex'),
            avatarWidth: avatarBox.width,
            avatarHeight: avatarBox.height,
            markWidth: markBox.width,
            markHeight: markBox.height,
            totalPixels: image.width * image.height,
            ...inspectPaintedPixels(image),
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
