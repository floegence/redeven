import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function resolveUIRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return path.dirname(here);
}

function readFromUIRoot(relPath: string): string {
  return fs.readFileSync(path.join(resolveUIRoot(), relPath), 'utf8');
}

function collectTypeScriptFiles(rootDir: string): string[] {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(fullPath));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function isGuardedTestFile(filePath: string): boolean {
  return /\.test\.(ts|tsx)$/.test(filePath) || /\.e2e\.test\.(ts|tsx)$/.test(filePath) || /\.browser\.test\.tsx$/.test(filePath);
}

function normalizeRelativePath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

describe('desktop persistence architecture', () => {
  it('keeps desktop persistence binding wired through the shared helpers', () => {
    const appSrc = readFromUIRoot('./App.tsx');

    expect(appSrc).toContain("import { createUIStorageAdapter, isDesktopStateStorageAvailable } from './services/uiStorage';");
    expect(appSrc).toContain("import { resolveEnvAppStorageBinding } from './services/uiPersistence';");
    expect(appSrc).toContain('const persistenceBinding = resolveEnvAppStorageBinding({');
    expect(appSrc).toContain('desktopStateStorageAvailable: isDesktopStateStorageAvailable(),');
    expect(appSrc).toContain('adapter: createDesktopThemeStorageAdapter(');
    expect(appSrc).toContain('createUIStorageAdapter(),');
    expect(appSrc).toContain('namespace: persistenceBinding.namespace,');
    expect(appSrc).toContain('storageKey: persistenceBinding.deckStorageKey,');
  });

  it('forbids direct localStorage access outside the shared uiStorage service', () => {
    const rootDir = resolveUIRoot();
    const violations = collectTypeScriptFiles(rootDir)
      .filter((filePath) => !isGuardedTestFile(filePath))
      .filter((filePath) => normalizeRelativePath(rootDir, filePath) !== 'services/uiStorage.ts')
      .filter((filePath) => /\blocalStorage\s*\./.test(fs.readFileSync(filePath, 'utf8')))
      .map((filePath) => normalizeRelativePath(rootDir, filePath));

    expect(violations).toEqual([]);
  });
});
