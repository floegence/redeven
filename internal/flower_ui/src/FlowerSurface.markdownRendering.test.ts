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
    expect(src).toContain("block().block_type === 'markdown'");
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

  it('renders running activity rows with the subdued square loader', () => {
    const src = surfaceSource();

    expect(src).toContain('flower-activity-inline-loader');
    expect(src).toContain('flower-activity-inline-loader-square');
    expect(src).toContain("case 'running':");
    expect(src).not.toContain("case 'running':\n        return <Terminal");
  });

  it('renders the streaming cursor after every message block', () => {
    const src = surfaceSource();
    const blockListIndex = src.indexOf('<Index each={blocks()}>');
    const cursorTailIndex = src.indexOf('flower-message-streaming-tail');

    expect(blockListIndex).toBeGreaterThanOrEqual(0);
    expect(cursorTailIndex).toBeGreaterThan(blockListIndex);
    expect(src).toContain('{streamingCursor()}');
    expect(src).not.toContain('<Show when={streaming}>{streamingCursor()}</Show>');
  });

  it('adds copy actions and user message time metadata to chat messages', () => {
    const src = surfaceSource();

    expect(src).toContain('MESSAGE_COPY_RESET_MS');
    expect(src).toContain('copiedMessageAction()');
    expect(src).toContain('writeTextToClipboard(value)');
    expect(src).toContain('copy().chat.copyMessage');
    expect(src).toContain('copy().chat.messageCopied');
    expect(src).toContain('flower-message-copy-button');
    expect(src).toContain('flower-message-copy-icon-idle');
    expect(src).toContain('flower-message-copy-icon-copied');
    expect(src).toContain('formatMessageTime(message().created_at_ms)');
    expect(src).toContain('flower-message-time');
    expect(src).toContain("block().block_type !== 'thinking'");
  });
});
