import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../internal/envapp/ui_src/node_modules/vite/dist/node/index.js';
import { chromium } from '../internal/envapp/ui_src/node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [mode, destination, evidence] = process.argv.slice(2);
if (mode === '--build') {
  await build({
    root: path.join(root, 'internal/envapp/ui_src'),
    configFile: path.join(root, 'internal/envapp/ui_src/vite.config.ts'),
    base: '/',
    logLevel: 'error',
    build: {
      outDir: destination,
      emptyOutDir: true,
      manifest: false,
      cssCodeSplit: false,
      rolldownOptions: {
        input: path.join(root, 'internal/envapp/ui_src/src/test/pluginAuthorBrowser.fixture.tsx'),
        output: { entryFileNames: 'fixture.js' },
      },
    },
  });
  const css = (await readdir(path.join(destination, 'assets'))).filter((name) => name.endsWith('.css'));
  await writeFile(
    path.join(destination, 'index.html'),
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      css.map((name) => '<link rel="stylesheet" href="/assets/' + name + '">').join('') +
      '</head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
  );
} else if (mode === '--run') {
  const browser = await chromium.launch({ headless: true });
  const report = {
    scope:
      'Model-generated package in real product surface components and real platform Host; authenticated route fixture',
    passed: false,
    assertions: [],
  };
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await mkdir(path.dirname(evidence), { recursive: true });
    await page.goto(destination, { waitUntil: 'domcontentloaded' });
    const configuration = await (await page.request.get(new URL('/qualification.json', destination).href)).json();
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: 'Start', exact: true }).waitFor({ timeout: 30000 });
    await frame.getByText('25:00', { exact: true }).waitFor();
    const firstOrigin = await page.locator('iframe').getAttribute('src');
    assert.notEqual(new URL(firstOrigin).hostname, new URL(destination).hostname);
    await frame.getByRole('button', { name: 'Start', exact: true }).click();
    await frame.getByText('24:59', { exact: true }).waitFor({ timeout: 5000 });
    await frame.getByRole('button', { name: 'Pause', exact: true }).click();
    await frame.getByRole('button', { name: 'Reset', exact: true }).click();
    await frame.getByText('25:00', { exact: true }).waitFor();
    report.assertions.push('Generated timer starts, ticks, pauses and resets through the real sandbox');
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => document.documentElement.classList.toggle('dark', value === 'dark'), theme);
      await page.screenshot({ path: evidence.replace(/\.json$/, '-' + theme + '.png') });
    }
    if (configuration.formal) {
      await page.getByRole('button', { name: 'Close surface', exact: true }).click();
      await page.locator('iframe').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Reopen surface', exact: true }).click();
      await frame.getByRole('button', { name: 'Start', exact: true }).waitFor();
      const secondOrigin = await page.locator('iframe').getAttribute('src');
      assert.notEqual(new URL(firstOrigin).origin, new URL(secondOrigin).origin);
      report.assertions.push('Close and reopen allocate fresh surface identity and a new isolated origin');
    } else {
      await page.getByRole('button', { name: 'Install in this environment', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: 'Confirm installation', exact: true }).click();
      await page.getByRole('button', { name: 'Installed', exact: true }).waitFor({ timeout: 30000 });
      await page.reload();
      await page.getByRole('button', { name: 'Installed', exact: true }).waitFor({ timeout: 30000 });
      report.assertions.push(
        'Workspace reviews exact preview bytes, installs through the product adapter and recovers after reload',
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    if (!configuration.formal) await page.getByRole('tab', { name: 'Preview', exact: true }).click();
    await page.screenshot({ path: evidence.replace(/\.json$/, '-mobile.png') });
    assert.equal(await page.locator('#failure').textContent(), '');
    assert.deepEqual(errors, []);
    report.passed = true;
  } catch (error) {
    report.error = String(error);
    report.pageErrors = errors;
    report.productError = await page
      .locator('#failure')
      .textContent()
      .catch(() => null);
    await page.screenshot({ path: evidence.replace(/\.json$/, '-failure.png') });
    throw error;
  } finally {
    await writeFile(evidence, JSON.stringify(report, null, 2) + '\n');
    await browser.close();
  }
} else {
  throw new Error('Use --build <output> or --run <origin> <evidence.json>');
}
