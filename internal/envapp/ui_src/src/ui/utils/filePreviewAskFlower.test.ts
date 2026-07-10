import { describe, expect, it } from 'vitest';
import { buildFilePreviewFlowerTurnLauncherIntent } from './filePreviewAskFlower';

describe('filePreviewAskFlower', () => {
  it('links only the file path even when preview text is selected', () => {
    const result = buildFilePreviewFlowerTurnLauncherIntent({
      item: {
        id: '/workspace/src/main.ts',
        name: 'main.ts',
        path: '/workspace/src/main.ts',
        type: 'file',
      },
      selectionText: 'const secret = "do not inline";',
    });

    expect(result.error).toBeUndefined();
    expect(result.intent).toMatchObject({
      source_surface: 'file_preview',
      suggested_working_dir: '/workspace/src',
      context_items: [
        {
          kind: 'file_path',
          path: '/workspace/src/main.ts',
          is_directory: false,
        },
      ],
      pending_attachments: [],
      notes: [],
      context_action: {
        source: {
          surface: 'file_preview',
        },
        context: [
          {
            kind: 'file_path',
            path: '/workspace/src/main.ts',
            is_directory: false,
          },
        ],
      },
    });
    expect(JSON.stringify(result.intent)).not.toContain('do not inline');
    expect(JSON.stringify(result.intent)).not.toContain('file_selection');
  });
});
