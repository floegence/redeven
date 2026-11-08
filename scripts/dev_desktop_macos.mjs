import { constants, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeDigest } from './dev_desktop_build_cache.mjs';

export function prepareDevelopmentApp(electron, stateRoot, instance, desktop) {
  if (![electron, stateRoot, desktop].every(path.isAbsolute) || !/^[a-zA-Z0-9-]+$/.test(instance)) throw new Error('Expected absolute paths and a valid development instance identity.');
  const source = path.resolve(electron, '../../..');
  if (!source.endsWith('.app') || !existsSync(path.join(source, 'Contents/Info.plist'))) throw new Error('Expected the installed Electron application bundle.');
  const root = path.join(stateRoot, 'desktop/macos-launch');
  const destination = path.join(root, 'Redeven Desktop Dev.app');
  const swift = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dev_desktop_launch.swift');
  const signature = createHash('sha256').update(treeDigest(source, { dependencies: true })).update(readFileSync(fileURLToPath(import.meta.url)))
    .update(readFileSync(swift)).update(readFileSync(path.join(desktop, 'build/icon.icns'))).update(instance).digest('hex');
  const receipt = path.join(root, 'identity');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const launcher = path.join(root, 'launch');
  let saved;
  try { saved = JSON.parse(readFileSync(receipt, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  if (saved?.input === signature && existsSync(launcher) && existsSync(destination)
      && saved.launcher === createHash('sha256').update(readFileSync(launcher)).digest('hex')
      && saved.app === treeDigest(destination, { dependencies: true })) {
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', destination]);
    return { launcher, app: destination };
  }
  const staging = path.join(root, `stage-${process.pid}.app`);
  try {
    cpSync(source, staging, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
    const plist = path.join(staging, 'Contents/Info.plist');
    const info = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }));
    info.CFBundleIdentifier = `com.floegence.redeven.desktop.dev.${instance}`;
    info.CFBundleName = info.CFBundleDisplayName = 'Redeven Desktop Dev';
    info.CFBundleIconFile = 'redeven.icns';
    writeFileSync(plist, JSON.stringify(info));
    execFileSync('/usr/bin/plutil', ['-convert', 'xml1', plist]);
    cpSync(path.join(desktop, 'build/icon.icns'), path.join(staging, 'Contents/Resources/redeven.icns'));
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements,flags,runtime', staging], { stdio: ['ignore', 'ignore', 'inherit'] });
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', staging]);
    execFileSync('/usr/bin/swiftc', [swift, '-o', launcher]);
    rmSync(destination, { recursive: true, force: true });
    renameSync(staging, destination);
    writeFileSync(receipt, JSON.stringify({ input: signature, app: treeDigest(destination, { dependencies: true }),
      launcher: createHash('sha256').update(readFileSync(launcher)).digest('hex') }), { mode: 0o600 });
    return { launcher, app: destination };
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = prepareDevelopmentApp(...process.argv.slice(2));
  process.stdout.write(result.launcher + '\n' + result.app + '\n');
}
