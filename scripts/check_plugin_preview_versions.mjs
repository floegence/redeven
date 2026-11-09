import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { expect } from '../internal/envapp/ui_src/node_modules/playwright/test.mjs';

const [origin, evidence] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
page.setDefaultTimeout(15000);
const report = { scope: 'Real released Host, immutable artifacts, product workspace and dedicated-origin sandbox; fixture session and application', assertions: [], errors: [], passed: false };
page.on('pageerror', error => report.errors.push(error.message));
try {
  await mkdir(path.dirname(evidence), { recursive: true });
  await page.goto(origin);
  const configuration = await (await page.request.get(new URL('/qualification.json', origin).href)).json();
  const frame = page.frameLocator('iframe');
  const status = async () => (await (await page.request.get(new URL(`/_redevplugin/api/plugins/author/workspaces/${configuration.workspaceID}/status`, origin).href, { headers: { Origin: origin } })).json()).data;
  const build = async (version, title) => {
    const response = await page.request.post(new URL('/qualification/build', origin).href, { data: { version, title } });
    assert.equal(response.status(), 200, await response.text());
    return (await response.json()).data;
  };
  const select = async (name, mobile = false) => {
    if (mobile) {
      await page.getByRole('button', { name: 'More actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Preview versions', exact: true }).click();
    } else await page.getByRole('button', { name: 'Preview versions', exact: true }).click();
    await page.getByRole('menuitem', { name }).click();
  };
  await frame.getByRole('heading', { name: 'First revision', exact: true }).waitFor();
  const firstOrigin = new URL(await page.locator('iframe').getAttribute('src')).origin;
  assert.notEqual(new URL(firstOrigin).hostname, new URL(origin).hostname);
  const second = await build('2.0.0', 'Second revision');
  await frame.getByRole('heading', { name: 'Second revision', exact: true }).waitFor();
  assert.equal((await status()).preview.artifact_id, second.artifact_id);
  assert.notEqual(new URL(await page.locator('iframe').getAttribute('src')).origin, firstOrigin);
  await frame.getByRole('button', { name: 'Count 0', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Count 1', exact: true })).toBeVisible();
  report.assertions.push('Successful build automatically replaces actual iframe content through a fresh origin and its interaction works');
  await select(/^Build 1 ·/);
  await frame.getByRole('heading', { name: 'First revision', exact: true }).waitFor();
  assert.equal((await status()).preview.artifact_id, configuration.firstArtifact);
  const third = await build('2.0.0', 'Third revision');
  await expect.poll(async () => (await status()).artifacts.length).toBe(3);
  await expect(page.locator('.plugin-creation-version-label')).toHaveText('Build 1');
  await page.reload();
  await frame.getByRole('heading', { name: 'First revision', exact: true }).waitFor();
  assert.equal((await status()).preview.artifact_id, configuration.firstArtifact);
  report.assertions.push('Historical artifact stays pinned through later builds and page reload without rewriting source');
  await select('Follow latest');
  await frame.getByRole('heading', { name: 'Third revision', exact: true }).waitFor();
  assert.equal((await status()).preview.artifact_id, third.artifact_id);
  await page.getByRole('button', { name: 'Preview versions', exact: true }).click();
  await page.screenshot({ path: evidence.replace('.json', '-light.png') });
  await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.getByRole('button', { name: 'Preview versions', exact: true }).click();
  await page.screenshot({ path: evidence.replace('.json', '-dark.png') });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await select(/^Build 2 ·/, true);
  await frame.getByRole('heading', { name: 'Second revision', exact: true }).waitFor();
  assert.equal((await status()).preview.artifact_id, second.artifact_id);
  await select('Follow latest', true);
  await frame.getByRole('heading', { name: 'Third revision', exact: true }).waitFor();
  await page.screenshot({ path: evidence.replace('.json', '-mobile.png') });
  assert.equal(await page.locator('[data-plugin-creation-workspace]').evaluate(element => element.scrollWidth > innerWidth), false);
  report.assertions.push('Same-SemVer builds remain distinct and mobile history selection restores exact bytes');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.error = String(error);
  await page.screenshot({ path: evidence.replace('.json', '-failure.png') });
  throw error;
} finally {
  await writeFile(evidence, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
