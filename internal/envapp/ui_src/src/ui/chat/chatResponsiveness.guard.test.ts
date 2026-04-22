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
  it('documents the local responsiveness contract for heavy chat blocks', () => {
    const contract = readText('docs/chat-responsiveness-contract.md');

    expect(contract).toContain('Large diffs must prefer a worker-backed diff model.');
    expect(contract).toContain('Large code blocks should prefer worker-backed highlighting when available.');
    expect(contract).toContain('Mermaid rendering must be scheduled after paint');
    expect(contract).toContain('Activity switching must update shell ownership synchronously');
    expect(contract).toContain('Codex-specific network/bootstrap work must wait until the activated view has painted once.');
    expect(contract).toContain('Codex transcript DOM must stay bounded to the viewport window');
  });

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
});
