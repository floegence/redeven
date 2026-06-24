import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const surfacePath = path.join(repoRoot, 'internal', 'flower_ui', 'src', 'FlowerSurface.tsx');
const compactionDividerPath = path.join(repoRoot, 'internal', 'flower_ui', 'src', 'chat', 'FlowerContextCompactionDivider.tsx');

function surfaceSource(): string {
  return fs.readFileSync(surfacePath, 'utf8');
}

function compactionDividerSource(): string {
  return fs.readFileSync(compactionDividerPath, 'utf8');
}

describe('FlowerSurface markdown rendering boundary', () => {
  it('routes markdown blocks through the Flower chat markdown renderer', () => {
    const src = surfaceSource();

    expect(src).toContain("import { FlowerMarkdownBlock } from './chat/markdown/FlowerMarkdownBlock';");
    expect(src).toContain("const markdown = createMemo(() => block().block_type === 'markdown')");
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

    expect(src).toContain("`flower-activity-inline-row-${item().status}`");
    expect(src).toContain('data-flower-activity-status={item().status}');
    expect(src).toContain('statusIcon(item().status)');
    expect(src).toContain("`flower-activity-inline-status-${item().status}`");
    expect(src).toContain('copy().chat.toolStatuses[item().status]');
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

  it('renders context usage in the header and model status in the bottom dock outside timeline entries', () => {
    const src = surfaceSource();
    const timelineListIndex = src.indexOf('<For each={visibleTimelineEntryKeys()}>');
    const headerIndex = src.indexOf('flower-chat-header flower-chat-header');
    const headerRowIndex = src.indexOf('flower-chat-header-row');
    const contextStripIndex = src.indexOf('flower-chat-context-strip');
    const contextMeterIndex = src.indexOf('<FlowerContextUsageMeter');
    const dockIndex = src.indexOf('flower-chat-bottom-dock-track');
    const statusLaneIndex = src.indexOf('flower-model-status-lane');
    const composerIndex = src.indexOf('flower-composer flower-chat-input-floating');

    expect(headerIndex).toBeGreaterThanOrEqual(0);
    expect(headerRowIndex).toBeGreaterThan(headerIndex);
    expect(contextStripIndex).toBeGreaterThan(headerRowIndex);
    expect(contextMeterIndex).toBeGreaterThan(contextStripIndex);
    expect(timelineListIndex).toBeGreaterThan(contextMeterIndex);
    expect(timelineListIndex).toBeGreaterThanOrEqual(0);
    expect(dockIndex).toBeGreaterThan(timelineListIndex);
    expect(statusLaneIndex).toBeGreaterThan(dockIndex);
    expect(composerIndex).toBeGreaterThan(statusLaneIndex);
    expect(src).toContain('const selectedModelIOStatus = createMemo<FlowerModelIOStatus | null>(() => selectedThread()?.model_io_status ?? null)');
    expect(src).toContain('const selectedThreadHasModelStatus = createMemo(() => selectedModelIOStatus() != null)');
    expect(src).toContain('<Show when={selectedThreadHasModelStatus()}>');
    expect(src).toContain('const selectedModelStatusIndicator = () => modelStatusIndicator(selectedModelIOStatus(), selectedModelStatusLabel())');
    expect(src).toContain('{selectedModelStatusIndicator()}');
    expect(src).toContain('<Show when={selectedContextUsage()}>');
    expect(src).toContain('<FlowerContextUsageMeter usage={usage()} copy={copy()} />');
    expect(src).toContain('role="status"');
    expect(src).toContain('aria-live="polite"');
    expect(src).toContain('aria-atomic="true"');
    expect(src).toContain('copy().chat.modelStatus');
    expect(src).toContain('DEFAULT_FLOWER_SURFACE_COPY.chat.modelStatus');
    expect(src).toContain('data-text={label}');
    expect(src).not.toContain('contextMeter()');
    expect(src).not.toContain('selectedThreadThinking');
    expect(src).not.toContain('thinkingIndicator');
    expect(src).not.toContain('flower-message-streaming-tail');
    expect(src).not.toContain('flower-streaming-cursor');
  });

  it('renders context compaction timeline decorations as non-message divider entries', () => {
    const src = surfaceSource();
    const dividerSrc = compactionDividerSource();

    expect(src).toContain("case 'context_compaction':");
    expect(src).toContain('compactionDividerEntry');
    expect(src).toContain('<FlowerContextCompactionDivider');
    expect(dividerSrc).toContain('flower-compaction-divider');
    expect(dividerSrc).toContain('data-flower-compaction-status={compaction().status}');
    expect(src).not.toContain("case 'decoration':");
  });

  it('renders the scroll-to-latest control as a floating dock affordance above the composer', () => {
    const src = surfaceSource();
    const dockIndex = src.indexOf('flower-chat-bottom-dock flower-chat-bottom-dock');
    const floatIndex = src.indexOf('flower-scroll-to-latest-float', dockIndex);
    const scrollButtonIndex = src.indexOf('flower-scroll-to-latest-button', floatIndex);
    const dockTrackIndex = src.indexOf('flower-chat-bottom-dock-track', scrollButtonIndex);
    const statusLaneIndex = src.indexOf('flower-model-status-lane', dockTrackIndex);
    const composerIndex = src.indexOf('flower-composer flower-chat-input-floating', statusLaneIndex);

    expect(dockIndex).toBeGreaterThanOrEqual(0);
    expect(floatIndex).toBeGreaterThan(dockIndex);
    expect(scrollButtonIndex).toBeGreaterThan(floatIndex);
    expect(dockTrackIndex).toBeGreaterThan(scrollButtonIndex);
    expect(statusLaneIndex).toBeGreaterThan(dockTrackIndex);
    expect(composerIndex).toBeGreaterThan(statusLaneIndex);
    expect(src).toContain('function createFlowerScrollTailController');
    expect(src).toContain('const transcriptScroll = createFlowerScrollTailController');
    expect(src).toContain('const subagentDetailScroll = createFlowerScrollTailController');
    expect(src).toContain('const [transcriptLayoutRevision, setTranscriptLayoutRevision] = createSignal(0)');
    expect(src).toContain('const showScrollToLatestButton = createMemo');
    expect(src).toContain('aria-label={copy().chat.scrollToLatest}');
    expect(src).toContain('title={copy().chat.scrollToLatest}');
    expect(src).toContain('onClick={() => scrollTranscriptToBottom({ smooth: true })}');
    expect(src).toContain('TRANSCRIPT_SCROLL_TO_LATEST_MS');
    expect(src).toContain('captureWasNearBottom');
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
    expect(src).toContain("block.type === 'content' && block.block_type !== 'thinking'");
  });
});
