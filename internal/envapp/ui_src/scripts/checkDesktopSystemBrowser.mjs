/* global window, chrome, document, getComputedStyle */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installChromeExtensionThroughUI } from './installChromeExtensionThroughUI.mjs';
import { createComputerTask, openComputerStage } from './computerTaskQualification.mjs';

// Real product carriers, Runtime, extension, Native Messaging and browser pages.
// Only the model is scripted. All state and browser profiles belong to this run.
const cdp = process.env.REDEVEN_DESKTOP_CDP, output = process.env.REDEVEN_COMPUTER_EVIDENCE_DIR;
assert(cdp && output && path.isAbsolute(output), 'task-owned Desktop CDP and evidence directory required');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const desktop = await chromium.connectOverCDP(cdp);
const welcome = desktop.contexts()[0].pages().find(page => page.url() === new URL('desktop/dist/welcome/index.html', `file://${root}`).href);
assert(welcome, 'CDP must belong to this worktree');
const request = (method, url, body) => welcome.evaluate(async ({ method, url, body }) => {
  const result = await window.redevenDesktopSettings.requestRuntimeFlower({ method, path: url, ...(body ? { body } : {}) });
  if (!result.ok) throw new Error(result.error.code);
  return result.data;
}, { method, url, body });
const wait = async (check, label) => {
  const until = Date.now() + 20000;
  while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error(`${label} timed out`);
};
let release, calls = 0, candidate, providerFailure;
const readCandidate = value => {
  if (typeof value === 'string') { try { return readCandidate(JSON.parse(value)); } catch { return; } }
  if (!value || typeof value !== 'object') return;
  if (value.new_tab && value.kind === 'browser.connected' && value.state === 'ready') return value.candidate_ref;
  for (const child of Object.values(value)) { const found = readCandidate(child); if (found) return found; }
};
const fixture = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><title>System browser fixture</title><h1>Verified system page</h1><input aria-label="Unsubmitted form">');
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${fixture.address().port}`;
const provider = http.createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw), active = body.tools?.length > 0;
    res.setHeader('Content-Type', 'text/event-stream');
    const send = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
    if (active) calls++;
    if (active && calls <= 5) {
      if (calls === 3) { candidate = readCandidate(body.input); assert(candidate, 'system discovery returned no connected task-tab candidate'); }
      if (calls === 5) await new Promise(resolve => { release = resolve; });
      const name = calls <= 2 ? 'computer_targets' : calls === 3 ? 'computer_select_target' : calls === 4 ? 'browser_navigate' : 'computer_observe';
      const args = calls <= 2 ? { browser_source: 'system' } : calls === 3 ? { candidate_ref: candidate } : calls === 4 ? { url: origin } : {};
      const item = { type: 'function_call', id: `fc_system_${calls}`, call_id: `system-${calls}`, name, arguments: JSON.stringify(args) };
      send({ type: 'response.output_item.added', output_index: 0, item });
      send({ type: 'response.output_item.done', output_index: 0, item });
      send({ type: 'response.completed', response: { id: `system-result-${calls}`, status: 'completed', output: [item] } });
    } else {
      send({ type: 'response.output_text.delta', delta: 'System browser verified.' });
      send({ type: 'response.completed', response: { id: 'system-done', status: 'completed', usage: { input_tokens: 1, output_tokens: 1 } } });
    }
    res.end('data: [DONE]\n\n');
  } catch (error) { providerFailure = error; res.end(); }
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const directory = await mkdtemp(path.join(os.tmpdir(), 'flower-system-browser-'));
let personal, threadID, page = welcome;
try {
  await mkdir(output, { recursive: true });
  await welcome.evaluate(() => window.redevenDesktopLanguage.setPreference('en-US'));
  await request('PUT', '/_redeven_proxy/api/ai/provider_bundle', {
    model_profile: { current_model_id: 'fixture/gpt-5-mini', providers: [{ id: 'fixture', name: 'System browser fixture', type: 'openai', base_url: `http://127.0.0.1:${provider.address().port}/v1`, models: [{ model_name: 'gpt-5-mini', input_modalities: ['text','image'], context_window: 400000, max_output_tokens: 8192 }] }] },
    provider_api_key_patches: [{ provider_id: 'fixture', api_key: 'fixture-only' }], web_search_provider_key_patches: [],
  });
  await request('PUT', '/_redeven_proxy/api/ai/default_permission', { permission_type: 'full_access' });
  await request('PUT', '/_redeven_proxy/api/ai/computer_use', { enabled: true });
  if (process.env.REDEVEN_COMPUTER_SURFACE === 'env') {
    const opened = await welcome.evaluate(() => window.redevenDesktopLauncher.performAction({ kind: 'open_local_environment', environment_id: 'local', route: 'local_host' }));
    assert(opened.ok, 'Env App must open through its actual Desktop route');
    await wait(() => desktop.contexts()[0].pages().some(value => value.url().includes('/_redeven_proxy/env/')), 'Env App page');
    page = desktop.contexts()[0].pages().find(value => value.url().includes('/_redeven_proxy/env/'));
  } else await welcome.reload();
  await page.setViewportSize({ width: 1280, height: 900 });
  if (!await page.locator('.flower-surface').count()) await page.getByRole('button', { name: /^Flower(?: \+)?$/ }).click();
  threadID = await createComputerTask({ page, request, origin });
  await page.locator('.flower-surface textarea').first().fill('Use my system browser to open the fixture and verify it.');
  await page.locator('.flower-surface textarea').first().press('Enter');
  await page.getByRole('button', { name: 'Connect Chrome', exact: true }).waitFor();
  assert.equal(calls, 1); assert.equal((await request('GET', `/_redeven_proxy/api/ai/computer/target?thread_id=${threadID}`)).target_id, '');
  await page.getByRole('button', { name: 'Connect Chrome', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect Chrome', exact: true });
  await dialog.getByRole('textbox', { name: 'Extension folder', exact: true }).waitFor();
  assert.equal(await dialog.getByRole('textbox').count(), 1, 'no internal native-host field');
  const extension = await dialog.getByRole('textbox', { name: 'Extension folder', exact: true }).inputValue();
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return dialog && Number(getComputedStyle(dialog).opacity) > 0.99 && dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running');
  });
  await page.screenshot({ path: path.join(output, 'chrome-connection-guide.png'), animations: 'disabled' });
  if (page === welcome) {
    await welcome.evaluate(() => window.redevenDesktopLanguage.setPreference('zh-CN'));
    await page.getByRole('dialog', { name: '连接 Chrome', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'chrome-connection-guide-zh-CN.png'), animations: 'disabled' });
    await welcome.evaluate(() => window.redevenDesktopLanguage.setPreference('en-US'));
    await dialog.waitFor();
  }
  const setup = await request('POST', '/_redeven_proxy/api/ai/computer/extension/setup');
  const nativeHost = setup.native_host;
  // Chrome's isolated user-data directory can hold the exact Runtime-generated
  // registration, leaving other profiles and their native hosts untouched.
  const manifestRoot = process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts') : path.join(os.homedir(), '.config/google-chrome/NativeMessagingHosts');
  const manifest = await readFile(path.join(manifestRoot, `${nativeHost}.json`));
  const profile = path.join(directory, 'profile'); await mkdir(path.join(profile, 'NativeMessagingHosts'), { recursive: true });
  await writeFile(path.join(profile, 'NativeMessagingHosts', `${nativeHost}.json`), manifest);
  personal = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, chromiumSandbox: true, ignoreDefaultArgs: ['--disable-extensions'] });
  const installation = await installChromeExtensionThroughUI(personal, extension, setup.extension_id);
  await installation.screenshot({ path: path.join(output, 'chrome-installed.png') });
  const existing = await personal.newPage(); await existing.goto(origin); await existing.getByRole('textbox').fill('keep my unfinished work');
  const popup = await personal.newPage(); await popup.goto(`chrome-extension://${setup.extension_id}/popup.html#${nativeHost}`);
  await popup.locator('#connect-button').click();
  await wait(async () => (await request('GET', '/_redeven_proxy/api/ai/computer/extension/profiles')).length === 1, 'real Native Messaging connection');
  await wait(() => release || providerFailure, 'task navigation'); if (providerFailure) throw providerFailure;
  const selected = (await request('GET', `/_redeven_proxy/api/ai/computer/target?thread_id=${threadID}`)).target_id;
  const target = (await request('GET', '/_redeven_proxy/api/ai/computer/targets')).find(value => value.id === selected);
  assert.equal(target.kind, 'browser.connected'); assert(!selected.startsWith('managed-'));
  assert.equal(await existing.getByRole('textbox').inputValue(), 'keep my unfinished work');
  const tabs = await request('GET', `/_redeven_proxy/api/ai/computer/extension/tabs?profile_id=${(await request('GET', '/_redeven_proxy/api/ai/computer/extension/profiles'))[0].id}`);
  const taskTab = tabs.find(value => selected.endsWith(`-${value.id}`)); assert(taskTab && taskTab.url === origin + '/');
  await openComputerStage(page); await wait(() => page.locator('.flower-computer-stage img').evaluateAll(images => images.some(img => img.naturalWidth > 0)), 'visible system-browser pixels');
  await page.getByRole('button', { name: 'View in browser', exact: true }).click();
  const worker = personal.serviceWorkers().find(value => value.url().endsWith('/background.mjs'));
  await wait(async () => String((await worker.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true })))[0]?.id) === taskTab.id, 'reveal exact task page');
  await page.screenshot({ path: path.join(output, 'system-browser-stage.png') });
  release();
  await wait(() => page.locator('.flower-surface').getAttribute('data-flower-selected-thread-status').then(value => value === 'success'), 'verified completion');
  assert.equal(calls, 6); assert.equal(await existing.getByRole('textbox').inputValue(), 'keep my unfinished work');
  await writeFile(path.join(output, 'system-browser.json'), JSON.stringify({ surface: process.env.REDEVEN_COMPUTER_SURFACE || 'desktop', source: target.kind, canonicalConnection: true, firstInstallThroughVisibleUI: true, sandboxEnabled: true, automaticContinuation: true, nativeMessaging: true, independentTaskTab: true, originalFormPreserved: true, visiblePixels: true, revealExactPage: true, completed: true }, null, 2));
  console.log('System-browser connection, independent task tab, Stage, reveal and verification passed.');
} finally {
  release?.();
  if (threadID) await request('DELETE', `/_redeven_proxy/api/ai/threads/${threadID}?force=true`).catch(() => undefined);
  await personal?.close(); await desktop.close();
  fixture.closeAllConnections(); provider.closeAllConnections(); fixture.close(); provider.close();
  await rm(directory, { recursive: true, force: true });
}
