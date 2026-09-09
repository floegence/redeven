import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32' || process.env.REDEVEN_DESKTOP_BUNDLE_GOOS === 'windows') {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const destination = path.join(root, 'desktop/.bundle/windows-ssh');
  mkdirSync(destination, { recursive: true });
  execFileSync('go', [
    'build', '-trimpath', '-ldflags=-s -w -H=windowsgui',
    '-o', path.join(destination, 'redeven-ssh-askpass.exe'), './desktop/native/windows-ssh',
  ], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, GOWORK: 'off', GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' },
  });
}
