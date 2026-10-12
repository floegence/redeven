import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { presentationFormat, presentationCapabilities } from '../internal/tessiven_ui/src/native/contract.ts';

assert.equal(process.platform, 'darwin', 'Native canvas acceptance requires macOS WebKit');
const root = path.resolve(import.meta.dirname, '..');
assert(process.argv[2], 'Pass an evidence output directory');
const output = path.resolve(process.argv[2]);
await mkdir(output, { recursive: true });
const renderer = path.resolve(output, 'renderer');
execFileSync(process.execPath, ['scripts/buildNativeServiceCanvas.mjs', renderer], {
  cwd: path.join(root, 'internal/envapp/ui_src'), stdio: 'inherit',
});
const document = JSON.parse(await readFile(path.join(root, 'internal/envapp/ui_src/src/styles/fixtures/tessiven-hadoop.json'), 'utf8'));
document.presentation.initiallyExpanded = document.groups.map(group => group.id);
document.groups.find(group => group.id === 'g-master').instanceRefs = ['inst-nn-a', 'inst-nn-b'];
const input = {
  version: { canvas_id: 'qualification', number: 1, source: 'example', view: {
    format: presentationFormat, model: (({ apiVersion: _version, kind: _kind, ...model }) => model)(document),
    capabilities: [...presentationCapabilities], compatibility: { status: 'complete', limitations: [] },
  } },
  render_id: 'qualification', historical: false, dark: false, contrast: false,
};
const fixture = path.resolve(output, 'input.json');
await writeFile(fixture, JSON.stringify(input));
const result = execFileSync('swift', [path.join(root, 'internal/envapp/ui_src/scripts/fixtures/nativeServiceCanvas.swift'), renderer, fixture, output], {
  encoding: 'utf8', timeout: 60000,
});
console.log(result);
const manifest = JSON.parse(await readFile(path.join(renderer, 'renderer-manifest.json'), 'utf8'));
await writeFile(path.resolve(output, 'report.json'), JSON.stringify({
  source_commit: manifest.source_commit, packages: manifest.packages, result,
  screenshots: ['native-light.png', 'native-dark.png', 'native-hc-light.png', 'native-hc-dark.png'],
}, null, 2) + '\n');
