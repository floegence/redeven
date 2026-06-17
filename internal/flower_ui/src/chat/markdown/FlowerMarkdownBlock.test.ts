import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'FlowerMarkdownBlock.tsx');

function source(): string {
  return fs.readFileSync(sourcePath, 'utf8');
}

describe('FlowerMarkdownBlock component wiring', () => {
  it('uses explicit streaming snapshot tails and code-copy helpers', () => {
    const src = source();

    expect(src).toContain('buildMarkdownRenderSnapshot');
    expect(src).toContain('StreamingMarkdownTail');
    expect(src).toContain('decorateFlowerMarkdownCodeBlocks');
    expect(src).toContain('flowerMarkdownCodeTextForCopyButton');
    expect(src).not.toContain('committedSourceLength <');
    expect(src).not.toContain('document.querySelectorAll');
  });
});
