import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { build } from 'esbuild';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'redeven-cloud-recovery-'));
const marker = randomUUID();
try {
  execFileSync(path.join(desktop, '../scripts/check_desktop_electron_test_runtime.sh'), [desktop], { stdio: 'inherit' });
  const script = path.join(directory, 'main.cjs');
  await build({ stdin: { resolveDir: desktop, contents: `
    import { app } from 'electron';
    import http from 'node:http';
    import assert from 'node:assert/strict';
    import { electronDesktopProviderTransport } from './src/main/controlPlaneProviderTransport';
    import { ProviderCredentialRecovery } from './src/main/providerCredentialRecovery';
    app.whenReady().then(async () => {
      const service = http.createServer((_req, res) => { res.writeHead(200); res.end('{}'); });
      const listen = port => new Promise(resolve => service.listen(port, '127.0.0.1', resolve));
      const close = () => new Promise(resolve => service.close(resolve));
      await listen(0); const port = service.address().port; await close();
      const recovery = new ProviderCredentialRecovery();
      let exchanges = 0, probes = 0;
      const request = async () => {
        try { await electronDesktopProviderTransport({ url: 'http://127.0.0.1:' + port + '/', timeout_ms: 1000 }); return { outcome: 'restored' }; }
        catch (error) { assert.equal(error.code, 'provider_connection_failed'); return { outcome: 'retry', error_code: error.code }; }
      };
      const args = { targetID: 'local:test', identity: 'account-binding', generation: 11, isCurrent: () => true, changed: () => {},
        exchange: () => { exchanges++; return request(); }, probe: () => { probes++; return request(); } };
      for (const now of [0, 31000, 160000, 230000]) await recovery.renew({ ...args, now });
      assert.equal(exchanges, 3); assert.equal(probes, 1);
      assert.equal(recovery.state(args.targetID, 11), 'waiting_for_service');
      await listen(port);
      recovery.wake();
      await recovery.renew({ ...args, now: 240000 });
      assert.equal(exchanges, 4); assert.equal(probes, 2);
      assert.equal(recovery.state(args.targetID, 11), undefined);
      await recovery.renew({ ...args, now: 500000 });
      assert.equal(exchanges, 4);
      await close();
      console.log('PASS cloud recovery: real Electron refusal, bounded exchanges, late service recovery, no duplicate issuance');
      app.quit();
    }).catch(error => { console.error(error); app.exit(1); });
  ` }, outfile: script, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  const child = spawn(electron, [script, `--user-data-dir=${directory}/profile`, `--redeven-cloud-recovery-run=${marker}`], {
    cwd: directory, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  console.log(JSON.stringify({ pid: child.pid, state: directory, marker, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: desktop, encoding: 'utf8' }).trim() }));
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, 'SIGTERM');
  }, 60_000);
  try {
    const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
    assert.equal(result.code, 0, `Electron failed: ${JSON.stringify(result)}\n${output}`);
    assert.ok(output.includes('PASS cloud recovery'), output);
    console.log(output.trim());
  } finally { clearTimeout(timer); }
} finally { await rm(directory, { recursive: true, force: true }); }
