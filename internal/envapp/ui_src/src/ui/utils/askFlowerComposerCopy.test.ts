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
    expect(copy.contextEntries).toHaveLength(1);
    expect(copy.contextEntries[0]).toMatchObject({
      tone: 'selection',
      label: 'selected content',
      detail: 'notes.md',
      primaryAction: {
        type: 'open_text_context_preview',
        title: 'Selected content',
        subtitle: 'notes.md',
        body: 'const answer = 42;',
        sourcePath: '/Users/demo/notes.md',
      },
      secondaryActions: [
        {
          type: 'open_live_file_preview',
          path: '/Users/demo/notes.md',
        },
      ],
    });
  });

  it('builds live file and directory actions for mixed file browser context', () => {
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
    expect(copy.contextEntries.map((entry) => ({
      tone: entry.tone,
      label: entry.label,
      primaryAction: entry.primaryAction,
    }))).toEqual([
      {
        tone: 'directory',
        label: 'app',
        primaryAction: { type: 'open_directory_browser', path: '/workspace/app' },
      },
      {
        tone: 'file',
        label: 'main.go',
        primaryAction: { type: 'open_live_file_preview', path: '/workspace/app/main.go' },
      },
    ]);
  });

  it('builds a plain file path as a live file preview action', () => {
    const copy = buildAskFlowerComposerCopy({
      ...baseIntent,
      source: 'file_preview',
      contextItems: [
        {
          kind: 'file_path',
          path: '/workspace/desktop/eslint.config.mjs',
          isDirectory: false,
        },
      ],
    });

    expect(copy.contextEntries).toHaveLength(1);
    expect(copy.contextEntries[0]).toMatchObject({
      tone: 'file',
      label: 'eslint.config.mjs',
      detail: '/workspace/desktop/eslint.config.mjs',
      primaryAction: {
        type: 'open_live_file_preview',
        path: '/workspace/desktop/eslint.config.mjs',
      },
      secondaryActions: [],
    });
    expect(copy.contextEntries[0]).not.toHaveProperty('attachmentFile');
  });

  it('merges a file-browser attachment into the matching live file chip as a snapshot action', () => {
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
      tone: 'file',
      label: 'eslint.config.mjs',
      detail: '/workspace/desktop/eslint.config.mjs',
      primaryAction: {
        type: 'open_live_file_preview',
        path: '/workspace/desktop/eslint.config.mjs',
      },
    });
    expect(copy.contextEntries[0].secondaryActions).toEqual([
      {
        type: 'open_attachment_snapshot_preview',
        title: 'eslint.config.mjs snapshot',
        subtitle: '/workspace/desktop/eslint.config.mjs',
        file: attachment,
        livePath: '/workspace/desktop/eslint.config.mjs',
      },
    ]);
    expect(copy.contextEntries[0]).not.toHaveProperty('attachmentFile');
  });

  it('keeps unmatched pending attachments as standalone snapshot chips', () => {
    const attachment = new File(['detached'], 'detached.txt', { type: 'text/plain' });

    const copy = buildAskFlowerComposerCopy({
      ...baseIntent,
      source: 'file_browser',
      pendingAttachments: [attachment],
    });

    expect(copy.placeholder).toBe('Ask about the attached context or describe what you need');
    expect(copy.contextEntries).toEqual([
      {
        id: 'attachment-0',
        tone: 'attachment',
        itemIndex: null,
        label: 'detached.txt',
        title: 'Preview attachment detached.txt',
        detail: 'Queued attachment',
        primaryAction: {
          type: 'open_attachment_snapshot_preview',
          title: 'detached.txt',
          subtitle: 'Queued attachment',
          file: attachment,
        },
        secondaryActions: [],
      },
    ]);
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
      tone: 'process',
      label: 'node (PID 4242)',
      detail: 'alice · 87.3% CPU · 256 MB',
      primaryAction: {
        type: 'open_process_snapshot_preview',
        title: 'Process snapshot',
        subtitle: 'alice · 87.3% CPU · 256 MB',
        pid: 4242,
      },
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
        tone: 'snapshot',
        itemIndex: 0,
        label: 'Commit summary',
        title: 'Preview Commit summary',
        detail: '3a47b67b',
        primaryAction: {
          type: 'open_text_context_preview',
          title: 'Commit summary',
          subtitle: '3a47b67b',
          body: 'Context: Git commit detail\nCommit: 3a47b67b',
        },
        secondaryActions: [],
      },
    ]);
  });
});
