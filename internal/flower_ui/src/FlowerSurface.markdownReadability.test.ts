import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const stylesPath = path.join(repoRoot, 'internal', 'flower_ui', 'src', 'styles', 'flower.css');

function flowerStyles(): string {
  return fs.readFileSync(stylesPath, 'utf8');
}

describe('Flower markdown readability', () => {
  it('keeps assistant markdown on a wider reading rhythm', () => {
    const css = flowerStyles();

    expect(css).toContain('.flower-message-block-stack-assistant');
    expect(css).toContain('gap: 0.75rem');
    expect(css).toContain('.flower-message-bubble-assistant .flower-chat-md-block');
    expect(css).toContain('max-width: min(100%, 58rem)');
    expect(css).toContain('line-height: 1.75');
    expect(css).toContain('.flower-chat-md-block h1');
    expect(css).toContain('font-size: 1.28rem');
    expect(css).toContain('.flower-chat-md-block hr');
  });
});
