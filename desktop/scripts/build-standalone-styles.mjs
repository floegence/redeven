import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const style = await build({
  entryPoints: [require.resolve('@floegence/floe-webapp-core/standalone.css')],
  bundle: true,
  write: false,
  minify: true,
});
const target = new URL('../src/shared/floeStandaloneStyles.generated.ts', import.meta.url);
const source = `// Generated from published Floe standalone.css; run internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs.\nexport const floeStandaloneStyleText = ${JSON.stringify(style.outputFiles[0].text)};\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== source) throw new Error('floeStandaloneStyles.generated.ts is stale');
} else writeFileSync(target, source);
