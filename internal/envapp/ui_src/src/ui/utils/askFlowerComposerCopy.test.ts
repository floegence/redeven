import { describe, expect, it } from 'vitest';
import { buildAskFlowerComposerCopy } from './askFlowerComposerCopy';
import { setAskFlowerAttachmentSourcePath } from './askFlowerAttachmentMetadata';

const baseIntent = {
  id: 'intent-1',
  source: 'file_preview' as const,
  mode: 'append' as const,
  contextItems: [],
  pendingAttachments: [],
  notes: [],
};

describe('buildAskFlowerComposerCopy', () => {
  it('builds preview-focused copy for file selections', () => {
    const copy = buildAskFlowerComposerCopy({
      ...baseIntent,
      contextItems: [
        {
          kind: 'file_selection',
          path: '/Users/demo/notes.md',
          selection: 'const answer = 42;',
          selectionChars: 18,
        },
      ],
    });

    expect(copy.placeholder).toBe('Ask about this selection, request a change, or describe what you need');
    expect(copy.question).toBe('What would you like to understand, change, or verify?');
    expect(copy.contextEntries.map((entry) => ({ kind: entry.kind, label: entry.label, detail: entry.detail }))).toEqual([
      { kind: 'selection', label: 'selected content', detail: 'notes.md' },
      { kind: 'file', label: 'notes.md', detail: '/Users/demo/notes.md' },
    ]);
  });

  it('builds files-and-folders copy for mixed file browser context', () => {
    const copy = buildAskFlowerComposerCopy({
      ...baseIntent,
      source: 'file_browser',
      contextItems: [
        {
          kind: 'file_path',
          path: '/workspace/app',
          isDirectory: true,
        },
        {
          kind: 'file_path',
          path: '/workspace/app/main.go',
          isDirectory: false,
        },
      ],
    });

    expect(copy.placeholder).toBe('Ask about these files and folders, compare them, or describe what you need');
    expect(copy.question).toBe('What would you like to explore, compare, or change?');
    expect(copy.contextEntries.map((entry) => ({ kind: entry.kind, label: entry.label }))).toEqual([
      { kind: 'directory', label: 'app' },
      { kind: 'file', label: 'main.go' },
    ]);
  });

  it('merges a file-browser attachment into the matching file context entry', () => {
    const attachment = setAskFlowerAttachmentSourcePath(
      new File(['export default {};'], 'eslint.config.mjs', { type: 'text/plain' }),
      '/workspace/desktop/eslint.config.mjs',
    );

    const copy = buildAskFlowerComposerCopy({
      ...baseIntent,
      source: 'file_browser',
      contextItems: [
        {
          kind: 'file_path',
          path: '/workspace/desktop/eslint.config.mjs',
          isDirectory: false,
        },
      ],
      pendingAttachments: [attachment],
    });

    expect(copy.contextEntries).toHaveLength(1);
    expect(copy.contextEntries[0]).toMatchObject({
      kind: 'file',
      label: 'eslint.config.mjs',
      detail: '/workspace/desktop/eslint.config.mjs',
    });
    expect(copy.contextEntries[0].kind === 'file' && copy.contextEntries[0].attachmentFile).toBe(attachment);
  });

  it('builds monitoring-focused copy for process snapshots', () => {
    const copy = buildAskFlowerComposerCopy({
      ...baseIntent,
      source: 'monitoring',
      contextItems: [
        {
          kind: 'process_snapshot',
          pid: 4242,
          name: 'node',
          username: 'alice',
          cpuPercent: 87.3,
          memoryBytes: 268_435_456,
          platform: 'darwin',
          capturedAtMs: 1_710_000_000_000,
        },
      ],
    });

    expect(copy.placeholder).toBe('Ask why this process is busy, whether it is expected, or what to do next');
    expect(copy.question).toBe('What would you like me to inspect or explain?');
    expect(copy.contextEntries).toHaveLength(1);
    expect(copy.contextEntries[0]).toMatchObject({
      kind: 'process_snapshot',
      label: 'node (PID 4242)',
      detail: 'alice · 87.3% CPU · 256 MB',
    });
  });

  it('builds Git-focused copy for snapshot context', () => {
    const copy = buildAskFlowerComposerCopy({
      ...baseIntent,
      source: 'git_browser',
      contextItems: [
        {
          kind: 'text_snapshot',
          title: 'Commit summary',
          detail: '3a47b67b',
          content: 'Context: Git commit detail\nCommit: 3a47b67b',
        },
      ],
    });

    expect(copy.placeholder).toBe('Ask about this Git context, request a change, or describe what you need');
    expect(copy.question).toBe('What should Flower inspect or help with?');
    expect(copy.contextEntries).toEqual([
      {
        id: 'context-0-snapshot',
        kind: 'snapshot',
        itemIndex: 0,
        label: 'Commit summary',
        title: 'Preview Commit summary',
        detail: '3a47b67b',
        content: 'Context: Git commit detail\nCommit: 3a47b67b',
      },
    ]);
  });
});
