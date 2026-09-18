import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { stageBrowserExtension } from '../../../../scripts/stage_browser_extension.mjs';
import { installChromeExtensionThroughUI } from './installChromeExtensionThroughUI.mjs';

test('Chrome installs from visible home folders without path entry or hidden files', {
  skip: process.env.REDEVEN_CHROME_INSTALL_QUALIFICATION !== '1', timeout: 45000,
}, async () => {
  assert.equal(process.platform, 'darwin', 'this qualification needs macOS native picker access');
  const profile = await mkdtemp(path.join(os.tmpdir(), 'flower-install-profile-'));
  const parent = path.join(os.homedir(), 'Redeven');
  await mkdir(parent, { recursive: true });
  const extension = await mkdtemp(path.join(parent, 'Flower Browser Test '));
  const homePath = ['Redeven', path.basename(extension)];
  let context;
  try {
    stageBrowserExtension(extension);
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome', headless: false, chromiumSandbox: true, ignoreDefaultArgs: ['--disable-extensions'],
    });
    const page = await installChromeExtensionThroughUI(context, extension, 'mgfbpkkmocckooenpdfpefknffjanjce', homePath);
    assert.equal(await page.locator('extensions-item[id="mgfbpkkmocckooenpdfpefknffjanjce"]').count(), 1);
    process.stdout.write(`Chrome Load unpacked label: ${await page.locator('extensions-toolbar #loadUnpacked').textContent()}\n`);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
    await rm(extension, { recursive: true, force: true });
  }
});
