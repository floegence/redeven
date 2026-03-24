import { describe, expect, it } from 'vitest';
import { buildFilePathAskFlowerIntent } from './filePathAskFlower';

describe('filePathAskFlower', () => {
  it('builds a file-browser Ask Flower intent for a single directory path', () => {
    const result = buildFilePathAskFlowerIntent({
      items: [
        {
          path: '/workspace/demo',
          isDirectory: true,
        },
      ],
      fallbackWorkingDirAbs: '/workspace',
    });

    expect(result.error).toBeUndefined();
    expect(result.intent).toMatchObject({
      source: 'file_browser',
      mode: 'append',
      suggestedWorkingDirAbs: '/workspace/demo',
      contextItems: [
        {
          kind: 'file_path',
          path: '/workspace/demo',
          isDirectory: true,
        },
      ],
      pendingAttachments: [],
      notes: [],
    });
  });

  it('derives a common working directory for mixed file and directory paths', () => {
    const result = buildFilePathAskFlowerIntent({
      items: [
        {
          path: '/workspace/demo/src/index.ts',
          isDirectory: false,
        },
        {
          path: '/workspace/demo/docs',
          isDirectory: true,
        },
      ],
      fallbackWorkingDirAbs: '/workspace',
    });

    expect(result.intent?.suggestedWorkingDirAbs).toBe('/workspace/demo');
    expect(result.intent?.contextItems).toMatchObject([
      {
        kind: 'file_path',
        path: '/workspace/demo/src/index.ts',
        isDirectory: false,
      },
      {
        kind: 'file_path',
        path: '/workspace/demo/docs',
        isDirectory: true,
      },
    ]);
  });

  it('returns a readable error when all input paths are invalid', () => {
    const result = buildFilePathAskFlowerIntent({
      items: [
        {
          path: 'workspace/demo',
          isDirectory: true,
        },
      ],
    });

    expect(result.intent).toBeNull();
    expect(result.error).toBe('Failed to resolve selected file paths.');
  });
});
