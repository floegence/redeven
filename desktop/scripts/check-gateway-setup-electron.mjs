import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';

// Exercise the production Welcome, preload, IPC and service owners together.
// Supply the current checkout's verified development bundle; no launcher mocks.
const session = await createDesktopTestSession(import.meta.url, {
  timeoutMs: 720000,
});
await session.run(async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = process.env.REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT;
  assert.ok(bundle, 'Build a Desktop bundle and set REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT');
  execFileSync(path.join(root, '../scripts/check_desktop_electron_test_runtime.sh'), [], { stdio: 'inherit' });
  const manifest = JSON.parse(await readFile(path.join(bundle, 'desktop-bundle-manifest.json'), 'utf8'));
  const state = await mkdtemp(path.join(tmpdir(), 'redeven-gateway-setup-'));
  await session.directory(state);
  const output = path.join(root, 'dist/gateway-setup-acceptance');
  await mkdir(output, { recursive: true });
  const marker = randomUUID();
  await session.target(path.join(bundle, process.platform === 'win32' ? 'redeven.exe' : 'redeven'), state);
  const application = await session.launchElectron(_electron, {
    executablePath: electron,
    args: [root, `--redeven-smoke-run=${marker}`, `--redeven-dev-instance=${marker}`],
    cwd: state,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      REDEVEN_STATE_ROOT: state,
      REDEVEN_DESKTOP_USER_DATA_ROOT: path.join(state, 'desktop'),
      REDEVEN_DESKTOP_DEV_INSTANCE_ID: marker,
      REDEVEN_DESKTOP_CACHE_ROOT: path.join(state, 'desktop/cache'),
      REDEVEN_DESKTOP_TEMP_ROOT: path.join(state, 'desktop/temp'),
      REDEVEN_DESKTOP_LOCAL_UI_BIND: '127.0.0.1:0',
      REDEVEN_DESKTOP_AUTO_START_RUNTIME: '0',
      REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT: path.resolve(root, '..'),
      REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG: manifest.version,
      REDEVEN_DESKTOP_BUNDLE_VERSION: manifest.version,
    },
  });
  const child = application.process();
  const report = {
    status: 'running',
    cases: [],
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    pid: child.pid,
    marker,
    state,
  };
  let logs = '';
  child.stdout.on('data', (bytes) => {
    logs += bytes.toString();
  });
  let page;
  let serviceRoot;
  const fixtureBinary = path.join(state, 'redeven-gateway');
  try {
    child.stderr.on('data', (bytes) => {
      logs += bytes.toString();
    });
    const context = application.context();
    page = context.pages()[0] ?? (await context.waitForEvent('page'));
    await page.waitForFunction(() => Boolean(window.redevenDesktopLauncher));
    await page.evaluate(async () => {
      window.redevenDesktopLanguage.setPreference('en-US');
      await window.redevenDesktopShell.openConnectionCenter();
    });
    const snapshot = () => page.evaluate(() => window.redevenDesktopLauncher.getSnapshot());
    const action = (request) => page.evaluate((request) => window.redevenDesktopLauncher.performAction(request), request);
    await page.getByRole('button', { name: 'Gateways', exact: true }).click();
    await page.getByRole('button', { name: 'Add Gateway', exact: true }).first().click();
    await page.getByRole('button', { name: /^Deploy a new Gateway/ }).click();
    await page.getByRole('button', { name: 'Local host', exact: true }).click();
    const dataRoot = path.join(state, 'gateway-data');
    await page.locator('#gateway-name').fill('Local qualification');
    await page.getByRole('button', { name: 'Save Gateway', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'All Gateways', exact: true }).click();
    let current = await snapshot();
    const source = current.gateway_sources.find((item) => item.display_name === 'Local qualification');
    assert.ok(source, 'Saved Local Gateway must appear in the production snapshot');
    const id = source.connection_id;
    report.gatewayID = id;
    report.cases.push('Local Gateway default form saves through production IPC and persistent store');
    assert.equal(source.runtime_root, 'remote_default');
    assert.notEqual(source.service_state?.status, 'ready', 'Save must not start a Gateway');
    const registration = {
      kind: 'upsert_gateway',
      connection_id: id,
      display_name: source.display_name,
      connection_kind: 'local_host',
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'host_process',
        runtime_root: dataRoot,
        release_base_url: '',
      },
    };
    assert.equal((await action(registration)).ok, true);
    assert.equal(
      (await snapshot()).gateway_sources.find((item) => item.connection_id === id).runtime_root,
      dataRoot,
      'Editing the Gateway data root must be reflected in the authoritative snapshot',
    );
    report.cases.push('Editing the default data root updates the saved source');
    const injectedPermissions = await action({
      ...registration,
      permissions: {
        access: true,
        manage_attachments: true,
        manage_network: true,
      },
    });
    assert.equal(injectedPermissions.ok, false);
    assert.equal(injectedPermissions.code, 'action_invalid');
    const retained = (await snapshot()).gateway_sources.find((item) => item.connection_id === id);
    assert.equal(retained.runtime_root, dataRoot);
    assert.notEqual(retained.service_state?.status, 'ready');
    report.cases.push('Caller-supplied permissions are rejected without changing the saved connection or starting its service');
    serviceRoot = path.join(dataRoot, 'gateways', id, 'state');
    execFileSync('go', ['build', '-o', fixtureBinary, './cmd/redeven-gateway'], {
      cwd: path.resolve(root, '..'),
      env: { ...process.env, GOWORK: 'off' },
      stdio: 'inherit',
    });
    await session.command('Gateway service', fixtureBinary, ['service-stop', '--state-root', serviceRoot]);
    execFileSync(fixtureBinary, ['service-start', '--state-root', serviceRoot, '--public-listen', '127.0.0.1:0'], { stdio: 'pipe' });
    execFileSync(fixtureBinary, ['service-stop', '--state-root', serviceRoot], {
      stdio: 'pipe',
    });
    const run = async (kind) => {
      const result = await action({ kind, connection_id: id });
      assert.equal(result.ok, true, `${kind}: ${JSON.stringify(result)}`);
      report.cases.push(kind);
    };
    await run('start_gateway');
    await run('pair_gateway');
    await run('refresh_gateway_catalog');
    const paired = (await snapshot()).gateway_sources.find((item) => item.connection_id === id);
    assert.deepEqual(paired.permissions, {
      access: true,
      manage_attachments: true,
      manage_network: true,
    });
    assert.ok(paired.client_key_id, 'Snapshot identifies this Desktop access key');
    const originalKey = paired.client_key_id;
    const listed = await action({kind:'list_gateway_clients',connection_id:id});
    assert.equal(listed.ok,true);
    assert.ok(listed.gateway_clients.some(client=>client.client_key_id===originalKey && !client.revoked_at_unix_ms));
    assert.equal((await action({kind:'revoke_gateway_client',connection_id:id,client_key_id:originalKey})).ok,true);
    await run('refresh_gateway_catalog');
    await run('sync_gateway');
    assert.equal((await snapshot()).gateway_sources.find(item=>item.connection_id===id).client_key_id,originalKey,'Refresh must not silently restore revoked access');
    await run('pair_gateway');
    const reauthorized = (await snapshot()).gateway_sources.find(item=>item.connection_id===id);
    assert.ok(reauthorized.client_key_id);
    assert.notEqual(reauthorized.client_key_id,originalKey,'Explicit reauthorization must use a fresh key');
    const authorizedClients = (await action({kind:'list_gateway_clients',connection_id:id})).gateway_clients;
    assert.ok(authorizedClients.some(client=>client.client_key_id===originalKey && client.revoked_at_unix_ms));
    assert.ok(authorizedClients.some(client=>client.client_key_id===reauthorized.client_key_id && !client.revoked_at_unix_ms));
    report.cases.push('Current-device revocation preserves host management; only explicit reauthorization creates a fresh access key');
    assert.equal(
      (await action({ kind: 'invite_gateway_runtime', connection_id: id })).ok,
      false,
      'Invitations require administrator-confirmed endpoints',
    );
    const endpoints = [
      {
        endpoint_id: 'lan',
        address: 'https://localhost:7443',
        scope: 'lan',
        priority: 0,
      },
      {
        endpoint_id: 'public',
        address: 'https://gateway.example:9443',
        scope: 'public',
        priority: 1,
      },
    ];
    assert.equal(
      (
        await action({
          kind: 'update_gateway_endpoints',
          connection_id: id,
          endpoints,
        })
      ).ok,
      true,
    );
    const invited = await action({
      kind: 'invite_gateway_runtime',
      connection_id: id,
    });
    assert.equal(invited.ok, true);
    assert.equal(invited.gateway_invitation_code.protocol_version, 'redeven-gateway-v6');
    assert.equal(invited.gateway_invitation_code.expires_at_unix_ms - invited.gateway_invitation_code.issued_at_unix_ms, 600_000);
    assert.deepEqual(
      invited.gateway_invitation_code.share_addresses,
      endpoints.map((endpoint) => endpoint.address),
    );
    assert.match(invited.gateway_invitation_code.code, /^[0-9A-HJKMNP-TV-Z]{26}$/u);
    assert.ok(invited.gateway_invitation_code.gateway_name);
    assert.equal(
      (await snapshot()).environments.some((item) => item.kind === 'gateway_environment'),
      false,
      'Invitation does not manufacture a member',
    );
    const policy = { ...paired.policy, default_egress_allowed: true };
    assert.equal((await action({ kind: 'update_gateway_policy', connection_id: id, policy })).ok, true);
    await run('restart_gateway');
    const restored = (await snapshot()).gateway_sources.find((item) => item.connection_id === id);
    assert.equal(restored.policy.default_egress_allowed, true);
    assert.equal(restored.permissions.manage_attachments, true);
    report.cases.push('Verified host access grants management; policy and host permissions survive restart');
    assert.equal(
      (
        await action({
          kind: 'update_gateway_endpoints',
          connection_id: id,
          endpoints: [],
        })
      ).ok,
      true,
    );
    await run('restart_gateway');
    assert.equal(
      (await action({ kind: 'invite_gateway_runtime', connection_id: id })).ok,
      false,
      'Restart must not restore deleted endpoints',
    );
    report.cases.push('Confirmed multi-endpoint invitations and endpoint deletion persist without automatic address publication');
    current = await snapshot();
    await writeFile(path.join(output, 'snapshot.json'), JSON.stringify(current, null, 2));
    await run('stop_gateway');
    await run('start_gateway');
    await run('restart_gateway');
    await run('stop_gateway');
    await run('delete_gateway');
    assert.ok((await stat(serviceRoot)).isDirectory(), 'Removing a Desktop connection preserves the service data');
    assert.equal(
      (await snapshot()).gateway_sources.some((item) => item.connection_id === id),
      false,
    );
    await page.getByRole('button', { name: 'Add Gateway', exact: true }).first().click();
    await page.getByRole('button', { name: /^Connect an existing Gateway/ }).click();
    await page.getByRole('button', { name: 'URL', exact: true }).click();
    await page.locator('#gateway-url').fill('ftp://invalid.example/');
    await page.locator('#gateway-access-code').fill('QUALIFICATION-ONLY-INVALID-CODE');
    await page.getByRole('button', { name: 'Save Gateway', exact: true }).click();
    await page
      .getByText('Gateway setup could not finish. Review the details, correct the connection, and retry.', { exact: true })
      .waitFor();
    await page.locator('details summary').click();
    await page.getByText('Gateway URL must use HTTP or HTTPS.', { exact: true }).waitFor();
    assert.equal((await snapshot()).gateway_sources.length, 0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    report.cases.push('Invalid URL preserves the setup dialog and exposes the actual sanitized failure without saving a connection');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error);
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await writeFile(path.join(output, 'desktop.log'), logs);
    await session.writeEvidence(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(`Assertions complete: Gateway setup qualification (${report.cases.length} cases)`);
});
