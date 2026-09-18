/* global chrome */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { stageBrowserExtension } from '../../../../scripts/stage_browser_extension.mjs';
import { installChromeExtensionThroughUI } from './installChromeExtensionThroughUI.mjs';

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
    assert.equal(await popup.evaluate(() => chrome.runtime.getManifest().version), '1.0.1');
    assert.equal(await page.locator('extensions-item[id="mgfbpkkmocckooenpdfpefknffjanjce"]').count(), 1);
    process.stdout.write(`Chrome Load unpacked label: ${await page.locator('extensions-toolbar #loadUnpacked').textContent()}\n`);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
    await rm(extension, { recursive: true, force: true });
    await rm(outdated, { recursive: true, force: true });
  }
});
