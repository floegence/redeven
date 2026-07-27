import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const UI_ROOT = path.resolve(process.cwd(), 'src/ui');
const FACADE_PATH = path.resolve(UI_ROOT, 'services/workspaceEffects.ts');
const DIRECT_EFFECT_PATTERN = /\brpc\.(?:fs\.(?:writeFile|mkdir|rename|copy|delete)|git\.(?:stageWorkspace|unstageWorkspace|discardWorkspace|commitWorkspace|saveStash|applyStash|dropStash|fetchRepo|pullRepo|pushRepo|checkoutBranch|switchDetached|mergeBranch|deleteBranch))\s*\(/;

function productionSources(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...productionSources(absolutePath));
    } else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.test\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
}

describe('workspace effect boundary', () => {
  it('keeps filesystem and Git mutations behind the invalidating facade', () => {
    const violations = productionSources(UI_ROOT)
      .filter((filePath) => filePath !== FACADE_PATH)
      .filter((filePath) => DIRECT_EFFECT_PATTERN.test(fs.readFileSync(filePath, 'utf8')))
      .map((filePath) => path.relative(UI_ROOT, filePath));
    expect(violations).toEqual([]);
  });
});
