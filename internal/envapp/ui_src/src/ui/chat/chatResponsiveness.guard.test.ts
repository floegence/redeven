import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function resolvePackageRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), '../../..');
}

function readText(relPath: string): string {
  return fs.readFileSync(path.join(resolvePackageRoot(), relPath), 'utf8');
}

describe('chat responsiveness guardrails', () => {
  it('keeps heavy chat blocks on explicit non-blocking render paths', () => {
    const codeBlock = readText('src/ui/chat/blocks/CodeBlock.tsx');
    const codeDiffBlock = readText('src/ui/chat/blocks/CodeDiffBlock.tsx');
    const mermaidBlock = readText('src/ui/chat/blocks/MermaidBlock.tsx');

    expect(codeBlock).toContain('deferAfterPaint');
    expect(codeBlock).toContain('highlightCodeToHtmlInWorker');

    expect(codeDiffBlock).toContain('deferAfterPaint');
    expect(codeDiffBlock).toContain('useVirtualWindow');
    expect(codeDiffBlock).toContain('renderCodeDiffModel');

    expect(mermaidBlock).toContain('deferAfterPaint');
    expect(mermaidBlock).toContain('requestIdleCallback');
    expect(mermaidBlock).toContain('mermaidSvgCache');
  });

  it('keeps Codex responsiveness on the shell-first and bounded-transcript path', () => {
    const envShell = readText('src/ui/EnvAppShell.tsx');
    const codexPage = readText('src/ui/codex/CodexPage.tsx');
    const codexProvider = readText('src/ui/codex/CodexProvider.tsx');
    const codexTranscript = readText('src/ui/codex/CodexTranscript.tsx');

    expect(envShell).toContain('resolveSidebarVisibilityMotion={({ currentActiveId, nextActiveId, isMobile }) => (');
    expect(envShell).not.toContain('onClick: () => activateActivitySurface(nextSurface)');

    expect(codexPage).toContain('reportSurfaceAfterPaint');
    expect(codexProvider).toContain('surfaceReady');
    expect(codexTranscript).toContain('useVirtualList');
    expect(codexTranscript).toContain('scrollContainer?: HTMLElement | null;');
  });

  it('keeps long-running activity indicators visually quiet', () => {
    const chatCss = readText('src/ui/chat/chat.css');
    const workingIndicator = readText('src/ui/chat/status/WorkingIndicator.tsx');
    const streamingCursor = readText('src/ui/chat/status/StreamingCursor.tsx');
    const activityTimelineBlock = readText('src/ui/chat/activity/ActivityTimelineBlock.tsx');

    expect(chatCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(chatCss).toContain('.chat-activity-running-dot');
    expect(chatCss).not.toContain('@keyframes bounce');
    expect(chatCss).not.toContain('@keyframes thinkingPulse');
    expect(chatCss).not.toContain('chat-tool-inline-snake-loader');
    expect(chatCss).not.toContain('chat-shell-spinner');

    expect(workingIndicator).not.toContain('chat-working-dot');
    expect(streamingCursor).not.toContain('\\u258B');
    expect(activityTimelineBlock).not.toContain('SnakeLoader');
  });
});
