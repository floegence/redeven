import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeDesktopArtifactName } from './artifactNames';

export async function normalizeDesktopArtifactsInDir(releaseDir: string): Promise<string[]> {
  const entries = await fs.readdir(releaseDir, { withFileTypes: true });
  const renamedArtifacts: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const nextName = normalizeDesktopArtifactName(entry.name);
    if (nextName === entry.name) {
      continue;
    }

    const fromPath = path.join(releaseDir, entry.name);
    const toPath = path.join(releaseDir, nextName);

    try {
      await fs.access(toPath);
      throw new Error(`normalized artifact already exists: ${nextName}`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }

    await fs.rename(fromPath, toPath);
    renamedArtifacts.push(`${entry.name} -> ${nextName}`);
  }

  return renamedArtifacts;
}

const releaseDir = path.resolve(__dirname, '..', '..', 'release');

async function main(): Promise<void> {
  const renamedArtifacts = await normalizeDesktopArtifactsInDir(releaseDir);

  for (const artifact of renamedArtifacts) {
    console.log(`Renamed desktop artifact: ${artifact}`);
  }
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
