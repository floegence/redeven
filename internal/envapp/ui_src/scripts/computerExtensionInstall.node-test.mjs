/* global chrome */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { stageBrowserExtension } from '../../../../scripts/stage_browser_extension.mjs';
import { installChromeExtensionThroughUI } from './installChromeExtensionThroughUI.mjs';

test('staged extension ships Redeven branding and every declared icon from the canonical assets', async () => {
  const extension = await mkdtemp(path.join(os.tmpdir(), 'redeven-extension-brand-'));
  try {
    stageBrowserExtension(extension);
    const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
    assert.equal(manifest.name, 'Redeven Flower');
    assert.equal(manifest.action.default_title, 'Redeven Flower');
    assert.deepEqual(Object.keys(manifest.icons), ['16', '32', '48', '128']);
    for (const [size, asset] of [...Object.entries(manifest.icons), ...Object.entries(manifest.action.default_icon)]) {
      const icon = await readFile(path.join(extension, asset));
      const canonical = await readFile(new URL(`../../../../assets/brand/redeven/png/app-icon-${size}.png`, import.meta.url));
      assert.deepEqual(icon, canonical);
      assert.equal(icon.readUInt32BE(16), Number(size));
      assert.equal(icon.readUInt32BE(20), Number(size));
    }
  } finally { await rm(extension, { recursive: true, force: true }); }
});

test('Chrome installs and replaces an old extension from another visible folder', {
  skip: process.env.REDEVEN_CHROME_INSTALL_QUALIFICATION !== '1', timeout: 45000,
}, async () => {
  assert.equal(process.platform, 'darwin', 'this qualification needs macOS native picker access');
  const profile = await mkdtemp(path.join(os.tmpdir(), 'flower-install-profile-'));
  const parent = path.join(os.homedir(), 'Redeven');
  await mkdir(parent, { recursive: true });
  const extension = await mkdtemp(path.join(parent, 'Flower Browser Test '));
  const homePath = ['Redeven', path.basename(extension)];
  const outdated = await mkdtemp(path.join(parent, 'Flower Browser Previous Test '));
  let context;
  try {
    stageBrowserExtension(extension); stageBrowserExtension(outdated);
    const previousManifest = JSON.parse(await readFile(path.join(outdated, 'manifest.json'), 'utf8'));
    previousManifest.version = '1.0.0';
    await writeFile(path.join(outdated, 'manifest.json'), JSON.stringify(previousManifest));
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome', headless: false, chromiumSandbox: true, ignoreDefaultArgs: ['--disable-extensions'],
    });
    await installChromeExtensionThroughUI(context, outdated, 'mgfbpkkmocckooenpdfpefknffjanjce', ['Redeven', path.basename(outdated)]);
    const page = await installChromeExtensionThroughUI(context, extension, 'mgfbpkkmocckooenpdfpefknffjanjce', homePath, '1.0.0');
    const popup = await context.newPage(); await popup.goto('chrome-extension://mgfbpkkmocckooenpdfpefknffjanjce/popup.html');
    assert.equal(await popup.evaluate(() => chrome.runtime.getManifest().version), '1.0.2');
    assert.equal(await page.locator('extensions-item[id="mgfbpkkmocckooenpdfpefknffjanjce"]').count(), 1);
    process.stdout.write(`Chrome Load unpacked label: ${await page.locator('extensions-toolbar #loadUnpacked').textContent()}\n`);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
    await rm(extension, { recursive: true, force: true });
    await rm(outdated, { recursive: true, force: true });
  }
});
