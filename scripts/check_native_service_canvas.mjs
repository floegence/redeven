import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import qualifyRelationships from '../internal/envapp/ui_src/scripts/fixtures/nativeServiceCanvasRelations.mjs';
import qualifyConnections from '../internal/envapp/ui_src/scripts/fixtures/nativeServiceCanvasConnections.mjs';
import { repeatedCallsDocument } from '../internal/envapp/ui_src/src/styles/tessiven-relation-summary.fixture.ts';
import { connectionDocument } from '../internal/envapp/ui_src/src/styles/tessiven-connections.fixture.ts';

assert.equal(process.platform, 'darwin', 'Native canvas acceptance requires macOS WebKit');
const root = path.resolve(import.meta.dirname, '..');
const relations = process.argv.includes('--relations');
const connections = process.argv.includes('--connections');
assert(!(relations && connections), 'Choose one qualification scenario');
const args = process.argv.slice(2).filter(value => !['--relations', '--connections'].includes(value));
assert(args.length === 1 || args.length === 3 && args[1] === '--renderer-dir',
  'Usage: node scripts/check_native_service_canvas.mjs <evidence-directory> [--renderer-dir <frozen-renderer-directory>] [--relations]');
const output = path.resolve(args[0]);
const frozen = args.length === 3;
const renderer = frozen ? path.resolve(args[2]) : path.resolve(output, 'renderer');
assert(!frozen || output !== renderer && !output.startsWith(renderer + path.sep), 'Evidence must not modify the frozen renderer');
await mkdir(output, { recursive: true });
if (!frozen) {
  execFileSync(process.execPath, ['scripts/buildNativeServiceCanvas.mjs', renderer], {
    cwd: path.join(root, 'internal/envapp/ui_src'), stdio: 'inherit',
  });
}
const manifest = JSON.parse(await readFile(path.join(renderer, 'renderer-manifest.json'), 'utf8'));
assert.equal(manifest.format, 2, 'The renderer must declare its presentation contract');
assert.match(manifest.source_commit, /^[a-f0-9]{40}$/, 'The renderer must identify an immutable source commit');
assert.equal(execFileSync('git', ['cat-file', '-t', manifest.source_commit], { cwd: root, encoding: 'utf8' }).trim(), 'commit');
for (const key of ['supported_presentation_formats', 'capabilities', 'legacy_api_versions']) {
  assert(Array.isArray(manifest[key]) && manifest[key].every(value => typeof value === 'string')
    && new Set(manifest[key]).size === manifest[key].length, `Invalid renderer ${key}`);
}
assert(manifest.capabilities.length <= 16 && manifest.capabilities.every(value => /^[a-z0-9_]{1,64}$/.test(value)), 'Invalid renderer capabilities');
assert(Array.isArray(manifest.packages) && manifest.packages.length > 0
  && manifest.packages.every(value => ['name', 'version', 'license'].every(key => typeof value[key] === 'string' && value[key].length > 0))
  && new Set(manifest.packages.map(value => value.name)).size === manifest.packages.length, 'Renderer dependency provenance is missing');
assert(Array.isArray(manifest.files) && manifest.files.length > 0, 'Renderer hashes are missing');
const declaredFiles = new Set();
for (const file of manifest.files) {
  assert(typeof file.path === 'string' && !path.isAbsolute(file.path) && !file.path.includes('\\')
    && file.path.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid renderer asset path');
  assert(!declaredFiles.has(file.path), 'Duplicate renderer asset');
  declaredFiles.add(file.path);
  assert.match(file.sha256, /^[a-f0-9]{64}$/, 'Invalid renderer asset hash');
}
async function inventory(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'Renderer assets must not use symbolic links');
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await inventory(file));
    else { assert(entry.isFile(), 'Invalid renderer asset'); files.push(path.relative(renderer, file)); }
  }
  return files;
}
assert.deepEqual((await inventory(renderer)).filter(file => file !== 'renderer-manifest.json').sort(), [...declaredFiles].sort(),
  'Renderer assets do not match its complete manifest');
for (const file of manifest.files) {
  assert.equal(createHash('sha256').update(await readFile(path.join(renderer, file.path))).digest('hex'), file.sha256,
    `Renderer asset failed integrity validation: ${file.path}`);
}

// Exercise the current display adapter against the chosen bundled artifact;
// a frozen renderer is never rebuilt from current source during qualification.
const { build } = await import(pathToFileURL(path.join(root, 'internal/envapp/ui_src/node_modules/esbuild/lib/main.js')).href);
const adapter = await build({ entryPoints: [path.join(root, 'internal/tessiven_ui/src/presentation.ts')],
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { toRenderVersion } = await import('data:text/javascript;base64,' + Buffer.from(adapter.outputFiles[0].text).toString('base64'));
const document = connections ? connectionDocument() : relations ? repeatedCallsDocument(1000)
  : JSON.parse(await readFile(path.join(root, 'internal/envapp/ui_src/src/styles/fixtures/tessiven-hadoop.json'), 'utf8'));
if (!relations && !connections) {
  document.presentation.initiallyExpanded = document.groups.map(group => group.id);
  document.groups.find(group => group.id === 'g-master').instanceRefs = ['inst-nn-a', 'inst-nn-b'];
}
const version = toRenderVersion({ canvas_id: 'qualification', number: 1, source: 'example', document });
assert(manifest.supported_presentation_formats.includes(version.view.format), 'The frozen renderer does not support the oldest display contract');
version.view.capabilities = version.view.capabilities.filter(value => manifest.capabilities.includes(value));
if (!version.view.capabilities.includes('group_layouts')) delete version.view.model.presentation.groupLayouts;
const input = {
  version,
  render_id: 'qualification', historical: false, dark: false, contrast: false,
};
const fixture = path.resolve(output, 'input.json');
await writeFile(fixture, JSON.stringify(input));
const qualification = path.join(output, 'qualification.js');
if (relations || connections) await writeFile(qualification, `return (${(connections ? qualifyConnections : qualifyRelationships).toString()})();`);
const result = execFileSync('swift', [path.join(root, 'internal/envapp/ui_src/scripts/fixtures/nativeServiceCanvas.swift'), renderer, fixture, output,
  ...(relations || connections ? [qualification, connections ? 'a2-b2' : 'host-999-agent-call'] : [])], {
  encoding: 'utf8', timeout: 150000,
});
console.log(result);
await writeFile(path.resolve(output, 'report.json'), JSON.stringify({
  source_commit: manifest.source_commit, current_source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  renderer_mode: frozen ? 'frozen' : 'current', presentation_format: version.view.format,
  capabilities: version.view.capabilities, packages: manifest.packages, scenario: connections ? 'progressive-connections' : relations ? 'pool-relationship-summaries' : 'canvas-navigation', result,
  screenshots: ['native-light.png', 'native-dark.png', 'native-hc-light.png', 'native-hc-dark.png'],
}, null, 2) + '\n');
