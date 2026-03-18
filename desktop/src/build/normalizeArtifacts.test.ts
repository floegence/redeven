import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalizeDesktopArtifactsInDir } from './normalizeArtifacts';

describe('normalizeDesktopArtifactsInDir', () => {
  it('renames linux amd64 AppImage artifacts to x64 inside the release directory', async () => {
    const releaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-release-'));

    try {
      const sourceName = 'Redeven-Desktop-0.4.3-linux-x86_64.AppImage';
      const targetName = 'Redeven-Desktop-0.4.3-linux-x64.AppImage';
      await fs.writeFile(path.join(releaseDir, sourceName), 'artifact');

      const renamedArtifacts = await normalizeDesktopArtifactsInDir(releaseDir);

      await expect(fs.access(path.join(releaseDir, sourceName))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.readFile(path.join(releaseDir, targetName), 'utf8')).resolves.toBe('artifact');
      expect(renamedArtifacts).toEqual([`${sourceName} -> ${targetName}`]);
    } finally {
      await fs.rm(releaseDir, { recursive: true, force: true });
    }
  });

  it('keeps already-normalized artifacts unchanged', async () => {
    const releaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-release-'));

    try {
      const name = 'Redeven-Desktop-0.4.3-linux-arm64.AppImage';
      await fs.writeFile(path.join(releaseDir, name), 'artifact');

      const renamedArtifacts = await normalizeDesktopArtifactsInDir(releaseDir);

      await expect(fs.readFile(path.join(releaseDir, name), 'utf8')).resolves.toBe('artifact');
      expect(renamedArtifacts).toEqual([]);
    } finally {
      await fs.rm(releaseDir, { recursive: true, force: true });
    }
  });
});
