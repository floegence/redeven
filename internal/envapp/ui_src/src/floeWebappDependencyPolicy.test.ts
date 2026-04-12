import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const FLOE_WEBAPP_DEPENDENCIES = [
  '@floegence/floe-webapp-core',
  '@floegence/floe-webapp-protocol',
] as const;

const PUBLISHED_NPM_DEPENDENCIES = [...FLOE_WEBAPP_DEPENDENCIES, '@floegence/floeterm-terminal-web'] as const;

const LOCAL_REFERENCE_PREFIXES = ['file:', 'link:', 'workspace:', 'portal:'] as const;

type PackageJson = {
  dependencies?: Record<string, string>;
};

type PackageLockJson = {
  packages?: Record<string, { version?: string; resolved?: string }>;
};

function resolvePackageRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), '..');
}

function readText(relPath: string): string {
  return fs.readFileSync(path.join(resolvePackageRoot(), relPath), 'utf8');
}

function readJson<T>(relPath: string): T {
  return JSON.parse(readText(relPath)) as T;
}

function readDependencySpecifiers(): Record<string, string> {
  return readJson<PackageJson>('package.json').dependencies ?? {};
}

function getDependencySpecifier(
  dependencies: Record<string, string>,
  dependencyName: (typeof PUBLISHED_NPM_DEPENDENCIES)[number],
): string {
  const specifier = dependencies[dependencyName];
  if (!specifier) {
    throw new Error(`${dependencyName} must stay declared in package.json`);
  }
  return specifier;
}

function extractVersionSpecifier(specifier: string): string {
  const match = specifier.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  if (!match) {
    throw new Error(`Cannot extract release version from specifier: ${specifier}`);
  }
  return match[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectedTarballUrl(packageName: string, version: string): string {
  const tarballName = packageName.split('/')[1];
  return `https://registry.npmjs.org/${packageName}/-/${tarballName}-${version}.tgz`;
}

describe('published npm dependency policy', () => {
  it('keeps floe-webapp core and protocol aligned to the same released version', () => {
    const dependencies = readDependencySpecifiers();
    const versions = FLOE_WEBAPP_DEPENDENCIES.map((dependencyName) =>
      extractVersionSpecifier(getDependencySpecifier(dependencies, dependencyName)),
    );

    expect(new Set(versions).size, 'floe-webapp packages must be upgraded together').toBe(1);
  });

  it('keeps published UI dependencies on released semver ranges instead of local references', () => {
    const dependencies = readDependencySpecifiers();

    for (const dependencyName of PUBLISHED_NPM_DEPENDENCIES) {
      const specifier = getDependencySpecifier(dependencies, dependencyName);

      expect(
        LOCAL_REFERENCE_PREFIXES.some((prefix) => specifier.startsWith(prefix)),
        `${dependencyName} must not point to a local checkout`,
      ).toBe(false);
      expect(specifier, `${dependencyName} must stay on a released semver range`).toMatch(/^[~^]?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
    }
  });

  it('keeps package-lock pinned to npm tarballs for declared published UI releases', () => {
    const dependencies = readDependencySpecifiers();
    const packageLock = readJson<PackageLockJson>('package-lock.json');

    for (const dependencyName of PUBLISHED_NPM_DEPENDENCIES) {
      const specifier = getDependencySpecifier(dependencies, dependencyName);
      const expectedVersion = extractVersionSpecifier(specifier);
      const packageEntry = packageLock.packages?.[`node_modules/${dependencyName}`];

      expect(packageEntry?.version, `${dependencyName} package-lock version must match package.json`).toBe(expectedVersion);
      expect(packageEntry?.resolved, `${dependencyName} package-lock entry must resolve from npm`).toBe(
        expectedTarballUrl(dependencyName, expectedVersion),
      );
    }
  });

  it('keeps pnpm-lock aligned to declared published UI releases without local link entries', () => {
    const dependencies = readDependencySpecifiers();
    const pnpmLock = readText('pnpm-lock.yaml');

    for (const dependencyName of PUBLISHED_NPM_DEPENDENCIES) {
      const specifier = getDependencySpecifier(dependencies, dependencyName);
      const expectedVersion = extractVersionSpecifier(specifier);

      expect(
        pnpmLock,
        `${dependencyName} importer specifier must match package.json`,
      ).toMatch(
        new RegExp(
          `'${escapeRegExp(dependencyName)}':\\n\\s+specifier: ${escapeRegExp(specifier)}\\n\\s+version: ${escapeRegExp(expectedVersion)}(?:\\([^\\n]+\\))?`,
        ),
      );
      expect(
        pnpmLock,
        `${dependencyName} must keep a published snapshot entry in pnpm-lock`,
      ).toMatch(new RegExp(`'${escapeRegExp(dependencyName)}@${escapeRegExp(expectedVersion)}(?:\\([^\\n]+\\))?':`));
      expect(
        pnpmLock,
        `${dependencyName} must not resolve from a local path in pnpm-lock`,
      ).not.toMatch(new RegExp(`${escapeRegExp(dependencyName)}@[^\\n]*(?:file:|link:|workspace:|portal:)`));
    }
  });
});
