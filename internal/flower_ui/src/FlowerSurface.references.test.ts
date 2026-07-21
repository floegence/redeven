import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const surfacePath = path.join(repoRoot, 'internal', 'flower_ui', 'src', 'FlowerSurface.tsx');
const stylesPath = path.join(repoRoot, 'internal', 'flower_ui', 'src', 'styles', 'flower.css');

describe('Flower canonical reference presentation', () => {
  it('separates admitted canonical references from queued context actions', () => {
    const source = fs.readFileSync(surfacePath, 'utf8');

    expect(source).toContain('parseChatMessageReferences(msg.references');
    expect(source).toContain('parseChatContextAction(turn().context_action)');
    expect(source).toContain('linkedContextLabel={copy().chat.linkedContextLabel}');
    expect(source).not.toContain('parseChatContextAction(msg.context_action)');
  });

  it('keeps uploaded attachments and linked references in the unified user bubble', () => {
    const source = fs.readFileSync(surfacePath, 'utf8');
    const unifiedBubble = source.indexOf('flower-chat-context-unified-bubble');
    const attachment = source.indexOf('messageAttachmentBlock(() => block)', unifiedBubble);
    const references = source.indexOf('<FlowerChatContextChips', unifiedBubble);

    expect(unifiedBubble).toBeGreaterThanOrEqual(0);
    expect(attachment).toBeGreaterThan(unifiedBubble);
    expect(references).toBeGreaterThan(attachment);
  });

  it('constrains long Unicode labels and details without horizontal overlap on narrow surfaces', () => {
    const css = fs.readFileSync(stylesPath, 'utf8');

    expect(css).toContain('.flower-chat-context-chip-text');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('.flower-chat-context-chip-label');
    expect(css).toContain('text-overflow: ellipsis');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
  });
});
