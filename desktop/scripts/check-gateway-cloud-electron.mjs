import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import electron from 'electron';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const session = await createDesktopTestSession(import.meta.url, {
  timeoutMs: 420000,
});
await session.run(async () => {
  // Cloud approval belongs to the private integration runner. This fixture only
  // exercises the real local consent UI and owner-authenticated Runtime bridge.
  for (const key of ['REDEVEN_GATEWAY_JOIN_CONTAINER', 'REDEVEN_GATEWAY_JOIN_STATE_ROOT']) {
    assert.ok(process.env[key], `${key} is required`);
  }
  const invitation = JSON.parse(
    await new Promise((resolve, reject) => {
      let raw = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        raw += chunk;
      });
      process.stdin.on('end', () => {
        try {
          resolve(raw);
        } catch (error) {
          reject(error);
        }
      });
      process.stdin.on('error', reject);
    }),
  );
  assert.equal(typeof invitation.share_address, 'string');
  assert.equal(typeof invitation.code, 'string');
  execFileSync('../scripts/check_desktop_electron_test_runtime.sh', [process.cwd()], { stdio: 'inherit' });
  const directory = await mkdtemp(path.join(tmpdir(), 'redeven-gateway-electron-'));
  await session.directory(directory);
  await mkdir('dist/gateway-cloud-acceptance', { recursive: true });
  const marker = randomUUID();
  const server = await createSSHSettingsPreviewServer(0, ['gateway-cloud.html']);
  await session.defer('preview server', () => server.close());
  await session.port(new URL(server.resolvedUrls.local[0]).port);
  await server.watcher.close();
  const { createDesktopI18n } = await server.ssrLoadModule(path.resolve('src/shared/i18n/desktopI18n.ts'));
  const i18n = createDesktopI18n('en-US');
  let child;

  for (const entry of ['gateway-cloud-electron', 'gateway-cloud-preload']) {
    await build({
      entryPoints: [`scripts/fixtures/${entry}.ts`],
      outfile: path.join(directory, `${entry}.cjs`),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
    });
  }
  const application = await session.launchElectron(_electron, {
    executablePath: electron,
    args: [
      path.join(directory, 'gateway-cloud-electron.cjs'),
      `--user-data-dir=${directory}/profile`,
      `--redeven-gateway-qualification=${marker}`,
    ],
    cwd: directory,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      REDEVEN_GATEWAY_JOIN_PRELOAD: path.join(directory, 'gateway-cloud-preload.cjs'),
      REDEVEN_GATEWAY_JOIN_RENDERER: new URL('gateway-cloud.html?locale=en-US', server.resolvedUrls.local[0]).href,
    },
  });
  child = application.process();
  child.stdout.on('data', () => {});
  // Drain diagnostics without logging request payloads or bridge credentials.
  child.stderr.on('data', () => {});
  console.log(`Owned Gateway Electron: pid=${child.pid}, marker=${marker}, state=${directory}`);
  const page = await application.firstWindow();
  assert.ok(page, 'Owned Gateway renderer was not found');
  const trigger = page.getByRole('button', {
    name: i18n.t('gatewayJoin.title'),
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  const inputs = dialog.locator('input');
  await inputs.nth(0).fill(invitation.share_address);
  await inputs.nth(1).fill(invitation.code);
  await dialog.getByRole('button', { name: i18n.t('gatewayJoin.verify'), exact: true }).click();
  await dialog
    .getByRole('button', {
      name: i18n.t('gatewayJoin.confirmEnable'),
      exact: true,
    })
    .click();
  await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('approval'), null, { timeout: 120_000 });
  await page.keyboard.press('Escape');
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await trigger.click();
  await dialog.getByRole('button', { name: i18n.t('common.refresh'), exact: true }).click();
  console.log('Gateway Desktop: durable local consent submitted; awaiting Cloud approval.');
  await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('Cloud accessible'), null, {
    timeout: 180_000,
  });
  assert.equal(await dialog.getByRole('alert').count(), 0);
  await page.screenshot({
    path: path.resolve('dist/gateway-cloud-acceptance/electron-connected.png'),
  });
  console.log(
    'Assertions complete: Gateway Desktop: real Electron consent, pause/resume, trusted container bridge and Cloud registration.',
  );
  assert.ok(child.exitCode === null && child.signalCode === null, 'Electron terminated unexpectedly');
});
