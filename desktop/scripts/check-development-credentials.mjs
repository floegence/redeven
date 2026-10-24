import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createDesktopTestSession, bounded } from '../../scripts/desktop_test_session.mjs';

const desktop = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(desktop, 'package.json'));
const { createDesktopSecretCodec } = require('./dist/main/developmentSecretStorage.js');
const { defaultDesktopPreferences, defaultDesktopPreferencesPaths, saveDesktopPreferences } = require('./dist/main/desktopPreferences.js');
const bundle = process.env.REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT;
assert.ok(bundle, 'Build Desktop and set REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT to a real development bundle');
const manifest = JSON.parse(await readFile(path.join(bundle, 'desktop-bundle-manifest.json'), 'utf8'));
const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 360000 });
await session.run(async () => {
  const state = await mkdtemp(path.join(tmpdir(), 'redeven-development-credentials-'));
  await session.directory(state);
  const marker = 'rdi-development-credentials-qualification';
  async function launch(root, autoStart = false) {
    const application = await session.launchElectron(_electron, {
      executablePath: electron,
      args: [desktop, '--redeven-dev-instance=' + marker],
      cwd: desktop,
      timeout: 30000,
      env: {
        ...process.env, ELECTRON_RUN_AS_NODE: undefined, GOWORK: 'off',
        REDEVEN_STATE_ROOT: root,
        REDEVEN_DESKTOP_USER_DATA_ROOT: path.join(root, 'desktop/user-data'),
        REDEVEN_DESKTOP_CACHE_ROOT: path.join(root, 'desktop/cache'),
        REDEVEN_DESKTOP_TEMP_ROOT: path.join(root, 'desktop/temp'),
        REDEVEN_DESKTOP_DEV_INSTANCE_ID: marker,
        REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0',
        REDEVEN_DESKTOP_AUTO_START_RUNTIME: autoStart ? '1' : '0',
        REDEVEN_DESKTOP_LOCAL_UI_BIND: '127.0.0.1:0',
        REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: bundle,
        REDEVEN_DESKTOP_BUNDLE_COMMIT: manifest.commit,
        REDEVEN_DESKTOP_BUNDLE_VERSION: manifest.version,
      },
    });
    const page = await application.firstWindow();
    await page.waitForFunction(() => Boolean(window.redevenDesktopLauncher), null, { timeout: 30000 });
    await page.evaluate(() => window.redevenDesktopLanguage.setPreference('en-US'));
    return { application, page };
  }
  const legacy = path.join(state, 'legacy');
  const originals = new Map();
  const legacyFiles = [
    'desktop/user-data/desktop-secrets.json',
    'local-environment/gateway/gateway-secrets.json',
    'maintenance/environment-registration-migration.json',
  ];
  for (const relative of legacyFiles) {
    const target = path.join(legacy, relative);
    await mkdir(path.dirname(target), { recursive: true });
    if (process.env.REDEVEN_DESKTOP_LEGACY_PROFILE) {
      try { await copyFile(path.join(process.env.REDEVEN_DESKTOP_LEGACY_PROFILE, relative), target); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    } else {
      await writeFile(target, JSON.stringify({ credential: { encoding: 'safe_storage', data: 'bGVnYWN5LWZpeHR1cmU=' } }), { mode: 0o600 });
    }
    originals.set(target, await readFile(target));
  }
  assert.ok(originals.size, 'The legacy profile must contain encrypted credentials');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { application, page } = await launch(legacy);
    await page.locator('[data-redeven-credential-recovery]').waitFor({ state: 'visible', timeout: 30000 });
    const snapshot = await page.evaluate(() => window.redevenDesktopLauncher.getSnapshot());
    assert.equal(snapshot.credential_recovery.can_migrate, true);
    assert.equal(snapshot.credential_recovery.failed, false);
    for (const [file, original] of originals) assert.deepEqual(await readFile(file), original);
    await session.closeElectron(application);
    console.log('PASS legacy profile startup, preserved credentials and clean quit', attempt);
  }
  async function seed(root) {
    const userDataRoot = path.join(root, 'desktop/user-data');
    const codec = createDesktopSecretCodec({ isPackaged: false, developmentInstanceID: marker,
      stateRoot: root, userDataRoot, safeStorage: null });
    const defaults = defaultDesktopPreferences();
    const preferences = { ...defaults, local_environment: { ...defaults.local_environment,
      local_hosting: { ...defaults.local_environment.local_hosting, access: {
        ...defaults.local_environment.local_hosting.access,
        local_ui_password: 'qualification-only-local-password', local_ui_password_configured: true,
      } },
    } };
    // The catalog lives under stateRoot, independently of the user-data directory.
    const paths = defaultDesktopPreferencesPaths(userDataRoot, { stateRoot: root });
    assert.equal(paths.stateRoot, root);
    await saveDesktopPreferences(paths, preferences, codec);
  }
  const modern = path.join(state, 'modern');
  await seed(modern);
  await session.target(path.join(bundle, process.platform === 'win32' ? 'redeven.exe' : 'redeven'), modern);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { application, page } = await launch(modern, true);
    const snapshot = await bounded(async () => {
      while (true) {
        const value = await page.evaluate(() => window.redevenDesktopLauncher.getSnapshot());
        if (value.environments.some(entry => entry.runtime_health?.status === 'online'
          && entry.runtime_health.runtime_service?.open_readiness?.state === 'openable')
          && !value.operations.some(operation => ['running', 'canceling', 'cleanup_running'].includes(operation.status))) return value;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }, 90000, 'Actual local Runtime readiness');
    assert.equal(snapshot.credential_recovery, undefined);
    const local = snapshot.environments.find(entry => entry.id === 'local');
    assert.ok(local?.runtime_health.local_ui_url);
    const secrets = JSON.parse(await readFile(path.join(modern, 'desktop/user-data/desktop-secrets.json'), 'utf8'));
    assert.equal(secrets.local_environment.local_ui_password.encoding, 'development_aes_256_gcm');
    const opened = await page.evaluate(() => window.redevenDesktopLauncher.performAction({
      kind: 'open_local_environment', environment_id: 'local',
    }));
    assert.equal(opened.ok, true, JSON.stringify(opened));
    await bounded(async () => {
      while (true) {
        const environment = application.context().pages().find(item => item.url().includes('/_redeven_proxy/env/'));
        if (environment) { await environment.getByRole('tab', { name: 'Activity', exact: true }).waitFor(); return; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }, 30000, 'Actual Env App window');
    await session.closeElectron(application);
    console.log('PASS encrypted profile, Runtime readiness, Env App open and restart', attempt);
  }
  const damaged = path.join(state, 'damaged');
  await seed(damaged);
  await writeFile(path.join(damaged, 'desktop/user-data/development-secret-key-v1'), randomBytes(32));
  const secretFile = path.join(damaged, 'desktop/user-data/desktop-secrets.json');
  const saved = await readFile(secretFile);
  const { application, page } = await launch(damaged);
  await page.locator('[data-redeven-credential-recovery]').waitFor({ state: 'visible', timeout: 30000 });
  const snapshot = await page.evaluate(() => window.redevenDesktopLauncher.getSnapshot());
  assert.deepEqual(snapshot.credential_recovery, { can_migrate: false, failed: true });
  assert.equal(await page.getByRole('button', { name: 'Migrate saved credentials', exact: true }).count(), 0);
  assert.deepEqual(await readFile(secretFile), saved);
  await session.closeElectron(application);
  console.log('PASS damaged-key repair guidance and preserved credentials');
  console.log('Assertions complete: actual product main, three legacy starts, three encrypted restarts with Env App, damaged key and owned cleanup.');
});
