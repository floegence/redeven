import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createComputerBrowserSource } from './computerBrowserSource.mjs';

test('managed browser preserves sandbox isolation and initializes popups at the controlled window size', { timeout: 20000, skip: process.platform === 'win32' }, async () => {
  const installation = process.env.REDEVEN_BROWSER_TEST_INSTALLATION;
  assert(installation && path.isAbsolute(installation), 'Set REDEVEN_BROWSER_TEST_INSTALLATION to the qualified installed catalog package');
  const catalog = JSON.parse(await readFile(new URL('../../../browserinstall/catalog.json', import.meta.url), 'utf8'));
  const pkg = catalog.packages.find(pkg => pkg.platform === process.platform && pkg.architecture === ({ arm64: 'arm64', x64: 'amd64' })[process.arch]);
  assert(pkg, 'Native browser catalog package unavailable');
  assert.equal(await readFile(path.join(installation, '.redeven-browser'), 'utf8'), pkg.sha256);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'flower-sandbox-'));
  const helper = spawn(process.execPath, [fileURLToPath(new URL('./redevenManagedBrowser.mjs', import.meta.url)), profile, path.join(installation, pkg.executable)], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(helper, 'exit');
  const lines = createInterface({ input: helper.stdout });
  let browser, owner;
  const deadline = setTimeout(() => helper.kill('SIGTERM'), 15000);
  try {
    const [line] = await once(lines, 'line'); const ready = JSON.parse(line);
    assert.equal(ready.error, undefined, line);
    browser = await chromium.connectOverCDP(ready.endpoint, { noDefaults: true });
    const cdp = await browser.newBrowserCDPSession();
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    const pid = processInfo.find(value => value.type === 'browser')?.id;
    assert(Number.isSafeInteger(pid) && pid > 0);
    const args = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    assert(!args.includes('--no-sandbox'), 'managed browsing must not disable the browser sandbox');
    const response = once(lines, 'line');
    helper.stdin.write(JSON.stringify({ id: 'task', command: 'new_tab' }) + '\n');
    const result = JSON.parse((await response)[0]);
    assert.equal(result.id, 'task'); assert.equal(result.tab.url, 'about:blank'); assert(result.tab.id);
    const context = browser.contexts()[0];
    const page = context.pages().find(page => page.url() === 'about:blank');
    assert(page);
    owner = await createComputerBrowserSource(page, 'owned', { windowViewport: true });
    await owner.source.setViewportSize({ width: 1536, height: 876 });
    await page.waitForFunction(() => globalThis.innerWidth === 1536 && globalThis.innerHeight === 876);
    await context.route('https://managed-layout.test/**', route => route.fulfill({ contentType: 'text/html', body: '<script>globalThis.initialViewport=[innerWidth,innerHeight]</script><title>Initialized popup</title>' }));
    const opened = context.waitForEvent('page');
    await page.evaluate(() => globalThis.open('https://managed-layout.test/popup'));
    const popup = await opened;
    await popup.waitForLoadState();
    assert.deepEqual(await popup.evaluate(() => globalThis.initialViewport), [1536, 876], 'The managed launcher and source host must agree on geometry before popup scripts run');
  } finally {
    await owner?.dispose(); await browser?.close(); helper.stdin.end(); await exited; clearTimeout(deadline); lines.close();
    await rm(profile, { recursive: true, force: true });
  }
});
