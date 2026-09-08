import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertIsolatedSmokeConfiguration, waitFor } from './smoke_desktop_plugins.mjs';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const hosts = '[data-redeven-plugin-workbench-surface] [data-plugin-surface-host][data-surface-instance-id]';

async function main() {
  const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  assertIsolatedSmokeConfiguration(config);
  const label = process.argv[3] ?? 'startup';
  assert(/^[a-z0-9-]+$/u.test(label), 'Report label must be a filename component');
  const delay = Number(process.argv[4] ?? 0);
  assert(Number.isInteger(delay) && delay >= 0 && delay <= 10_000, 'UI delay must be between 0 and 10000 ms');
  const { chromium } = require(path.join(root, 'internal/envapp/ui_src/node_modules/playwright'));
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${config.cdpPort}`);
  const context = browser.contexts()[0];
  const launcherURL = pathToFileURL(path.join(root, 'desktop/dist/welcome/index.html')).href;
  const launcher = context.pages().find((page) => page.url().split('?')[0] === launcherURL);
  assert(launcher, 'Expected the launcher from this worktree in the isolated Desktop');
  const report = { epoch_ms: Date.now(), ui_delay_ms: delay, events: [] };
  const start = performance.now();
  const record = (event) => {
    const value = { ms: Math.round(performance.now() - start), ...event };
    report.events.push(value);
    console.log(JSON.stringify(value));
  };
  const requests = new WeakMap();
  function observe(page) {
    page.on('request', (request) => requests.set(request, performance.now()));
    page.on('response', async (response) => {
      if (!new URL(response.url()).pathname.endsWith('/runtime/recover-enabled')) return;
      try {
        const body = await response.json();
        record({ event: 'recovery', status: response.status(), duration_ms: Math.round(performance.now() - requests.get(response.request())),
          complete: body.data?.complete === true, results: body.data?.results?.map((result) => ({ status: result.status })) ?? [] });
      } catch { record({ event: 'recovery_response_unavailable' }); }
    });
  }
  context.pages().forEach(observe);
  context.on('page', observe);
  try {
    record({ event: 'restart_requested' });
    await launcher.evaluate(() => window.redevenDesktopLauncher.performAction({ kind: 'restart_environment_runtime', environment_id: 'local' }));
    record({ event: 'runtime_ready' });
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    record({ event: 'ui_open_requested' });
    await launcher.evaluate(() => window.redevenDesktopLauncher.performAction({ kind: 'open_local_environment', environment_id: 'local' }));
    await waitFor(async () => {
      const page = context.pages().find((candidate) => candidate.url().startsWith('http'));
      const count = page && await page.locator(hosts).count().catch(() => 0);
      if (count === 2 && !report.events.some((event) => event.event === 'first_commits')) record({ event: 'first_commits' });
      return count === 2 && report.events.some((event) => event.event === 'recovery' && event.complete);
    }, 30_000, 'two real plugin first commits and completed recovery');
    const recovery = report.events.find((event) => event.event === 'recovery' && event.complete);
    assert.equal(recovery.status, 200);
    assert.equal(recovery.results.length, 2);
    assert(recovery.results.every((result) => result.status === 'ready'), 'Every installed test plugin must be ready');
    const runtime = report.events.find((event) => event.event === 'runtime_ready');
    report.recovery_after_runtime_ms = recovery.ms - runtime.ms;
    report.first_commits_after_runtime_ms = report.events.find((event) => event.event === 'first_commits').ms - runtime.ms;
    report.passed = true;
  } finally {
    await fs.mkdir(config.reportRoot, { recursive: true });
    await fs.writeFile(path.join(config.reportRoot, `${label}.json`), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
