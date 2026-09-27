import { defineConfig, mergeConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import axe from 'axe-core';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CDPSession, Frame, Page } from 'playwright';
import viteConfig from './vite.config';
import { dragViewerHandle, qualifyComputerLauncherTouch, qualifyComputerViewer, qualifyComputerViewerSurface } from './scripts/computerViewerInteraction.mjs';

const configuredBrowserPort = Number.parseInt(process.env.REDEVEN_VITEST_BROWSER_PORT ?? '', 10);
const touchSessions = new WeakMap<Page, CDPSession>();

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

async function frameForSelector(page: Page, selector: string): Promise<Frame> {
  for (const frame of page.frames()) {
    if (await frame.locator(selector).count() > 0) return frame;
  }
  throw new Error(`Browser test frame is unavailable for selector: ${selector}`);
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
        contextOptions: process.env.REDEVEN_PROGRESS_SHIMMER_VIDEO_DIR
          ? { recordVideo: { dir: process.env.REDEVEN_PROGRESS_SHIMMER_VIDEO_DIR, size: { width: 1200, height: 850 } } }
          : undefined,
        connectOptions: process.env.REDEVEN_VITEST_BROWSER_WS ? { wsEndpoint: process.env.REDEVEN_VITEST_BROWSER_WS, exposeNetwork: '<loopback>' } : undefined,
        launchOptions: {
          // Keep scrollbar layout observable in headless geometry checks.
          ignoreDefaultArgs: ['--hide-scrollbars'],
          args: ['--enable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
        },
      }),
      api: Number.isInteger(configuredBrowserPort) && configuredBrowserPort > 0
        ? { port: configuredBrowserPort }
        : undefined,
      commands: {
        hostApplicationDisplayFixture: async ({ page }, html: string | null) => {
          const route = '**/__host_display_fixture__/index.html';
          await page.unroute(route);
          if (html !== null) await page.route(route, request => request.fulfill({contentType:'text/html', body:html}));
        },
        typeHostApplicationDisplayContent: async ({page}, activation: 'pixels' | 'keyboard') => {
          const frame = await frameForSelector(page, 'canvas[data-host-display-fixture]');
          if (activation === 'keyboard') await frame.parentFrame()!.locator('.mac-app-keyboard').click();
          else await frame.locator('canvas[data-host-display-fixture]').click({position:{x:120,y:120}});
          await page.keyboard.type('abc');
        },
        clickHostApplicationPointer: async ({page}) => {
          const frame=await frameForSelector(page,'.mac-app-canvas');
          await frame.locator('.mac-app-canvas').click();
        },
        savePdfEvidence: async (_context, base64: string, script: 'latin' | 'cjk') => {
          const output = path.resolve(__dirname, '.cache/pdf-document-surface');
          await mkdir(output, { recursive: true });
          await writeFile(path.join(output, `saved-${script}.pdf`), Buffer.from(base64, 'base64'));
        },
        recordPdfEvidence: async ({ page }, metrics: { firstPaintMs: number; canvases: number }) => {
          const output = path.resolve(__dirname, '.cache/pdf-document-surface');
          await mkdir(output, { recursive: true });
          await writeFile(path.join(output, 'long-document.json'), JSON.stringify({
            ...metrics, pages: 300, browser: page.context().browser()?.version(),
            scope: 'Local fixture stream; includes document metadata and first text layer; not a network benchmark.',
          }, null, 2));
        },
        selectPdfText: async ({ page }, text: string) => {
          const frame = await frameForSelector(page, '.pdf-preview-pane .textLayer');
          await frame.evaluate(() => document.getSelection()?.removeAllRanges());
          const span = frame.locator('.pdf-preview-pane .textLayer span').filter({ hasText: text }).first();
          await span.scrollIntoViewIfNeeded();
          const rect = await span.boundingBox();
          if (!rect) throw new Error('PDF text is unavailable');
          await page.mouse.move(rect.x + 1, rect.y + rect.height / 2);
          await page.mouse.down();
          await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, { steps: 12 });
          await page.mouse.up();
          const selection = await frame.evaluate(() => document.getSelection()?.toString());
          await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
          const clipboard = await frame.evaluate(() => navigator.clipboard.readText());
          return { selection, clipboard };
        },
        inspectComputerProgress: async ({ page }, theme: string) => {
          const frame = await frameForSelector(page, '.flower-computer-entry');
          const selectors = ['.flower-computer-entry', '.flower-computer-stage-ball'];
          const freeze = (time: number) => frame.evaluate(time => {
            for (const animation of document.getAnimations()) {
              animation.pause(); animation.currentTime = time;
            }
          }, time);
          const changed = [];
          for (const selector of selectors) {
            const control = frame.locator(selector);
            const before = await control.boundingBox();
            await freeze(0);
            const first = PNG.sync.read(await control.screenshot({ animations: 'allow' }));
            await freeze(1200);
            const second = PNG.sync.read(await control.screenshot({ animations: 'allow' }));
            if (JSON.stringify(before) !== JSON.stringify(await control.boundingBox())) throw new Error('Progress paint moved its control');
            let count = 0;
            for (let i = 0; i < first.data.length; i += 4) {
              const difference = [0, 1, 2].reduce((sum, channel) => sum + second.data[i + channel] - first.data[i + channel], 0);
              if (difference > 15) count++;
            }
            changed.push(count);
          }
          const output = process.env.REDEVEN_COMPUTER_PROGRESS_EVIDENCE;
          if (output && ['classic-light', 'classic-dark'].includes(theme)) {
            await mkdir(path.join(output, theme), { recursive: true });
            for (let index = 0; index < 12; index++) {
              await freeze(index * 200);
              await page.screenshot({ path: path.join(output, theme, `frame-${String(index).padStart(2, '0')}.png`), animations: 'allow' });
            }
          }
          try {
            for (const media of [{ reducedMotion: 'reduce' }, { forcedColors: 'active' }] as const) {
              await page.emulateMedia(media);
              for (const selector of [...selectors, '.flower-computer-entry-label']) {
                const animated = await frame.locator(selector).evaluate(element => {
                  const view = element.ownerDocument.defaultView!;
                  return [view.getComputedStyle(element).animationName, view.getComputedStyle(element, '::before').animationName].some(name => name !== 'none');
                });
                if (animated) throw new Error('Accessible display preferences must stop the shimmer');
              }
              await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
            }
            return { changed, reducedMotion: true, forcedColors: true };
          } finally {
            await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
            await frame.evaluate(() => document.getAnimations().forEach(animation => animation.play()));
          }
        },
        inspectProgressShimmerPaint: async ({ page }, name: string, measurements: unknown) => {
          if (!/^[a-z-]+$/u.test(name)) throw new Error('Invalid progress evidence name');
          const frame = await frameForSelector(page, '[data-flower-activity-item-id="tool-0"]');
          const freeze = async (time: number) => frame.evaluate((time) => {
            for (const animation of document.getAnimations()) {
              animation.pause();
              animation.currentTime = (animation as CSSAnimation).animationName === 'floe-progress-shimmer' ? time : 0;
            }
          }, time);
          const regions = [];
          for (const selector of [
            '[data-flower-activity-item-id="tool-0"] .flower-activity-inline-title',
            '[data-flower-activity-item-id="tool-1"] .flower-activity-inline-title',
            '.flower-model-status-text',
          ]) {
            const target = frame.locator(selector);
            await freeze(0);
            const bounds = await target.boundingBox();
            if (!bounds) throw new Error('Missing progress text bounds');
            const clip = { x: Math.floor(bounds.x), y: Math.floor(bounds.y), width: Math.ceil(bounds.x + bounds.width) - Math.floor(bounds.x), height: Math.ceil(bounds.y + bounds.height) - Math.floor(bounds.y) };
            const first = PNG.sync.read(await page.screenshot({ clip, animations: 'allow' }));
            await freeze(1200);
            const second = PNG.sync.read(await page.screenshot({ clip, animations: 'allow' }));
            if (JSON.stringify(await target.boundingBox()) !== JSON.stringify(bounds)) throw new Error('Progress motion changed text geometry');
            if (first.width !== second.width || first.height !== second.height) throw new Error('Progress motion changed text geometry');
            let changed = 0;
            let brightened = 0;
            let darkened = 0;
            let rasterNoisePixels = 0;
            const luminance = (data: Uint8Array, offset: number) => [0.2126, 0.7152, 0.0722].reduce((sum, weight, channel) => {
              const value = data[offset + channel] / 255;
              return sum + weight * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
            }, 0);
            let backgroundChanged = 0;
            for (let i = 0; i < first.data.length; i += 4) {
              const difference = Math.abs(first.data[i] - second.data[i]) + Math.abs(first.data[i + 1] - second.data[i + 1]) + Math.abs(first.data[i + 2] - second.data[i + 2]);
              if (difference > 15) changed++;
              const gain = luminance(second.data, i) - luminance(first.data, i);
              // Use the same visible-change floor as motion detection. Fractional
              // background-clip edges can quantize by a few RGB levels between
              // frames; report that noise separately from a visible dark band.
              if (gain > 0.003 && difference > 15) brightened++;
              if (gain < -0.003) {
                if (difference > 15) darkened++;
                else rasterNoisePixels++;
              }
              if (difference > 6 && first.data[i] === first.data[0] && first.data[i + 1] === first.data[1] && first.data[i + 2] === first.data[2]) backgroundChanged++;
            }
            regions.push({ selector, changed, brightened, darkened, rasterNoisePixels, backgroundChanged, width: first.width, height: first.height });
          }
          const output = path.resolve(__dirname, '.cache/progress-shimmer');
          await mkdir(output, { recursive: true });
          if (/classic-light|classic-dark|nord|solarized-light/u.test(name)) {
            await frame.locator('body').screenshot({ path: path.join(output, `${name}.png`), animations: 'allow' });
          }
          const result = { brightened: Math.min(...regions.map(region => region.brightened)), darkened: regions.reduce((sum, region) => sum + region.darkened, 0), changed: Math.min(...regions.map(region => region.changed)), backgroundChanged: regions.reduce((sum, region) => sum + region.backgroundChanged, 0), regions, measurements };
          await writeFile(path.join(output, `${name}.json`), JSON.stringify(result, null, 2));
          await frame.evaluate(() => document.getAnimations().forEach(animation => animation.play()));
          return result;
        },
        exerciseGitScrollbar: async ({ page }) => {
          const frame = await frameForSelector(page, '[data-floe-horizontal-scrollbar]');
          const track = frame.locator('[data-floe-horizontal-scrollbar]');
          const thumb = track.locator('[data-floe-horizontal-scrollbar-thumb]');
          const trackBox = (await track.boundingBox())!;
          const thumbBox = (await thumb.boundingBox())!;
          const x = thumbBox.x + thumbBox.width / 2;
          const y = thumbBox.y + thumbBox.height / 2;
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x + (trackBox.width - thumbBox.width) / 2, y, { steps: 8 });
          await page.mouse.up();
          const fraction = await track.evaluate((el) => Number(el.getAttribute('aria-valuenow')) / Number(el.getAttribute('aria-valuemax')));
          await page.mouse.click(trackBox.x + trackBox.width - 4, y);
          const afterTrackClick = await track.evaluate((el) => Number(el.getAttribute('aria-valuenow')) / Number(el.getAttribute('aria-valuemax')));
          return { fraction, afterTrackClick };
        },
        exerciseComputerLauncherTouch: async ({ page }) => {
          const frame = await frameForSelector(page, '.flower-computer-stage');
          return qualifyComputerLauncherTouch({ page, root: frame });
        },
        exerciseComputerViewer: async ({ page }) => {
          const frame = await frameForSelector(page, '.flower-computer-stage');
          return qualifyComputerViewer({ page, root: frame });
        },
        resizeComputerViewer: async ({ page }) => {
          const frame = await frameForSelector(page, '.flower-computer-stage');
          const handle = frame.locator('[data-floe-floating-window-resize-handle="se"]');
          await dragViewerHandle(page, handle, -80, -40);
        },
        exerciseComputerViewerSurface: async ({ page }, scenario: string) => {
          const frame = await frameForSelector(page, '.flower-computer-stage');
          const evidenceRoot = process.env.REDEVEN_COMPUTER_VIEWER_EVIDENCE;
          const output = evidenceRoot ? path.join(evidenceRoot, scenario) : undefined;
          if (output) await mkdir(output, { recursive: true });
          return qualifyComputerViewerSurface({ page, root: frame, output });
        },
        composeComputerStageText: async ({ page }, text: string) => {
          const frame = await frameForSelector(page, '.flower-computer-stage-frame');
          await frame.locator('.flower-computer-stage-frame').focus();
          const session = await page.context().newCDPSession(page);
          try {
            await session.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
            const beforeCommit = await frame.locator('.flower-computer-stage').getAttribute('data-input-count');
            await session.send('Input.insertText', { text });
            await page.keyboard.type('ab');
            await page.keyboard.press('Tab');
            await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
            await frame.evaluate(() => navigator.clipboard.writeText('paste'));
            await page.keyboard.press('ControlOrMeta+V');
            return { beforeCommit };
          } finally {
            await page.context().clearPermissions();
            await session.detach();
          }
        },
        clickBrowserDocument: async ({ page }, selector: string, position?: { x: number; y: number }) => {
          const frame = await frameForSelector(page, '.redeven-browser-document-surface');
          await frame.locator(selector).first().click({ position });
        },
        dismissPluginCenterBackdrop: async ({ page }) => {
          const frame = await frameForSelector(page, '[data-test-workbench-background]');
          const target = await frame.locator('[data-test-background]').boundingBox();
          if (!target) throw new Error('Plugin Center background target is unavailable');
          const x = target.x + 8;
          const y = target.y + 8;
          // Native pointer events must exercise hit testing during the transition;
          // locator clicks intentionally wait until moving elements settle.
          await page.mouse.click(x, y);
          const isolatedDuringExit = await frame.locator('[data-test-workbench-background]').evaluate((element) => element.hasAttribute('inert'));
          await page.mouse.click(x, y);
          return { isolatedDuringExit };
        },
        dragWorkbenchPlugin: async ({ page }, delta: Readonly<{ x: number; y: number }>) => {
          const frame = await frameForSelector(page, '[data-plugin-continuity-canvas]');
          const handle = frame.locator('[data-floe-workbench-widget-id="plugin-continuity"] .workbench-widget__drag');
          const rect = await handle.boundingBox();
          if (!rect) throw new Error('Plugin drag handle is unavailable');
          const x = rect.x + rect.width / 2;
          const y = rect.y + rect.height / 2;
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x + delta.x, y + delta.y, { steps: 12 });
          await page.mouse.up();
        },
        wheelScrollRegion: async (
          { page },
          request: Readonly<{
            regionSelector: string;
            targetSelector?: string;
            deltaY: number;
          }>,
        ) => {
          const frame = await frameForSelector(page, request.regionSelector);
          const region = frame.locator(request.regionSelector).first();
          const target = request.targetSelector
            ? frame.locator(request.targetSelector).first()
            : region;
          const before = await region.evaluate((element) => element.scrollTop);
          await target.hover();
          await page.mouse.wheel(0, request.deltaY);
          await page.waitForTimeout(50);
          const after = await region.evaluate((element) => element.scrollTop);
          return { before, after };
        },
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
        inspectFlowerApprovalZoom: async ({ page }) => {
          const frame = await frameForSelector(page, '.flower-approval-surface');
          const session = await page.context().newCDPSession(page);
          const viewport = page.viewportSize();
          const frameElement = await frame.frameElement();
          const frameStyle = await frameElement.getAttribute('style');
          const hostStyle = await frameElement.evaluate(element => element.parentElement!.getAttribute('style'));
          try {
            // Match 200% browser zoom: halve the CSS viewport and double pixel density.
            await session.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 400, deviceScaleFactor: 2, mobile: false });
            await frameElement.evaluate(element => {
              element.parentElement!.style.setProperty('transform', 'none', 'important');
              Object.assign((element as HTMLElement).style, { position: 'fixed', inset: '0', width: '640px', height: '400px', transform: 'none' });
            });
            await frame.waitForFunction(() => window.devicePixelRatio === 2 && window.innerWidth === 640);
            await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const geometry = await frame.evaluate(() => {
              const shell = document.querySelector<HTMLElement>('[data-floe-bottom-bar-companion]')!;
              const surface = shell.querySelector<HTMLElement>('.flower-decision-surface')!;
              const bounds = shell.getBoundingClientRect();
              const clippedControls = [...shell.querySelectorAll('.flower-approval-queue-footer button')].filter(button => {
                const rect = button.getBoundingClientRect();
                return rect.top < bounds.top || rect.bottom > bounds.bottom || rect.left < bounds.left || rect.right > bounds.right;
              }).length;
              return { devicePixelRatio: window.devicePixelRatio, viewportWidth: window.innerWidth,
                overflow: surface.scrollWidth - surface.clientWidth, clippedControls };
            });
            const capture = await session.send('Page.captureScreenshot', { format: 'png' });
            const screenshot = Buffer.from(capture.data, 'base64');
            const output = path.resolve(__dirname, '.vitest-attachments');
            await mkdir(output, { recursive: true });
            await writeFile(path.join(output, 'approval-200-percent-zoom.png'), screenshot);
            return { ...geometry, screenshotWidth: PNG.sync.read(screenshot).width };
          } finally {
            await frameElement.evaluate((element, styles) => {
              for (const [target, style] of [[element, styles.frame], [element.parentElement!, styles.host]] as const) {
                if (style === null) target.removeAttribute('style');
                else target.setAttribute('style', style);
              }
            }, { frame: frameStyle, host: hostStyle });
            await session.send('Emulation.clearDeviceMetricsOverride');
            await session.detach();
            if (viewport) await page.setViewportSize(viewport);
          }
        },
        inspectWebServicesZoom: async ({ page }) => {
          const frame = await frameForSelector(page, '.web-services');
          const session = await page.context().newCDPSession(page);
          const viewport = page.viewportSize();
          const frameElement = await frame.frameElement();
          const frameStyle = await frameElement.getAttribute('style');
          const frameHostStyle = await frameElement.evaluate((element) => element.parentElement!.getAttribute('style'));
          try {
            // Model browser zoom with half the CSS viewport and twice the pixel density.
            // Keep zoom at the browser boundary instead of changing fixture typography.
            await session.send('Emulation.setDeviceMetricsOverride', {
              width: 720, height: 480, deviceScaleFactor: 2, mobile: false,
            });
            await frameElement.evaluate((element) => {
              element.parentElement!.style.setProperty('transform', 'none', 'important');
              Object.assign((element as HTMLElement).style, { position: 'fixed', inset: '0', width: '720px', height: '480px', transform: 'none', zIndex: '2147483647' });
            });
            await frame.waitForFunction(() => window.devicePixelRatio === 2 && window.innerWidth === 720);
            const geometry = await frame.evaluate(() => {
              const surface = document.querySelector<HTMLElement>('.web-services')!;
              const rows = Array.from(surface.querySelectorAll<HTMLElement>('[data-testid="managed-service-row"], [data-testid="port-forward-row"]'));
              const overflow = rows.flatMap((row) => {
                const bounds = row.getBoundingClientRect();
                return Array.from(row.querySelectorAll<HTMLElement>('button, [data-testid="managed-service-status"], [data-testid="managed-service-notice"]'))
                  .filter((child) => {
                    if (!child.getClientRects().length) return false;
                    const rect = child.getBoundingClientRect();
                    return rect.left < bounds.left - 1 || rect.right > bounds.right + 1
                      || rect.bottom > bounds.bottom + 1 || child.scrollWidth > child.clientWidth + 1;
                  }).map((child) => child.textContent);
              });
              return {
                devicePixelRatio: window.devicePixelRatio,
                viewportWidth: window.innerWidth,
                cssWidth: surface.getBoundingClientRect().width,
                surfaceOverflow: surface.scrollWidth - surface.clientWidth,
                mainOverflow: surface.querySelector('main')!.scrollWidth - surface.querySelector('main')!.clientWidth,
                overflow,
              };
            });
            const capture = await session.send('Page.captureScreenshot', { format: 'png' });
            const screenshot = PNG.sync.read(Buffer.from(capture.data, 'base64'));
            return { ...geometry, pixelWidth: screenshot.width };
          } finally {
            await frameElement.evaluate((element, styles) => {
              for (const [target, style] of [[element, styles.frame], [element.parentElement!, styles.host]] as const) {
                if (style === null) target.removeAttribute('style');
                else target.setAttribute('style', style);
              }
            }, { frame: frameStyle, host: frameHostStyle });
            await session.send('Emulation.clearDeviceMetricsOverride');
            await session.detach();
            if (viewport) await page.setViewportSize(viewport);
          }
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
        emulateTouchInput: async ({ page }, enabled: boolean) => {
          if (enabled) {
            const session = touchSessions.get(page) ?? await page.context().newCDPSession(page);
            touchSessions.set(page, session);
            await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
          } else {
            const session = touchSessions.get(page);
            if (!session) return;
            await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
            touchSessions.delete(page);
            await session.detach();
          }
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
