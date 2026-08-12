import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertNpmDirectDependenciesLocked,
  assertPlatformFilteredLicensesResolvable,
  collectJavaScriptLockInventory,
  packageCoordinate,
  parsePnpmPackageKey,
  parsePnpmLock,
  resolvePackageLicense,
} from './javascript_lock_inventory.mjs';

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

const npmPackageRoots = [
  { label: 'Desktop shell', path: '../desktop' },
  { label: 'Env App UI', path: '../internal/envapp/ui_src' },
  { label: 'Code App UI', path: '../internal/codeapp/ui_src' },
];

test('repository npm package roots keep direct dependencies aligned with package-lock', () => {
  for (const root of npmPackageRoots) {
    assertNpmDirectDependenciesLocked(
      readJson(`${root.path}/package.json`),
      readJson(`${root.path}/package-lock.json`),
      root.label,
    );
  }
});

test('npm direct dependency lock validation accepts exact and ranged dependencies', () => {
  assert.doesNotThrow(() => assertNpmDirectDependenciesLocked(
    {
      dependencies: { exact: '1.2.3', ranged: '^4.5.0' },
      devDependencies: { development: '~6.0.0' },
      optionalDependencies: { optional: '7.8.9-beta.1' },
    },
    {
      packages: {
        '': {
          dependencies: { exact: '1.2.3', ranged: '^4.5.0' },
          devDependencies: { development: '~6.0.0' },
          optionalDependencies: { optional: '7.8.9-beta.1' },
        },
        'node_modules/exact': { version: '1.2.3' },
        'node_modules/ranged': { version: '4.9.1' },
        'node_modules/development': { version: '6.0.4' },
        'node_modules/optional': { version: '7.8.9-beta.1' },
      },
    },
    'fixture package',
  ));
});

test('npm direct dependency lock validation reports missing and drifted entries', () => {
  assert.throws(
    () => assertNpmDirectDependenciesLocked(
      { dependencies: { missing: '1.0.0', drifted: '2.0.0' } },
      {
        packages: {
          '': { dependencies: { drifted: '1.0.0' } },
          'node_modules/drifted': { version: '1.0.0' },
        },
      },
      'fixture package',
    ),
    (error) => {
      assert.match(error.message, /missing specifier "1\.0\.0" != "missing"/u);
      assert.match(error.message, /drifted specifier "2\.0\.0" != "1\.0\.0"/u);
      return true;
    },
  );
  assert.throws(
    () => assertNpmDirectDependenciesLocked(
      { dependencies: { exact: '3.2.1' } },
      {
        packages: {
          '': { dependencies: { exact: '3.2.1' } },
          'node_modules/exact': { version: '3.2.0' },
        },
      },
      'fixture package',
    ),
    /exact version "3\.2\.1" != "3\.2\.0"/u,
  );
  assert.throws(
    () => assertNpmDirectDependenciesLocked({}, { packages: {} }, 'fixture package'),
    /package-lock must contain the root package entry/u,
  );
});

test('parsePnpmPackageKey supports scoped packages and strips peer context', () => {
  assert.deepEqual(parsePnpmPackageKey('@electron/rebuild@4.0.4'), {
    name: '@electron/rebuild',
    version: '4.0.4',
  });
  assert.deepEqual(parsePnpmPackageKey('seroval-plugins@1.5.4(seroval@1.5.4)'), {
    name: 'seroval-plugins',
    version: '1.5.4',
  });
  assert.throws(() => parsePnpmPackageKey('missing-version'), /unsupported pnpm package key/u);
});

test('collectJavaScriptLockInventory retains npm and pnpm mismatches and pnpm-only packages', () => {
  const inventory = collectJavaScriptLockInventory([{
    label: 'Desktop shell',
    packageLock: {
      packages: {
        'node_modules/@electron/rebuild': { version: '4.2.0', license: 'MIT' },
        'node_modules/seroval': { version: '1.5.6', license: 'MIT' },
      },
    },
    pnpmLock: {
      lockfileVersion: '9.0',
      packages: {
        '@electron/rebuild@4.0.4': {},
        'seroval@1.5.4': {},
        'pnpm-only@2.0.0': {},
      },
    },
  }]);

  assert.deepEqual(inventory.map(({ name, version }) => packageCoordinate(name, version)), [
    '@electron/rebuild@4.0.4',
    '@electron/rebuild@4.2.0',
    'pnpm-only@2.0.0',
    'seroval@1.5.4',
    'seroval@1.5.6',
  ]);
  assert.deepEqual(
    inventory.find(({ name, version }) => name === 'pnpm-only' && version === '2.0.0'),
    {
      name: 'pnpm-only',
      version: '2.0.0',
      licenses: [],
      scopes: ['Desktop shell'],
      lockKinds: ['pnpm'],
      platformFiltered: false,
    },
  );
});

