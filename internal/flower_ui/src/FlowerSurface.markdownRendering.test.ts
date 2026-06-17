import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const surfacePath = path.join(repoRoot, 'internal', 'flower_ui', 'src', 'FlowerSurface.tsx');

function surfaceSource(): string {
  return fs.readFileSync(surfacePath, 'utf8');
}

describe('FlowerSurface markdown rendering boundary', () => {
  it('routes markdown blocks through the Flower chat markdown renderer', () => {
    const src = surfaceSource();

    expect(src).toContain("import { FlowerMarkdownBlock } from './chat/markdown/FlowerMarkdownBlock';");
    expect(src).toContain("if (block.block_type === 'markdown')");
    expect(src).toContain('<FlowerMarkdownBlock');
    expect(src).toContain('copyCodeLabel={copy().chat.copyCode}');
    expect(src).toContain('codeCopiedLabel={copy().chat.codeCopied}');
  });

  it('keeps non-markdown content on the plain text route', () => {
    const src = surfaceSource();

    expect(src).toContain('flower-message-plain-text');
    expect(src).not.toContain('<span>{block.content}</span>');
  });

  it('binds activity row status to the timeline item status, not payload status', () => {
    const src = surfaceSource();

    expect(src).toContain("`flower-activity-inline-row-${item.status}`");
    expect(src).toContain('data-flower-activity-status={item.status}');
    expect(src).toContain('statusIcon(item.status)');
    expect(src).toContain("`flower-activity-inline-status-${item.status}`");
    expect(src).toContain('copy().chat.toolStatuses[item.status]');
    expect(src).not.toContain('payload.status');
    expect(src).not.toContain("payload['status']");
  });
});
