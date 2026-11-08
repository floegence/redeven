import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'redeven-access-icon-'));
const iconset = path.join(temporary, 'desktop-access.iconset');
mkdirSync(iconset);
try {
  for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
    execFileSync('sips', ['-s', 'format', 'png', '-z', String(size * scale), String(size * scale),
      path.join(root, 'desktop/build/desktop-access.svg'), '--out', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], {stdio: 'ignore'});
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(root, 'desktop/build/desktop-access.icns')]);
} finally {
  rmSync(temporary, {recursive: true});
}