test('collectJavaScriptLockInventory merges lock provenance without duplicating a package', () => {
  const inventory = collectJavaScriptLockInventory([
    {
      label: 'Desktop shell',
      packageLock: { packages: { 'node_modules/shared': { version: '1.0.0', license: 'MIT' } } },
      pnpmLock: { lockfileVersion: '9.0', packages: { 'shared@1.0.0': {} } },
    },
    {
      label: 'Env App UI',
      packageLock: { packages: { 'node_modules/shared': { version: '1.0.0', license: 'MIT' } } },
    },
  ]);

  assert.deepEqual(inventory, [{
    name: 'shared',
    version: '1.0.0',
    licenses: ['MIT'],
    scopes: ['Desktop shell', 'Env App UI'],
    lockKinds: ['npm', 'pnpm'],
    platformFiltered: false,
  }]);
});

test('parsePnpmLock accepts only the supported pnpm v9 package schema', () => {
  assert.deepEqual(parsePnpmLock({ lockfileVersion: '9.0', packages: {} }), []);
  assert.throws(
    () => parsePnpmLock({ lockfileVersion: '8.0', packages: {} }),
    /unsupported pnpm lockfileVersion/u,
  );
  assert.throws(
    () => parsePnpmLock({ lockfileVersion: '9.0' }),
    /packages must be an object/u,
  );
  assert.throws(
    () => parsePnpmLock({ lockfileVersion: '9.0', packages: [] }),
    /packages must be an object/u,
  );
  assert.throws(
    () => parsePnpmLock({ lockfileVersion: '9.0', packages: { 'invalid@1.0.0': null } }),
    /package metadata must be an object/u,
  );
});

test('resolvePackageLicense fails closed without exact evidence or an audited override', () => {
  assert.deepEqual(resolvePackageLicense({ name: 'unknown', version: '1.0.0', licenses: [] }), {
    license: 'UNKNOWN',
    notes: [],
  });
});

test('resolvePackageLicense validates override conflicts and prefers coordinate audit notes', () => {
  const packageOverrides = new Map([['shared', { license: 'MIT', note: 'package audit' }]]);
  const coordinateOverrides = new Map([['shared@1.0.0', { license: 'MIT', note: 'coordinate audit' }]]);
  assert.deepEqual(
    resolvePackageLicense(
      { name: 'shared', version: '1.0.0', licenses: [] },
      { packageOverrides, coordinateOverrides },
    ),
    { license: 'MIT', notes: ['coordinate audit'] },
  );
  assert.throws(
    () => resolvePackageLicense(
      { name: 'shared', version: '1.0.0', licenses: [] },
      {
        packageOverrides,
        coordinateOverrides: new Map([['shared@1.0.0', { license: 'Apache-2.0' }]]),
      },
    ),
    /conflicting audited license overrides/u,
  );
  assert.throws(
    () => resolvePackageLicense(
      { name: 'shared', version: '1.0.0', licenses: ['Apache-2.0'] },
      { coordinateOverrides },
    ),
    /override conflicts with exact metadata/u,
  );
});

test('resolvePackageLicense rejects conflicting exact-coordinate metadata', () => {
  assert.throws(
    () => resolvePackageLicense({ name: 'shared', version: '1.0.0', licenses: ['MIT', 'ISC'] }),
    /conflicting exact license metadata/u,
  );
});

test('platform-filtered lock packages resolve without installed manifest evidence', () => {
  const inventory = collectJavaScriptLockInventory([{
    label: 'UI',
    packageLock: {
      packages: {
        'node_modules/exact-platform-package': { version: '1.0.0', license: 'MIT' },
      },
    },
    pnpmLock: {
      lockfileVersion: '9.0',
      packages: {
        'exact-platform-package@1.0.0': { os: ['darwin'], cpu: ['arm64'] },
        'audited-platform-package@2.0.0': { os: ['linux'], cpu: ['x64'] },
        'libc-only-platform-package@3.0.0': { libc: ['musl'] },
      },
    },
  }]);
  const coordinateOverrides = new Map([
    ['audited-platform-package@2.0.0', { license: 'Apache-2.0', note: 'exact registry audit' }],
    ['libc-only-platform-package@3.0.0', { license: 'MIT', note: 'exact registry audit' }],
  ]);

  assert.doesNotThrow(() => assertPlatformFilteredLicensesResolvable(inventory, { coordinateOverrides }));
  assert.throws(
    () => assertPlatformFilteredLicensesResolvable(inventory, { coordinateOverrides: new Map() }),
    /audited-platform-package@2\.0\.0/u,
  );
  const libcPackage = inventory.find(({ name }) => name === 'libc-only-platform-package');
  assert.equal(libcPackage?.platformFiltered, true);
});
