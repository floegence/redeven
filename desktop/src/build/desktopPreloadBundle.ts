import fs from 'node:fs/promises';
import path from 'node:path';

import { build } from 'esbuild';

export type DesktopPreloadBuildOptions = Readonly<{
  desktopRoot?: string;
  outDir?: string;
}>;

type DesktopPreloadEntry = Readonly<{
  entryPoint: string;
  outfile: string;
}>;

function resolveDesktopRoot(desktopRoot?: string): string {
  return path.resolve(desktopRoot ?? process.cwd());
}

function resolveDesktopPreloadEntries(options: DesktopPreloadBuildOptions = {}): DesktopPreloadEntry[] {
  const desktopRoot = resolveDesktopRoot(options.desktopRoot);
  const outDir = path.resolve(options.outDir ?? path.join(desktopRoot, 'dist', 'preload'));

  return [
    {
      entryPoint: path.join(desktopRoot, 'src', 'preload', 'utility.ts'),
      outfile: path.join(outDir, 'utility.js'),
    },
    {
      entryPoint: path.join(desktopRoot, 'src', 'preload', 'session.ts'),
      outfile: path.join(outDir, 'session.js'),
    },
  ];
}

// Electron sandboxed preload execution does not provide normal relative runtime module
// resolution. We bundle preload entrypoints into self-contained files so detached child
// windows receive the same bridges as the main desktop window.
export async function buildDesktopPreloads(options: DesktopPreloadBuildOptions = {}): Promise<void> {
  const entries = resolveDesktopPreloadEntries(options);
  const firstEntry = entries[0];
  if (!firstEntry) {
    return;
  }

  await fs.mkdir(path.dirname(firstEntry.outfile), { recursive: true });

  await Promise.all(entries.map(async (entry) => {
    await build({
      entryPoints: [entry.entryPoint],
      outfile: entry.outfile,
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node20',
      external: ['electron'],
      legalComments: 'none',
      sourcemap: false,
    });
  }));
}
