import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedVersion = '0.17.1';
const packageName = '@floegence/floeterm-terminal-web';
const goModule = 'github.com/floegence/floeterm/terminal-go';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
}

export function validateFloetermDependencies(root = repoRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'internal/envapp/ui_src/package.json'), 'utf8'));
  const packageVersion = packageJson.dependencies?.[packageName];
  const goMod = read(root, 'go.mod');
  const packageManifestText = read(root, 'internal/envapp/ui_src/package.json');
  const goMatch = goMod.match(new RegExp(`${goModule.replaceAll('/', '\\/')}\\s+v([^\\s]+)`));
  const goVersion = goMatch?.[1];
  assert(packageVersion === expectedVersion, `${packageName} must be ${expectedVersion}, found ${packageVersion ?? 'missing'}`);
  assert(goVersion === expectedVersion, `${goModule} must be v${expectedVersion}, found ${goVersion ?? 'missing'}`);

  const packageLock = JSON.parse(read(root, 'internal/envapp/ui_src/package-lock.json'));
  const lockEntry = packageLock.packages?.[`node_modules/${packageName}`];
  assert(lockEntry?.version === expectedVersion, 'package-lock Floeterm version does not match package.json');
  assert(
    lockEntry?.resolved === `https://registry.npmjs.org/@floegence/floeterm-terminal-web/-/floeterm-terminal-web-${expectedVersion}.tgz`,
    'package-lock Floeterm package must resolve from the public npm registry',
  );

  const pnpmLock = read(root, 'internal/envapp/ui_src/pnpm-lock.yaml');
  assert(pnpmLock.includes(`specifier: ${expectedVersion}`), 'pnpm importer Floeterm specifier is stale');
  assert(pnpmLock.includes(`'${packageName}@${expectedVersion}':`), 'pnpm Floeterm snapshot is missing');
  assert(pnpmLock.includes('sha512-nyGrZ8xb+IOdPJw3XoyleOaBgd2ol8KYjl3ITuU5CR5nUikb9dnbxhtVAIbbhOYJNQwQq6eD+g4tQyWn8FZQJw=='), 'pnpm Floeterm integrity is not the published artifact');

  const goSum = read(root, 'go.sum');
  assert(goSum.includes(`${goModule} v${expectedVersion} h1:OmfTgsmLqDY62xRwN2DYJt2oMA7E3eugjXu+sYEg3wY=`), 'go.sum is missing the published terminal-go checksum');
  assert(goSum.includes(`${goModule} v${expectedVersion}/go.mod h1:ZEmwGasoupP8dXTbQk/Xi/aHMdOo4TCEbeQZvhtYNyI=`), 'go.sum is missing the published terminal-go go.mod checksum');

  const floetermSumVersions = goSum
    .split('\n')
    .filter((line) => line.startsWith(`${goModule} `))
    .map((line) => line.split(/\s+/u)[1]);
  assert(floetermSumVersions.length === 2 && floetermSumVersions.every((version) => version === `v${expectedVersion}` || version === `v${expectedVersion}/go.mod`), 'go.sum contains stale or unexpected terminal-go versions');

  const notices = read(root, 'THIRD_PARTY_NOTICES.md');
  assert(notices.includes(`| ${goModule} | v${expectedVersion} |`), 'THIRD_PARTY_NOTICES.md has no current terminal-go entry');
  assert(notices.includes(`| ${packageName} | ${expectedVersion} |`), 'THIRD_PARTY_NOTICES.md has no current terminal-web entry');
  assert(!notices.includes(`| ${goModule} | v0.11.2 |`) && !notices.includes(`| ${packageName} | 0.16.6 |`), 'THIRD_PARTY_NOTICES.md retains a stale Floeterm entry');

  const okfRoot = path.join(root, 'okf');
  for (const filePath of walkFiles(okfRoot)) {
    if (filePath.endsWith(`${path.sep}log.md`)) continue;
    const source = fs.readFileSync(filePath, 'utf8');
    assert(!source.includes('terminal-go v0.17.0') && !source.includes('terminal-go v0.11.4') && !source.includes('terminal-go v0.11.2'), `${path.relative(root, filePath)} retains a stale terminal-go contract`);
    assert(!source.includes('terminal-web v0.17.0') && !source.includes('terminal-web v0.16.6'), `${path.relative(root, filePath)} retains a stale terminal-web contract`);
  }

  for (const stale of ['0.17.0', '0.16.6', 'v0.11.4', 'v0.11.2']) {
    assert(!goMod.includes(stale) && !packageManifestText.includes(stale), `active Floeterm manifests retain stale version ${stale}`);
  }
  return { version: expectedVersion };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = validateFloetermDependencies();
    console.log(`Redeven Floeterm dependency consistency verified: ${result.version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
