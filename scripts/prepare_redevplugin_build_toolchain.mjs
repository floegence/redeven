#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = path.dirname(fileURLToPath(import.meta.url));
export function buildToolchainSourceIdentity(sourceRoot) {
  const hash = createHash('sha256');
  const config = JSON.parse(readFileSync(path.join(sourceRoot, 'scripts/redevplugin_build_toolchain.json')));
  for (const file of config.build_inputs) {
    hash.update(file).update(readFileSync(path.join(sourceRoot, 'scripts', file)));
  }
  return hash.digest('hex');
}
const hash = data => createHash('sha256').update(data).digest('hex');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
class PreparationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const exec = promisify(execFile);
const cancellation = new AbortController();
async function execute(command, args, env = process.env, code = 'probe_failed') {
  try {
    const result = await exec(command, args, { env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, signal: cancellation.signal });
    if (result.stderr) process.stderr.write(result.stderr);
    return result.stdout.trim();
  } catch (error) {
    if (cancellation.signal.aborted) throw new PreparationError('canceled', 'Runtime toolchain preparation canceled');
    throw new PreparationError(code, `${command}: ${error.message}\n${error.stdout ?? ''}${error.stderr ?? ''}`);
  }
}
export async function prepareBuildToolchain({ goos, goarch, cacheRoot, offline = false }) {
  if (!['linux', 'darwin'].includes(goos) || !['amd64', 'arm64'].includes(goarch)) throw new PreparationError('unavailable', `Unsupported Runtime target ${goos}/${goarch}`);
  if (!['darwin', 'linux'].includes(os.platform()) || (goos === 'darwin' && os.platform() !== 'darwin')) throw new PreparationError('unavailable', `Unsupported builder ${os.platform()}/${os.arch()} for ${goos}/${goarch}`);
  const config = JSON.parse(readFileSync(path.join(scripts, 'redevplugin_build_toolchain.json')));
  const architecture = goarch === 'amd64' ? 'x86_64' : 'aarch64';
  const rustTarget = `${architecture}-${goos === 'darwin' ? 'apple-darwin' : `unknown-linux-${os.platform() === 'darwin' ? 'musl' : 'gnu'}`}`;
  // The Rust preparer retains its bounded network policy and exact component checks.
  const cargo = await execute(path.join(scripts, 'prepare_redevplugin_rust_toolchain.sh'), ['--toolchain', config.rust, '--target', rustTarget], { ...process.env, ...(offline ? { REDEVEN_RUSTUP_OFFLINE: '1' } : {}) }, 'rust_unavailable');
  const rustc = path.join(path.dirname(cargo), 'rustc');
  const env = { ...process.env, PATH: `${path.dirname(cargo)}${path.delimiter}${process.env.PATH ?? ''}` };
  const targetEnv = {};
  let cIdentity;
  mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
  if (goos === 'linux' && os.platform() === 'darwin') {
    const archive = config.zig_archives[`${os.platform()}/${os.arch()}`];
    if (!archive) throw new PreparationError('unavailable', 'Pinned Zig is unavailable for this builder');
    const destination = path.join(cacheRoot, `zig-${config.zig}-${archive.sha256}`);
    const archivePath = `${destination}.tar.xz`;
    if (!existsSync(archivePath)) {
      if (offline) throw new PreparationError('cache_miss', `Pinned Zig ${config.zig} is not cached; prepare the toolchain online first`);
      const temporary = mkdtempSync(path.join(cacheRoot, '.zig-download-'));
      try {
        const download = path.join(temporary, 'archive.tar.xz');
        await execute('curl', ['--proto', '=https', '--proto-redir', '=https', '--tlsv1.2', '--fail', '--silent', '--show-error', '--location', '--retry', '2', '--retry-max-time', '120', '--connect-timeout', '15', '--max-time', '120', `https://ziglang.org/download/${config.zig}/${archive.name}`, '--output', download], process.env, 'download_failed');
        if (hash(readFileSync(download)) !== archive.sha256) throw new PreparationError('integrity_failed', 'Pinned Zig archive checksum mismatch');
        renameSync(download, archivePath);
      } finally { rmSync(temporary, { recursive: true, force: true }); }
    }
    if (hash(readFileSync(archivePath)) !== archive.sha256) throw new PreparationError('integrity_failed', 'Cached Zig archive checksum mismatch; remove the damaged toolchain archive and prepare it again');
    const zig = path.join(destination, 'zig');
    if (!existsSync(zig)) {
      const temporary = mkdtempSync(path.join(cacheRoot, '.zig-extract-'));
      try {
        await execute('tar', ['-xJf', archivePath, '--strip-components=1', '-C', temporary], process.env, 'unavailable');
        try { renameSync(temporary, destination); } catch (error) { if (!existsSync(zig)) throw error; }
      } finally { rmSync(temporary, { recursive: true, force: true }); }
    }
    if (await execute(zig, ['version'], process.env, 'unavailable') !== config.zig) throw new PreparationError('integrity_failed', 'Pinned Zig reports an unexpected version');
    const zigTarget = `${architecture}-linux-${os.platform() === 'darwin' ? 'musl' : 'gnu'}`;
    // Zig debug C compilation otherwise injects UBSan symbols absent from Rust's LLD link.
    const flags = ['-target', zigTarget, '-fPIC', '-fno-sanitize=undefined'];
    cIdentity = { version: config.zig, archive: archive.sha256, binary: hash(readFileSync(zig)), flags };
    const wrappers = path.join(cacheRoot, `wrappers-${hash(JSON.stringify({ cIdentity, scripts, source: buildToolchainSourceIdentity(path.dirname(scripts)) }))}`);
    mkdirSync(wrappers, { recursive: true, mode: 0o700 });
    for (const [name, command] of [
      ['cc', ['/bin/bash', path.join(scripts, 'redevplugin_target_cc.sh'), zig, zigTarget, rustTarget]],
      ['ar', [zig, 'ar']],
    ]) {
      const content = `#!/bin/sh\nexec ${command.map(quote).join(' ')} "$@"\n`;
      const target = path.join(wrappers, name);
      if (!existsSync(target) || readFileSync(target, 'utf8') !== content) writeFileSync(target, content, { mode: 0o755 });
    }
    targetEnv[`CC_${rustTarget.replaceAll('-', '_')}`] = path.join(wrappers, 'cc');
    targetEnv[`AR_${rustTarget.replaceAll('-', '_')}`] = path.join(wrappers, 'ar');
    targetEnv[`CARGO_TARGET_${rustTarget.toUpperCase().replaceAll('-', '_')}_RUSTFLAGS`] = `-C target-feature=+crt-static -C relocation-model=pic -C linker=${path.join(scripts, 'link_redevplugin_runtime_static_pie.sh')}`;
  } else if (goos === 'darwin') {
    targetEnv[`CC_${rustTarget.replaceAll('-', '_')}`] = await execute('xcrun', ['--find', 'clang'], process.env, 'unavailable');
    targetEnv[`AR_${rustTarget.replaceAll('-', '_')}`] = await execute('xcrun', ['--find', 'ar'], process.env, 'unavailable');
    cIdentity = { compiler: await execute(targetEnv[`CC_${rustTarget.replaceAll('-', '_')}`], ['--version'], process.env, 'unavailable') };
  }
  if (goos === 'linux' && os.platform() === 'linux') {
    if (architecture !== (os.arch() === 'x64' ? 'x86_64' : 'aarch64')) throw new PreparationError('unavailable', 'Linux native staging requires a matching builder architecture');
    targetEnv[`CC_${rustTarget.replaceAll('-', '_')}`] = await execute('sh', ['-c', 'command -v cc'], process.env, 'unavailable');
    targetEnv[`AR_${rustTarget.replaceAll('-', '_')}`] = await execute('sh', ['-c', 'command -v ar'], process.env, 'unavailable');
    cIdentity = { compiler: await execute(targetEnv[`CC_${rustTarget.replaceAll('-', '_')}`], ['--version'], process.env, 'unavailable') };
    targetEnv[`CARGO_TARGET_${rustTarget.toUpperCase().replaceAll('-', '_')}_RUSTFLAGS`] = `-C target-feature=+crt-static -C relocation-model=pic -C linker=${path.join(scripts, 'link_redevplugin_runtime_static_pie.sh')}`;
  }
  // cc-rs prefers the hyphenated spelling when both are present. Bind both.
  targetEnv[`CC_${rustTarget}`] = targetEnv[`CC_${rustTarget.replaceAll('-', '_')}`];
  targetEnv[`AR_${rustTarget}`] = targetEnv[`AR_${rustTarget.replaceAll('-', '_')}`];
  for (const name of ['CFLAGS', 'TARGET_CFLAGS', 'ARFLAGS', 'TARGET_ARFLAGS']) targetEnv[name] = '';
  targetEnv[`CFLAGS_${rustTarget}`] = '-fPIC';
  targetEnv[`CFLAGS_${rustTarget.replaceAll('-', '_')}`] = '-fPIC';
  const probe = mkdtempSync(path.join(cacheRoot, '.probe-'));
  try {
    const c = path.join(probe, 'probe.c');
    writeFileSync(c, '#include <stdint.h>\nint32_t redeven_probe(int32_t x) { return x + 1; }\n');
    writeFileSync(path.join(probe, 'probe.rs'), 'unsafe extern "C" { fn redeven_probe(x:i32)->i32; }\nfn main(){assert_eq!(unsafe{redeven_probe(41)},42);}\n');
    const cc = targetEnv[`CC_${rustTarget.replaceAll('-', '_')}`];
    const ar = targetEnv[`AR_${rustTarget.replaceAll('-', '_')}`];
    await execute(cc, [...(os.platform() === 'darwin' ? (goos === 'darwin' ? ['-target', rustTarget] : [`--target=${rustTarget}`]) : []), '-fPIC', '-c', c, '-o', path.join(probe, 'probe.o')], env);
    await execute(ar, ['crs', path.join(probe, 'libredeven_probe.a'), path.join(probe, 'probe.o')], env);
    await execute(rustc, ['--edition', '2024', '--target', rustTarget, ...(goos === 'linux' ? ['-C', 'target-feature=+crt-static', '-C', 'relocation-model=pic', '-C', `linker=${path.join(scripts, 'link_redevplugin_runtime_static_pie.sh')}`] : []), '-L', `native=${probe}`, '-l', 'static=redeven_probe', path.join(probe, 'probe.rs'), '-o', path.join(probe, 'probe')], env);
    await execute(process.execPath, [path.join(scripts, 'redevplugin_release_contract.mjs'), 'verify-runtime-executable', path.join(probe, 'probe'), `${goos}/${goarch}`], env);
  } finally { rmSync(probe, { recursive: true, force: true }); }
  const identity = hash(JSON.stringify({ host: `${os.platform()}/${os.arch()}`, rustTarget, source: buildToolchainSourceIdentity(path.dirname(scripts)), cargo: await execute(cargo, ['--version']), rustc: await execute(rustc, ['--version']), cIdentity, targetEnv }));
  console.error(`[redevplugin-toolchain] Rust, target C compiler, archive and link probe ready for ${goos}/${goarch}`);
  return { schema_version: 1, cargo, rustc, rust_target: rustTarget, identity, env: targetEnv };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancel = () => cancellation.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const values = {};
    for (let index = 2; index < process.argv.length; index += 2) {
      const flag = process.argv[index];
      if (!['--goos', '--goarch', '--cache-root', '--offline'].includes(flag) || !process.argv[index + 1]) throw new PreparationError('unavailable', 'Usage: prepare_redevplugin_build_toolchain.mjs --goos linux|darwin --goarch amd64|arm64 [--cache-root /absolute/path] [--offline 0|1]');
      values[flag] = process.argv[index + 1];
    }
    const cacheRoot = values['--cache-root'] ?? process.env.REDEVEN_REDEVPLUGIN_TOOLCHAIN_CACHE ?? path.join(os.homedir(), '.cache', 'redeven', 'redevplugin-toolchains');
    if (/[\r\n]/.test(cacheRoot + scripts) || !path.isAbsolute(cacheRoot) || !['0', '1'].includes(values['--offline'] ?? process.env.REDEVEN_TOOLCHAIN_OFFLINE ?? '0')) throw new PreparationError('unavailable', 'Toolchain cache must be absolute and offline must be 0 or 1');
    console.log(JSON.stringify(await prepareBuildToolchain({ goos: values['--goos'], goarch: values['--goarch'], cacheRoot, offline: (values['--offline'] ?? process.env.REDEVEN_TOOLCHAIN_OFFLINE) === '1' })));
  } catch (error) {
    console.error(`[redevplugin-toolchain:${error.code ?? 'unavailable'}] ${error.message}`);
    process.exitCode = cancellation.signal.aborted ? 130 : 1;
  }
}
