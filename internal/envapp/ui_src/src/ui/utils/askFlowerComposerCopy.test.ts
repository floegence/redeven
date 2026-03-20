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
});
