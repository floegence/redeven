import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  normalizeLinuxDesktopArtifactName,
  normalizeLinuxDesktopArtifactPaths,
} from './releaseArtifactNames';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('releaseArtifactNames', () => {
  it('normalizes linux desktop package names to stable release arch labels', () => {
    expect(normalizeLinuxDesktopArtifactName('Redeven-Desktop-1.2.3-linux-amd64.deb'))
      .toBe('Redeven-Desktop-1.2.3-linux-x64.deb');
    expect(normalizeLinuxDesktopArtifactName('Redeven-Desktop-1.2.3-rc.1-linux-x86_64.rpm'))
      .toBe('Redeven-Desktop-1.2.3-rc.1-linux-x64.rpm');
    expect(normalizeLinuxDesktopArtifactName('Redeven-Desktop-1.2.3-linux-aarch64.rpm'))
      .toBe('Redeven-Desktop-1.2.3-linux-arm64.rpm');
  });

  it('leaves already-normalized or non-linux artifact names unchanged', () => {
    expect(normalizeLinuxDesktopArtifactName('Redeven-Desktop-1.2.3-linux-arm64.deb'))
      .toBe('Redeven-Desktop-1.2.3-linux-arm64.deb');
    expect(normalizeLinuxDesktopArtifactName('Redeven-Desktop-1.2.3-mac-arm64.dmg'))
      .toBe('Redeven-Desktop-1.2.3-mac-arm64.dmg');
  });

  it('renames linux desktop package paths in place after packaging', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-artifacts-'));
    tempDirs.push(tempDir);

    const oldPath = path.join(tempDir, 'Redeven-Desktop-1.2.3-linux-aarch64.rpm');
    await fs.writeFile(oldPath, 'rpm');

    const normalizedPaths = await normalizeLinuxDesktopArtifactPaths([oldPath]);
    const newPath = path.join(tempDir, 'Redeven-Desktop-1.2.3-linux-arm64.rpm');

    await expect(fs.access(oldPath)).rejects.toThrow();
    await expect(fs.readFile(newPath, 'utf8')).resolves.toBe('rpm');
    expect(normalizedPaths).toEqual([newPath]);
  });
});
