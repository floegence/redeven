import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'desktop', '.containers-v4-development');
const staging = `${output}.staging`;
const officialPluginsRepository = 'https://github.com/floegence/redeven-official-plugins.git';
const officialPluginsCommit = 'b9eb04f6cc08eab35e0d0a8a5ac671ec5077aaed';
const sourceRoot = join(staging, 'official-plugins-source');
const pluginRoot = join(sourceRoot, 'plugins', 'containers');
const contractPath = join(root, 'spec', 'capabilities', 'container-resources-v4.contract.json');
const releaseNotesPath = join(root, 'internal', 'envapp', 'ui_src', 'src', 'ui', 'plugins', 'officialPluginReleaseNotes.json');
const cli = ['run', 'github.com/floegence/redevplugin/cmd/redevplugin@v0.6.23'];

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true, mode: 0o700 });
checkoutOfficialPluginSource();
ensurePluginDependencies();
run('npm', ['run', 'build'], pluginRoot);
run('go', [...cli, 'keygen', 'redeven-containers-v4-development', join(staging, 'private.json'), join(staging, 'public.json')], root);

const commit = run('git', ['rev-parse', 'HEAD'], root).trim();
const capabilityConfig = {
  contract_file: contractPath,
  private_key_file: join(staging, 'private.json'),
  artifact_base_ref: 'capabilities/redeven.container_resources.v4/v4.0.0',
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
  source_commit: commit,
  min_redevplugin_version: '0.6.23',
  signature_policy_epoch: '1',
  signature_revocation_epoch: '1',
};
writeFileSync(join(staging, 'capability-build.json'), `${JSON.stringify(capabilityConfig, null, 2)}\n`, { mode: 0o600 });
run('go', [...cli, 'host-capability', 'build', join(staging, 'capability-build.json'), join(staging, 'capability')], root);

const pin = JSON.parse(readFileSync(join(staging, 'capability', 'host-capability.pin.json'), 'utf8'));
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
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
manifest.capability_bindings = [{ binding_id: 'containers-v4', contract: pin }];
manifest.methods = contract.methods.map((method) => ({
  method: method.name,
  route: { kind: 'capability', binding_id: 'containers-v4', target_method: method.name },
}));
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const packagePath = join(staging, 'containers-4.0.0.redevplugin');
run('go', [...cli, 'package', packageRoot, packagePath], root);
run('go', [...cli, 'validate', packagePath], root);

const descriptor = {
  schema_version: 'redeven.plugin_development_delivery.v2',
  plugin_instance_id: 'plugini_redeven_official_containers',
  publisher_id: 'com.redeven.official',
  plugin_id: 'com.redeven.official.containers',
  version: '4.0.0',
  package_path: packagePath,
  package_sha256: sha256(readFileSync(packagePath)),
  capability_root: join(staging, 'capability'),
  capability_pin_path: join(staging, 'capability', 'host-capability.pin.json'),
  capability_public_key_path: join(staging, 'public.json'),
  contract_sha256: pin.artifact_sha256,
  release_notes_id: releaseNotes.release_id,
  release_notes_summary_sha256: releaseNotes.summary_sha256,
  source_repository: officialPluginsRepository,
  source_commit: officialPluginsCommit,
};
writeFileSync(join(staging, 'delivery.json'), `${JSON.stringify(descriptor, null, 2)}\n`, { mode: 0o600 });
rmSync(join(staging, 'private.json'), { force: true });
rmSync(join(staging, 'capability-build.json'), { force: true });
rmSync(join(staging, 'package-root'), { recursive: true, force: true });
rmSync(sourceRoot, { recursive: true, force: true });
rmSync(output, { recursive: true, force: true });
renameSync(staging, output);

const finalDescriptor = join(output, 'delivery.json');
const adjusted = JSON.parse(readFileSync(finalDescriptor, 'utf8'));
adjusted.package_path = join(output, 'containers-4.0.0.redevplugin');
adjusted.capability_root = join(output, 'capability');
adjusted.capability_pin_path = join(output, 'capability', 'host-capability.pin.json');
adjusted.capability_public_key_path = join(output, 'public.json');
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
