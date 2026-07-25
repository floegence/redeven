import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectJavaScriptLockInventory,
  packageCoordinate,
  parsePnpmPackageKey,
  parsePnpmLock,
  resolvePackageLicense,
} from './javascript_lock_inventory.mjs';

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
