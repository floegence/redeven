import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectJavaScriptLockInventory,
  packageCoordinate,
  parsePnpmPackageKey,
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
      pnpmLock: { packages: { 'shared@1.0.0': {} } },
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
