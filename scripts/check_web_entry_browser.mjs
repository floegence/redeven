import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../desktop/node_modules/esbuild/lib/main.js';
import { chromium, firefox, webkit } from '../internal/envapp/ui_src/node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(await readFile(process.argv[2], 'utf8'));
const controlURL = new URL(fixture.control);
if (controlURL.protocol !== 'http:' || controlURL.hostname !== '127.0.0.1' || controlURL.username || controlURL.password || controlURL.pathname !== '/' || controlURL.search || controlURL.hash || !controlURL.port) throw new Error('Fixture control must be an explicit loopback origin');
const controlOrigin = 'http://127.0.0.1:' + Number(controlURL.port);
const temporary = await mkdtemp(path.join(tmpdir(), 'redeven-web-entry-browser-'));
const reportDir = process.env.REDEVEN_WEB_ENTRY_REPORT_DIR;
const engine = process.env.REDEVEN_WEB_ENTRY_BROWSER_ENGINE ?? 'chromium';
const browserType = { chromium, firefox, webkit }[engine];
if (!browserType) throw new Error('Unsupported browser engine');
const report = { scope: 'Runtime Web entry protocol qualification; Center product acceptance is separate', engine, status: 'running', cases: [] };
let browser;
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.replace(/=+$/, '').toUpperCase()].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
  const step = Buffer.alloc(8);
  step.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', key).update(step).digest();
  return String((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function status(page) { return page.evaluate(async () => (await fetch('/api/local/runtime')).status); }
async function submit(page, value) {
  await page.locator('input[autocomplete="current-password"], input[autocomplete="one-time-code"]').fill(value);
  await page.locator('button[type="submit"]').click();
}
async function until(check, message) {
  for (let i = 0; i < 60; i++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(message);
}
try {
  if (reportDir) await mkdir(reportDir, { recursive: true });
  const bundled = path.join(temporary, 'runtime.js');
  await build({ entryPoints: [path.join(root, 'internal/envapp/ui_src/scripts/fixtures/web-entry-browser.ts')], outfile: bundled, bundle: true, platform: 'browser', format: 'iife', globalName: 'GatewayAcceptance' });
  browser = await browserType.launch({ headless: true });
  report.version = browser.version();
  const context = await browser.newContext({ locale: 'en-US' });
  const pages = [];
  for (const [index, target] of fixture.targets.entries()) {
    const page = await context.newPage();
    pages.push(page);
    page.on('pageerror', error => console.error('PAGE_ERROR', error.message));
    page.on('console', message => { if (message.type() === 'error') console.error('BROWSER_ERROR', message.text()); });
    await page.goto(target.origin + '/_redeven_proxy/env/', { waitUntil: 'domcontentloaded' });
    if (await status(page) !== 423) throw new Error('Runtime accessible before login');
    await page.locator('input[autocomplete="current-password"]').waitFor({ state: 'visible' });
    await submit(page, fixture.password);
    await page.getByLabel('Authenticator code', { exact: true }).waitFor({ state: 'visible' });
    if (await status(page) !== 423) throw new Error('Password-only stage granted business access');
    await submit(page, '000000');
    await page.getByText('This code is invalid or already used. Try a new code.', { exact: true }).waitFor({ state: 'visible' });
    if (await status(page) !== 423) throw new Error('Wrong factor granted access');
    await submit(page, totp(target.secret));
    await until(async () => await status(page) === 200, 'MFA did not unlock Runtime');
    await page.addScriptTag({ path: bundled });
    const assertions = await page.evaluate(async () => await GatewayAcceptance.verifyWebEntryServices());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await until(async () => await status(page) === 200, 'Reload lost valid Runtime session');
    const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => r.scope));
    if (registrations.length !== 0) throw new Error('Public TLS path unexpectedly installed a proxy Service Worker');
    const cacheKeys = await page.evaluate(async () => await caches.keys());
    if (cacheKeys.length !== 0) throw new Error('Runtime entry cached authenticated responses');
    const cookies = await context.cookies(target.origin);
    if (!cookies.length || cookies.some(c => c.domain !== new URL(target.origin).hostname || !c.secure)) throw new Error('Runtime cookies escaped their HTTPS host');
    if (reportDir) await page.screenshot({ path: path.join(reportDir, engine + '-runtime-' + index + '.png'), fullPage: true });
    report.cases.push({ origin: target.origin, assertions: ['actual password and TOTP form interaction', 'wrong factor and password-only denial', 'host-only secure cookies', 'public TLS path installs no proxy Service Worker or response cache', 'reload continuity', ...assertions] });
  }
  // A fresh browser device cannot reuse a password challenge or already consumed code.
  const device = await browser.newContext({ locale: 'en-US' });
  const recovery = await device.newPage();
  await recovery.goto(fixture.targets[0].origin + '/_redeven_proxy/env/');
  await recovery.locator('input[autocomplete="current-password"]').waitFor({ state: 'visible' });
  if (await status(recovery) !== 423) throw new Error('New device inherited authority');
  await submit(recovery, fixture.password);
  await recovery.getByLabel('Authenticator code', { exact: true }).waitFor({ state: 'visible' });
  await recovery.getByRole('button', { name: 'Use a recovery code', exact: true }).click();
  await submit(recovery, fixture.targets[0].recoveryCodes[0]);
  await until(async () => await status(recovery) === 200, 'Recovery-code login failed');
  await device.close();
  report.cases.push({ assertions: ['independent browser device requires login', 'actual recovery-code form interaction'] });
  const revoked = await fetch(controlOrigin + '/revoke-first', { method: 'POST' });
  if (revoked.status !== 204) throw new Error('Fixture revocation failed');
  await until(async () => await status(pages[0]) === 421, 'Revoked binding remained accessible');
  if (await status(pages[1]) !== 200) throw new Error('Revocation crossed into another Runtime');
  report.cases.push({ assertions: ['live Runtime binding revocation', 'second Runtime remains usable'] });
  report.status = 'passed';
  console.log(JSON.stringify(report));
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  if (reportDir && browser) {
    for (const [index, page] of browser.contexts().flatMap(c => c.pages()).entries()) {
      await page.screenshot({ path: path.join(reportDir, engine + '-failure-' + index + '.png'), fullPage: true }).catch(() => {});
      console.error('PAGE_URL', page.url());
    }
  }
  throw error;
} finally {
  if (reportDir) await writeFile(path.join(reportDir, engine + '-report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
