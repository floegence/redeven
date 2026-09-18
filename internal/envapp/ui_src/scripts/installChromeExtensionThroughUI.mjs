/* global document */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);

// First-install acceptance uses Chrome's visible controls and the native folder
// picker. No load-extension flag, developerPrivate call or preinstalled profile.
export async function installChromeExtensionThroughUI(context, extension, extensionID, homePath, previousVersion) {
  assert.equal(process.platform, 'darwin', 'native folder-picker acceptance currently requires macOS');
  assert(Array.isArray(homePath) && homePath.length > 0 && homePath.every(part => typeof part === 'string' && part && !part.startsWith('.') && !part.includes('/')));
  assert.equal(path.join(os.homedir(), ...homePath), extension, 'visible route must locate the exact installation');
  const browser = await context.browser().newBrowserCDPSession();
  const { processInfo } = await browser.send('SystemInfo.getProcessInfo');
  const pid = processInfo.find(value => value.type === 'browser')?.id;
  assert(Number.isSafeInteger(pid) && pid > 0, 'identify the exact test Chrome process');
  const { stdout: args } = await execute('/bin/ps', ['-p', String(pid), '-o', 'command=']);
  assert(!args.includes('--no-sandbox') && !args.includes('--load-extension'), 'installation must start with sandbox enabled and no preloaded extension');
  const page = await context.newPage(); await page.goto('chrome://extensions/');
  const card = page.locator(`extensions-item[id="${extensionID}"]`);
  assert.equal(await card.count(), previousVersion ? 1 : 0, 'verify the exact starting installation');
  if (previousVersion) assert.equal((await card.locator('#version').textContent()).trim(), previousVersion);
  const developer = page.locator('extensions-toolbar #devMode');
  if (await developer.getAttribute('aria-pressed') !== 'true') await developer.click();
  await page.locator('extensions-toolbar #loadUnpacked').click();
  try {
    await execute('/usr/bin/swift', [fileURLToPath(new URL('./selectChromeExtensionFolder.swift', import.meta.url)), String(pid), ...homePath], { timeout: 30000 });
  } catch (error) { throw new Error('Chrome native folder navigation did not complete.', { cause: error }); }
  try { await card.waitFor({ state: 'visible', timeout: 10000 }); } catch (error) {
    const errors = await page.locator('extensions-load-error').locator('cr-dialog').allInnerTexts();
    throw new Error('Chrome did not accept the selected folder: ' + errors.join(' '), { cause: error });
  }
  if (previousVersion) await page.waitForFunction(({ extensionID, previousVersion }) => {
    const version = document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-item-list')?.shadowRoot?.querySelector(`extensions-item[id="${extensionID}"]`)?.shadowRoot?.querySelector('#version')?.textContent?.trim();
    return version && version !== previousVersion;
  }, { extensionID, previousVersion });
  return page;
}
