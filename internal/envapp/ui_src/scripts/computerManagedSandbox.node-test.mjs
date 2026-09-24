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

test('managed browser launches with the sandbox enabled and creates an isolated task tab', { timeout: 20000, skip: process.platform === 'win32' }, async () => {
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
  let browser;
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
  } finally {
    await browser?.close(); helper.stdin.end(); await exited; clearTimeout(deadline); lines.close();
    await rm(profile, { recursive: true, force: true });
  }
});
