import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { MODULE_PATH, PUBLIC_GO_ENV, applyUpdate, assertPublishedDependencyBoundary, isFormalVersion, selectLatestFormalVersion } from './update_service_template_dependency.mjs';

const h1 = 'h1:' + Buffer.alloc(32).toString('base64');
function fixture(t, { latest = 'v0.4.2', failure = '', indirect = false, replacements = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-catalog-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'go.mod'), 'original module bytes');
  fs.writeFileSync(path.join(root, 'go.sum'), 'original sum bytes');
  let updated = false;
  const calls = [];
  const runGo = (args, cwd) => {
    calls.push(args.join(' '));
    if (args.join(' ') === 'mod edit -json') return JSON.stringify({
      Go: '1.27.1', Replace: replacements,
      Require: [{ Path: MODULE_PATH, Version: updated ? latest : 'v0.4.1', Indirect: indirect }],
    });
    if (args[0] === 'list') {
      if (failure === 'listing') throw new Error('proxy unavailable');
      return JSON.stringify({ Path: MODULE_PATH, Versions: [latest, 'v0.5.0-rc.1', 'v0.4.0'] });
    }
    if (args[1] === 'download') {
      assert.notEqual(cwd, root);
      return JSON.stringify({ Path: MODULE_PATH, Version: latest, Sum: failure === 'checksum' ? '' : h1, GoModSum: h1 });
    }
    if (args[0] === 'get') {
      assert.equal(args[1], MODULE_PATH + '@' + latest);
      updated = true;
      fs.writeFileSync(path.join(root, 'go.mod'), 'updated module bytes');
      fs.writeFileSync(path.join(root, 'go.sum'), `${MODULE_PATH} ${latest} ${h1}\n${MODULE_PATH} ${latest}/go.mod ${h1}\n`);
      return '';
    }
    if (args[1] === 'tidy' && failure === 'tidy') throw new Error('tidy failed');
    if (args[1] === 'verify' && failure === 'verify') throw new Error('checksum mismatch');
    return '';
  };
  return { root, runGo, calls };
}

test('filters prereleases, pseudo-versions, local paths and invalid SemVer', () => {
  for (const value of ['v0.4.2-rc.1', 'v0.4.2-0.20260901120000-abcdefabcdef', '../catalog', 'v01.2.3', 'v0.4.2 ']) {
    assert.equal(isFormalVersion(value), false);
  }
  assert.equal(selectLatestFormalVersion(['v0.9.9', 'v0.10.0', 'v1.0.0-rc.1']), 'v0.10.0');
  assert.throws(() => selectLatestFormalVersion(['v0.4.2-rc.1']));
});

test('updates exact go.mod and go.sum through verified published downloads', (t) => {
  const f = fixture(t);
  assert.equal(applyUpdate(f.root, { runGo: f.runGo }).changed, true);
  assert.equal(f.calls.filter((command) => command === 'mod verify').length, 1);
  assert.match(fs.readFileSync(path.join(f.root, 'go.sum'), 'utf8'), /v0\.4\.2\/go.mod/u);
});

test('current and check-only runs leave both files untouched without downloads', (t) => {
  for (const options of [{ latest: 'v0.4.1' }, { latest: 'v0.4.2', checkOnly: true }]) {
    const f = fixture(t, options);
    assert.equal(applyUpdate(f.root, { runGo: f.runGo, checkOnly: options.checkOnly }).changed, false);
    assert.equal(fs.readFileSync(path.join(f.root, 'go.mod'), 'utf8'), 'original module bytes');
    assert.equal(fs.readFileSync(path.join(f.root, 'go.sum'), 'utf8'), 'original sum bytes');
    assert.equal(f.calls.some((command) => command.startsWith('get ') || command.startsWith('mod download')), false);
  }
});

test('network, checksum and update failures restore exact original files', (t) => {
  for (const failure of ['listing', 'checksum', 'tidy', 'verify']) {
    const f = fixture(t, { failure });
    assert.throws(() => applyUpdate(f.root, { runGo: f.runGo }));
    assert.equal(fs.readFileSync(path.join(f.root, 'go.mod'), 'utf8'), 'original module bytes');
    assert.equal(fs.readFileSync(path.join(f.root, 'go.sum'), 'utf8'), 'original sum bytes');
  }
});

test('rejects workspaces, replacements, indirect pins and version regression', (t) => {
  for (const name of ['go.work', 'go.work.sum', 'vendor']) {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.root, name), '');
    assert.throws(() => assertPublishedDependencyBoundary(f.root, f.runGo), /forbidden/u);
  }
  for (const options of [{ replacements: [{ Old: { Path: MODULE_PATH }, New: { Path: '../catalog' } }] }, { indirect: true }, { latest: 'v0.3.0' }]) {
    const f = fixture(t, options);
    assert.throws(() => applyUpdate(f.root, { runGo: f.runGo }));
  }
});

test('command environment cannot disable the public proxy and checksum boundary', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-go-env-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const log = path.join(root, 'environment.json');
  const fakeGo = `#!${process.execPath}\nconst fs=require('fs');fs.writeFileSync(process.env.WATCHER_ENV_LOG,JSON.stringify(process.env));const mod=${JSON.stringify(MODULE_PATH)};if(process.argv[2]==='mod')console.log(JSON.stringify({Go:'1.27.1',Require:[{Path:mod,Version:'v0.4.1'}]}));else console.log(JSON.stringify({Path:mod,Versions:['v0.4.1']}));\n`;
  fs.writeFileSync(path.join(root, 'go'), fakeGo, { mode: 0o755 });
  const result = spawnSync(process.execPath, [new URL('./update_service_template_dependency.mjs', import.meta.url).pathname, '--check'], {
    env: { ...process.env, PATH: root + path.delimiter + process.env.PATH, WATCHER_ENV_LOG: log, GOSUMDB: 'off', GOWORK: '/untrusted', GOPROXY: 'direct', GOFLAGS: '-modfile=/untrusted' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const environment = JSON.parse(fs.readFileSync(log, 'utf8'));
  for (const [key, value] of Object.entries(PUBLIC_GO_ENV)) assert.equal(environment[key], value);
});
