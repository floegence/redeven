import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createDesktopTestSession, bounded, processIdentity, sameProcess } from '../../scripts/desktop_test_session.mjs';

const session = await createDesktopTestSession(import.meta.url);
await session.run(async () => {
  const [bundle, output] = process.argv.slice(2);
  assert.ok(bundle && output, 'Expected <built Runtime bundle> <evidence directory>');
  await mkdir(output, { recursive: true });
  const state = await mkdtemp(path.join(tmpdir(), 'redeven-quit-qualification-'));
  await session.directory(state);
  const binary = path.join(bundle, 'redeven');
  await session.target(binary, state);
  const manifest = JSON.parse(await readFile(path.join(bundle, 'desktop-bundle-manifest.json'), 'utf8'));
  const report = { state, scenarios: [] };
  const app = await session.launchElectron(_electron, {
    executablePath: electron,
    args: [path.resolve('.'), `--user-data-dir=${state}/profile`],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      REDEVEN_STATE_ROOT: state,
      REDEVEN_DESKTOP_USER_DATA_ROOT: `${state}/profile`,
      REDEVEN_DESKTOP_CACHE_ROOT: `${state}/cache`,
      REDEVEN_DESKTOP_TEMP_ROOT: `${state}/temp`,
      REDEVEN_DESKTOP_AUTO_START_RUNTIME: '1',
      REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0',
      REDEVEN_DESKTOP_LOCAL_UI_BIND: '127.0.0.1:0',
      REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: bundle,
      REDEVEN_DESKTOP_BUNDLE_VERSION: manifest.version,
      REDEVEN_DESKTOP_BUNDLE_COMMIT: manifest.commit,
    },
  });
  const inventory = () =>
    JSON.parse(execFileSync(binary, ['desktop-target-process-inventory', '--target-root', state], { encoding: 'utf8' }));
  const welcome = await app.firstWindow();
  await welcome.waitForFunction(() => Boolean(window.redevenDesktopLauncher && window.redevenDesktopSettings));
  await welcome.evaluate(() => window.redevenDesktopLanguage.setPreference('en-US'));
  await bounded(
    async () => {
      while (
        !(
          await welcome.evaluate(() =>
            window.redevenDesktopSettings.requestRuntimeFlower({
              method: 'GET',
              path: '/_redeven_proxy/api/ai/threads',
            }),
          )
        ).ok
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
    },
    60000,
    'Runtime readiness',
  );
  const opened = await welcome.evaluate(async () => {
    const snapshot = await window.redevenDesktopLauncher.getSnapshot();
    const local = snapshot.environments.find((item) => item.kind === 'local_environment');
    return window.redevenDesktopLauncher.performAction({
      kind: 'open_local_environment',
      environment_id: local.id,
    });
  });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const page = await bounded(
    async () => {
      while (true) {
        const page = app
          .context()
          .pages()
          .find((page) => page.url().includes('/_redeven_proxy/env/'));
        if (page) return page;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    30000,
    'Environment window',
  );
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('tab', { name: 'Activity', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'environment.png') });
  report.scenarios.push('real-environment-open');
  await app.evaluate(({ app, dialog }) => {
    const original = dialog.showMessageBox;
    globalThis.__quitConfirmation = { original, calls: [] };
    dialog.showMessageBox = (...args) => {
      const options = args.at(-1);
      if (options.title !== 'Quit Redeven Desktop?') return original.apply(dialog, args);
      globalThis.__quitConfirmation.calls.push(options);
      return Promise.resolve({ response: 1, checkboxChecked: false });
    };
    app.quit();
  });
  await bounded(
    async () => {
      while (!(await app.evaluate(() => globalThis.__quitConfirmation.calls.length)))
        await new Promise((resolve) => setTimeout(resolve, 50));
    },
    5000,
    'Cancel confirmation',
  );
  assert.equal(page.isClosed(), false);
  await welcome.getByRole('textbox').first().fill('still operational');
  await welcome.getByRole('textbox').first().fill('');
  report.confirmations = await app.evaluate(({ dialog }) => {
    const state = globalThis.__quitConfirmation;
    dialog.showMessageBox = state.original;
    return state.calls;
  });
  report.scenarios.push('cancel-restores-interaction');
  await page.close();
  const originalRuntime = inventory().instances.find((item) => item.role === 'runtime');
  const restarted = await welcome.evaluate(async () => {
    const snapshot = await window.redevenDesktopLauncher.getSnapshot();
    const local = snapshot.environments.find((item) => item.kind === 'local_environment');
    return window.redevenDesktopLauncher.performAction({
      kind: 'restart_environment_runtime',
      environment_id: local.id,
    });
  });
  assert.equal(restarted.ok, true, JSON.stringify(restarted));
  await bounded(
    async () => {
      while (!inventory().instances.some((item) => item.role === 'runtime' && item.pid !== originalRuntime.pid))
        await new Promise((resolve) => setTimeout(resolve, 100));
    },
    60000,
    'Restarted Runtime inventory',
  );
  report.scenarios.push('restarted-runtime-is-owned-by-target-root');
  const runtime = inventory().instances.find((item) => item.role === 'runtime');
  assert.ok(runtime);
  const identity = processIdentity(runtime.pid);
  const desktopProcess = app.process();
  await session.closeElectron(app);
  assert.equal(desktopProcess.exitCode, 0);
  assert.equal(desktopProcess.signalCode, null);
  assert.ok(sameProcess(identity, processIdentity(runtime.pid)), 'Normal Desktop quit preserves Runtime');
  report.scenarios.push('quit-completes-and-runtime-stays-independent');
  report.status = 'passed';
  await session.writeEvidence(path.join(output, 'report.json'), report);
});
