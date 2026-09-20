import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const collector = fileURLToPath(new URL('./collect_runtime_relink.py', import.meta.url));

test('retains all objects and relinks after removing the original build paths', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'runtime-relink-'));
  try {
    const kit = path.join(root, 'kit');
    const upstream = path.join(root, 'upstream');
    mkdirSync(path.join(kit, 'objects'), { recursive: true });
    mkdirSync(upstream);
    writeFileSync(path.join(kit, 'objects/go.o'), 'go object');
    const archive = path.join(upstream, 'native library.a');
    writeFileSync(archive, 'published native archive');
    const argv = ['gcc', '-o', '/obsolete/output', path.join(kit, 'objects/go.o'), archive, '-static', '-lm'];
    writeFileSync(path.join(kit, 'link.log'), `diagnostic\nhost link: ${argv.map(a => JSON.stringify(a)).join(' ')}\n`);
    const result = spawnSync('python3', [collector, kit, 'redeven'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const relocated = path.join(root, 'relocated kit');
    renameSync(kit, relocated);
    rmSync(upstream, { recursive: true });
    const compiler = path.join(root, 'compiler.py');
    writeFileSync(compiler, `import pathlib, sys\nargs=sys.argv[1:]\nassert pathlib.Path('objects/go.o').read_text() == 'go object'\nassert pathlib.Path('objects/native library.a').read_text() == 'published native archive'\nassert '--sysroot=/modified library' in args\npathlib.Path(args[args.index('-o')+1]).write_text('relinked')\n`);
    const link = spawnSync('python3', [path.join(relocated, 'relink.py'), '--sysroot=/modified library'], {
      encoding: 'utf8', env: { ...process.env, CC: `python3 '${compiler}'` },
    });
    assert.equal(link.status, 0, link.stderr);
    assert.equal(readFileSync(path.join(relocated, 'redeven'), 'utf8'), 'relinked');
    assert.doesNotMatch(readFileSync(path.join(relocated, 'link-arguments.json'), 'utf8'), /obsolete|upstream/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects incomplete object capture instead of publishing a nonportable relink kit', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'runtime-relink-'));
  try {
    mkdirSync(path.join(root, 'objects'));
    writeFileSync(path.join(root, 'link.log'), 'host link: "gcc" "-o" "/output" "/missing/native.a"\n');
    const result = spawnSync('python3', [collector, root, 'redeven'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unrecorded absolute linker input/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
