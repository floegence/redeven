import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../desktop/node_modules/esbuild/lib/main.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The real published package builder owns all package and manifest semantics.
export async function buildPluginWebQualification(directory) {
  const source = path.join(directory, 'web-application');
  const ui = path.join(source, 'ui');
  await mkdir(ui, { recursive: true });
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify({
    schema_version: 'redevplugin.manifest.v9',
    publisher: { publisher_id: 'dev.redeven.qualification', display_name: 'Redeven qualification' },
    plugin: { plugin_id: 'dev.redeven.qualification.web', display_name: 'Web qualification', version: '1.0.0' },
    api: { major: 1, required_features: [], optional_features: [] }, permissions: [],
    presentation: { locales: { default: 'en-US' } },
    surfaces: [{ surface_id: 'web.view', kind: 'view', label: 'Web qualification', entry: 'ui/index.html', web: { root: 'ui', spa: false } }],
    workers: [], methods: [],
  }));
  await writeFile(path.join(ui, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Web qualification</title></head><body><button>0</button><canvas width="1" height="1"></canvas><script type="module" src="./app.js"></script></body></html>');
  await writeFile(path.join(ui, 'worker.js'), 'self.onmessage = event => self.postMessage(event.data + 1);');
  await build({
    entryPoints: { app: path.join(root, 'internal/envapp/ui_src/src/test/pluginWebApplication.fixture.ts') },
    outdir: ui, bundle: true, splitting: true, format: 'esm', platform: 'browser',
    nodePaths: [path.join(root, 'internal/envapp/ui_src/node_modules')],
  });
  const version = execFileSync('go', ['list', '-m', '-f', '{{.Version}}', 'github.com/floegence/redevplugin/v3'], { cwd: root, env: { ...process.env, GOWORK: 'off' }, encoding: 'utf8' }).trim();
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) throw new Error('Published plugin platform version required');
  const output = path.join(directory, 'web-application.redevplugin');
  execFileSync('go', ['run', `github.com/floegence/redevplugin/v3/cmd/redevplugin@${version}`, 'package', source, output], { cwd: root, env: { ...process.env, GOWORK: 'off' }, stdio: 'pipe' });
  return output;
}
