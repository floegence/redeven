import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBuilderBin = path.join(
  desktopDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
);
const electronBuilderArgs = ['--config', 'electron-builder.config.mjs', '--publish', 'never', ...process.argv.slice(2)];

const electronBuilder = spawnSync(electronBuilderBin, electronBuilderArgs, {
  cwd: desktopDir,
  env: process.env,
  stdio: 'inherit',
});

if (electronBuilder.status !== 0) {
  process.exit(electronBuilder.status ?? 1);
}

const normalizeScript = path.join(desktopDir, 'dist', 'build', 'normalizeArtifacts.js');
const normalizeArtifacts = spawnSync(process.execPath, [normalizeScript], {
  cwd: desktopDir,
  env: process.env,
  stdio: 'inherit',
});

process.exit(normalizeArtifacts.status ?? 1);
