import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const buildCommand = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).scripts.build;

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'redeven-env-build-'));
  const cwd = path.join(root, 'ui_src');
  const bin = path.join(root, 'bin');
  const assets = path.join(root, 'ui/dist/env/assets');
  mkdirSync(path.join(cwd, 'scripts'), { recursive: true });
  mkdirSync(bin);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ['build.py', 'precompressAssets.mjs']) {
    const source = path.join(packageRoot, 'scripts', name);
    if (existsSync(source)) copyFileSync(source, path.join(cwd, 'scripts', name));
  }
  writeFileSync(path.join(cwd, 'scripts/buildHostApplicationAppearance.mjs'), `
    if (!process.argv.includes('--check')) throw new Error('Build must verify committed appearance assets');
  `);
  writeFileSync(path.join(cwd, 'scripts/checkInitialBuildBudget.mjs'), `
    import { accessSync } from 'node:fs';
    accessSync('../ui/dist/env/assets/json.worker-abcdefgh.js');
  `);
  writeFileSync(path.join(cwd, 'hold-compression.cjs'), `
    const fs = require('node:fs');
    const read = fs.readFileSync;
    fs.readFileSync = (file, ...args) => {
      if (String(file).endsWith('/json.worker-abcdefgh.js')) {
        console.log('compressing:' + process.env.TEST_BUILD_ID);
        const pause = new Int32Array(new SharedArrayBuffer(4));
        while (!fs.existsSync(process.env.TEST_BUILD_HOLD_COMPRESSION)) Atomics.wait(pause, 0, 0, 10);
      }
      return read(file, ...args);
    };
  `);
  writeFileSync(path.join(bin, 'tsc'), `#!${process.execPath}
    const fs = require('node:fs');
    console.log('entered:' + process.env.TEST_BUILD_ID);
    if (process.env.TEST_BUILD_FAIL) process.exit(31);
    if (process.env.TEST_BUILD_HOLD) {
      const timer = setInterval(() => {
        if (fs.existsSync(process.env.TEST_BUILD_HOLD)) { clearInterval(timer); }
      }, 10);
    }
  `, { mode: 0o755 });
  writeFileSync(path.join(bin, 'vite'), `#!${process.execPath}
    const fs = require('node:fs');
    fs.rmSync('../ui/dist/env', { recursive: true, force: true });
    fs.mkdirSync('../ui/dist/env/assets', { recursive: true });
    fs.writeFileSync('../ui/dist/env/assets/json.worker-abcdefgh.js', 'worker:' + process.env.TEST_BUILD_ID);
  `, { mode: 0o755 });
  return { cwd, bin, assets, release: path.join(root, 'release') };
}

function build(t, f, id, extra = {}) {
  const child = spawn('sh', ['-c', buildCommand], {
    cwd: f.cwd, detached: true,
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, TEST_BUILD_ID: id, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const listeners = new Set();
  const update = (chunk) => {
    output += chunk;
    for (const listener of listeners) listener();
  };
  child.stdout.on('data', update);
  child.stderr.on('data', update);
  const done = new Promise((resolve) => child.on('close', (code) => resolve(code)));
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  });
  return {
    child, done, output: () => output,
    until: (pattern) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`Build did not reach ${pattern}: ${output}`));
      }, 5000);
      function check() {
        if (!pattern.test(output)) return;
        clearTimeout(timer);
        listeners.delete(check);
        resolve();
      }
      listeners.add(check);
      check();
    }),
  };
}

function verifyAssets(f, id) {
  const worker = path.join(f.assets, 'json.worker-abcdefgh.js');
  const bytes = readFileSync(worker);
  assert.equal(bytes.toString(), `worker:${id}`);
  assert.deepEqual(gunzipSync(readFileSync(`${worker}.gz`)), bytes);
  assert.deepEqual(brotliDecompressSync(readFileSync(`${worker}.br`)), bytes);
}

test('serializes concurrent builds through worker generation, validation, and compression', async (t) => {
  const f = fixture(t);
  const first = build(t, f, 'first', { TEST_BUILD_HOLD: f.release });
  await first.until(/entered:first/);
  const second = build(t, f, 'second');
  await second.until(/Waiting for|entered:second/);
  assert.match(second.output(), /Waiting for/, 'a second build must wait before touching the shared output');
  assert.doesNotMatch(second.output(), /entered:second/);
  writeFileSync(f.release, 'release');
  assert.equal(await first.done, 0, first.output());
  assert.equal(await second.done, 0, second.output());
  verifyAssets(f, 'second');
});

test('releases the build lock after a failed command', async (t) => {
  const f = fixture(t);
  const failed = build(t, f, 'failed', { TEST_BUILD_FAIL: '1' });
  assert.equal(await failed.done, 31, failed.output());
  const next = build(t, f, 'next');
  assert.equal(await next.done, 0, next.output());
  verifyAssets(f, 'next');
});

test('holds the lock while compression reads the emitted worker files', async (t) => {
  const f = fixture(t);
  const first = build(t, f, 'first', {
    TEST_BUILD_HOLD_COMPRESSION: f.release,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require=${path.join(f.cwd, 'hold-compression.cjs')}`,
  });
  await first.until(/compressing:first/);
  const second = build(t, f, 'second');
  await second.until(/Waiting for|entered:second/);
  assert.match(second.output(), /Waiting for/);
  assert.doesNotMatch(second.output(), /entered:second/);
  writeFileSync(f.release, 'release');
  assert.equal(await first.done, 0, first.output());
  assert.equal(await second.done, 0, second.output());
  verifyAssets(f, 'second');
});

test('releases the kernel lock when an interrupted build process group exits', async (t) => {
  const f = fixture(t);
  const interrupted = build(t, f, 'interrupted', { TEST_BUILD_HOLD: f.release });
  await interrupted.until(/entered:interrupted/);
  process.kill(-interrupted.child.pid, 'SIGKILL');
  await interrupted.done;
  const next = build(t, f, 'next');
  assert.equal(await next.done, 0, next.output());
  verifyAssets(f, 'next');
});

test('allows separate worktree outputs to build independently', async (t) => {
  const firstFixture = fixture(t);
  const secondFixture = fixture(t);
  const first = build(t, firstFixture, 'first', { TEST_BUILD_HOLD: firstFixture.release });
  await first.until(/entered:first/);
  const second = build(t, secondFixture, 'second');
  assert.equal(await second.done, 0, second.output());
  assert.doesNotMatch(second.output(), /Waiting for/);
  verifyAssets(secondFixture, 'second');
  writeFileSync(firstFixture.release, 'release');
  assert.equal(await first.done, 0, first.output());
});
