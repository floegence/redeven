import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  bindContainersProductionCapability,
  loadContainersProductionCapability,
} from './containers_development_contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'desktop', '.containers-v4-development');
const staging = `${output}.staging`;
const officialPluginsRepository = 'https://github.com/floegence/redeven-official-plugins.git';
const officialPluginsCommit = 'b9eb04f6cc08eab35e0d0a8a5ac671ec5077aaed';
const sourceRoot = join(staging, 'official-plugins-source');
const pluginRoot = join(sourceRoot, 'plugins', 'containers');
const releaseNotesPath = join(root, 'internal', 'envapp', 'ui_src', 'src', 'ui', 'plugins', 'officialPluginReleaseNotes.json');
const cli = ['run', 'github.com/floegence/redevplugin/cmd/redevplugin@v0.6.23'];
const productionCapability = loadContainersProductionCapability(root);

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true, mode: 0o700 });
checkoutOfficialPluginSource();
ensurePluginDependencies();
run('npm', ['run', 'build'], pluginRoot);
const releaseNotesCatalog = JSON.parse(readFileSync(releaseNotesPath, 'utf8'));
const releaseNotes = releaseNotesCatalog.releases.find((release) => (
  release.plugin_id === 'com.redeven.official.containers' && release.target_version === '4.0.0'
));
if (!releaseNotes || !/^[a-f0-9]{64}$/u.test(releaseNotes.summary_sha256)) {
  throw new Error('Containers 4.0.0 release notes binding is missing or invalid');
}
const packageRoot = join(staging, 'package-root');
cpSync(join(pluginRoot, 'dist'), packageRoot, { recursive: true });
const manifestPath = join(packageRoot, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
bindContainersProductionCapability(manifest, productionCapability);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const packagePath = join(staging, 'containers-4.0.0.redevplugin');
run('go', [...cli, 'package', packageRoot, packagePath], root);
run('go', [...cli, 'validate', packagePath], root);

const descriptor = {
  schema_version: 'redeven.plugin_development_delivery.v3',
  plugin_instance_id: 'plugini_redeven_official_containers',
  publisher_id: 'com.redeven.official',
  plugin_id: 'com.redeven.official.containers',
  version: '4.0.0',
  package_path: packagePath,
  package_sha256: sha256(readFileSync(packagePath)),
  release_notes_id: releaseNotes.release_id,
  release_notes_summary_sha256: releaseNotes.summary_sha256,
  source_repository: officialPluginsRepository,
  source_commit: officialPluginsCommit,
};
writeFileSync(join(staging, 'delivery.json'), `${JSON.stringify(descriptor, null, 2)}\n`, { mode: 0o600 });
rmSync(join(staging, 'package-root'), { recursive: true, force: true });
rmSync(sourceRoot, { recursive: true, force: true });
rmSync(output, { recursive: true, force: true });
renameSync(staging, output);

const finalDescriptor = join(output, 'delivery.json');
const adjusted = JSON.parse(readFileSync(finalDescriptor, 'utf8'));
adjusted.package_path = join(output, 'containers-4.0.0.redevplugin');
writeFileSync(finalDescriptor, `${JSON.stringify(adjusted, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${finalDescriptor}\n`);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function ensurePluginDependencies() {
  const packageManifest = join(pluginRoot, 'package.json');
  const packageLock = join(pluginRoot, 'package-lock.json');
  const installMarker = join(pluginRoot, 'node_modules', '.package-lock.json');
  const requiredDependency = join(pluginRoot, 'node_modules', '@floegence', 'redevplugin-ui', 'package.json');
  const needsInstall = !existsSync(installMarker)
    || !existsSync(requiredDependency)
    || statSync(packageManifest).mtimeMs > statSync(installMarker).mtimeMs
    || statSync(packageLock).mtimeMs > statSync(installMarker).mtimeMs;
  if (needsInstall) run('npm', ['ci', '--no-audit', '--no-fund'], pluginRoot);
}

function checkoutOfficialPluginSource() {
  mkdirSync(sourceRoot, { recursive: true, mode: 0o700 });
  run('git', ['init', '--quiet'], sourceRoot);
  run('git', ['remote', 'add', 'origin', officialPluginsRepository], sourceRoot);
  run('git', ['fetch', '--quiet', '--depth', '1', 'origin', officialPluginsCommit], sourceRoot);
  run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], sourceRoot);
  const resolved = run('git', ['rev-parse', 'HEAD'], sourceRoot).trim();
  if (resolved !== officialPluginsCommit) {
    throw new Error(`Containers source resolved to unexpected commit ${resolved}`);
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, GOWORK: 'off' } });
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
  return result.stdout;
}
