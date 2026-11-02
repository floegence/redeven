import { build } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Bundle pure frontend utilities into the main process. Native SDKs, updater
// packages and their runtime assets retain their published package boundaries.
export async function buildDesktopMain({ entryPoint = 'src/main/main.ts', outfile = 'dist/main/main.js', report = true, banner } = {}) {
  const pkg = JSON.parse(readFileSync(path.join(desktop, 'package.json'), 'utf8'));
  const nodeVersion = readFileSync(path.join(desktop, '../.node-version'), 'utf8').trim();
  const result = await build({
    absWorkingDir: desktop,
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: `node${nodeVersion}`,
    external: ['electron', ...Object.keys(pkg.dependencies)],
    sourcemap: false,
    banner,
    legalComments: 'eof',
    metafile: true,
    plugins: [{
      name: 'published-css-text',
      setup(builder) {
        builder.onResolve({ filter: /[.]css[?]raw$/ }, async args => {
          const resolved = await builder.resolve(args.path.slice(0, -4), { resolveDir: args.resolveDir, kind: 'import-statement' });
          if (resolved.errors.length) return { errors: resolved.errors };
          return { path: resolved.path, namespace: 'published-css-text' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'published-css-text' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
      },
    }],
  });
  if (report) {
    const directory = path.join(desktop, 'dist/build');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'main-metafile.json'), JSON.stringify(result.metafile, null, 2) + '\n');
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildDesktopMain();
