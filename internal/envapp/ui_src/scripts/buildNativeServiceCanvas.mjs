import { build } from 'vite';
import solid from 'vite-plugin-solid';
import { graphBlobWorkersPlugin } from '@floegence/floe-webapp-core/graph-assets';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { supportedAPIVersions, canvasKind } from '../../../tessiven_ui/src/native/contract.ts';
const native = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tessiven_ui/native');
const dependencies = path.resolve(native, '../../envapp/ui_src/node_modules');
const output = process.argv[2];
if (!output) throw new Error('Pass the renderer output directory');
// Both frozen formats currently have the same rendering shape. Fail the build
// if a claimed format diverges; new support requires a deliberate renderer change.
const schemas = await Promise.all(supportedAPIVersions.map(async apiVersion => {
  const version = apiVersion.slice('redeven.io/tessiven/'.length);
  const schema = JSON.parse(await fs.readFile(path.resolve(native, `../../../spec/tessiven/${version}.schema.json`), 'utf8'));
  if (schema.properties.apiVersion.const !== apiVersion || schema.properties.kind.const !== canvasKind) throw new Error('Native format does not match its frozen schema');
  delete schema.$id; delete schema.title; delete schema.properties.apiVersion;
  return JSON.stringify(schema);
}));
if (new Set(schemas).size !== 1) throw new Error('Native formats require different rendering contracts');
const core = path.join(dependencies, '@floegence/floe-webapp-core/dist');
const modules = new Set();
await build({
  configFile: false, root: native, base: './',
  plugins: [graphBlobWorkersPlugin(), solid(), {
    name: 'native-canvas-manifest',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk') for (const id of chunk.moduleIds) modules.add(id);
      }
    },
  }],
  resolve: { alias: [
    { find: /^@floegence\/floe-webapp-core\/graph\.css$/, replacement: path.join(core, 'graph.css') },
    { find: /^@floegence\/floe-webapp-core\/(graph|icons|ui)$/, replacement: `${core}/$1.js` },
    { find: /^@floegence\/floe-webapp-core$/, replacement: path.join(core, 'index.js') },
    { find: /^solid-js$/, replacement: `${dependencies}/solid-js/dist/solid.js` },
    { find: /^solid-js\/web$/, replacement: `${dependencies}/solid-js/web/dist/web.js` },
    { find: /^solid-js\/store$/, replacement: `${dependencies}/solid-js/store/dist/store.js` },
  ], dedupe: ['solid-js'] },
  build: { outDir: path.resolve(output), emptyOutDir: true, target: 'safari18', sourcemap: false },
});
const licenses = path.join(output, 'licenses');
await fs.mkdir(licenses, { recursive: true });
for (const name of await fs.readdir(path.join(core, 'licenses'))) {
  await fs.copyFile(path.join(core, 'licenses', name), path.join(licenses, name));
}
const packages = new Map();
for (const id of modules) {
  let folder = path.dirname(id.split('?')[0]);
  while (folder.includes('/node_modules/')) {
    const manifest = await fs.readFile(path.join(folder, 'package.json'), 'utf8').catch(() => null);
    if (manifest) {
      const pkg = JSON.parse(manifest);
      if (!pkg.version) { folder = path.dirname(folder); continue; }
      if (!packages.has(pkg.name)) {
        packages.set(pkg.name, { name: pkg.name, version: pkg.version, license: pkg.license });
        const files = await fs.readdir(folder);
        for (const file of files.filter(file => /^(license|copying)(\.|$)/i.test(file))) {
          const source = path.join(folder, file);
          if ((await fs.stat(source)).isFile()) await fs.copyFile(source, path.join(licenses, pkg.name.replaceAll('/', '-') + '-' + file));
        }
      }
      break;
    }
    folder = path.dirname(folder);
  }
}
const files = [];
async function hashes(folder) {
  for (const entry of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await hashes(file);
    else files.push({ path: path.relative(output, file), sha256: createHash('sha256').update(await fs.readFile(file)).digest('hex') });
  }
}
await hashes(output);
const corePackage = JSON.parse(await fs.readFile(path.resolve(core, '../package.json'), 'utf8'));
packages.set('elkjs', { name: 'elkjs', version: corePackage.dependencies.elkjs, license: 'EPL-2.0' });
packages.set('libavoid-js', { name: 'libavoid-js', version: corePackage.dependencies['libavoid-js'], license: 'LGPL-2.1-or-later' });
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: native, encoding: 'utf8' }).trim();
await fs.writeFile(path.join(output, 'renderer-manifest.json'), JSON.stringify({
  format: 1, source_commit: sourceCommit, supported_api_versions: supportedAPIVersions,
  packages: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)),
  files,
}, null, 2) + '\n');
