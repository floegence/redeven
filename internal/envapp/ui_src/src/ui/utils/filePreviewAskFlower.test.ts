// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { buildFilePreviewFlowerTurnLauncherIntent } from './filePreviewAskFlower';
import { parseAskFlowerContextActionEnvelope } from '../../../../../flower_ui/src/contextActionWire';

describe('filePreviewAskFlower', () => {
  it('freezes the explicit selection with its file identity', () => {
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
        { kind: 'text_snapshot', title: 'main.ts', detail: '/workspace/src/main.ts', content: 'const secret = "do not inline";' },
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
          { kind: 'text_snapshot', title: 'main.ts', detail: '/workspace/src/main.ts', content: 'const secret = "do not inline";' },
        ],
      },
    });
    expect(result.intent?.context_items).toContainEqual({ kind: 'text_snapshot', title: 'main.ts', detail: '/workspace/src/main.ts', content: 'const secret = "do not inline";' });
    expect(JSON.stringify(result.intent)).not.toContain('file_selection');
    expect(parseAskFlowerContextActionEnvelope(result.intent?.context_action)?.context).toEqual(result.intent?.context_items);
  });
});

const item = { id: '/workspace/code.ts', name: 'code.ts', path: '/workspace/code.ts', type: 'file' as const };
it('keeps path-only context without an explicit selection', () => {
  expect(buildFilePreviewFlowerTurnLauncherIntent({ item }).intent?.context_items).toEqual([{ kind: 'file_path', path: item.path, is_directory: false }]);
});
it('preserves multiline indentation and marks unsaved source state', () => {
  const selection = '  first line\n\tsecond line\n';
  const intent = buildFilePreviewFlowerTurnLauncherIntent({ item, selectionText: selection, unsaved: true }).intent!;
  expect(intent.context_items[1]).toMatchObject({ kind: 'text_snapshot', content: selection });
  expect(intent.context_items[2]).toMatchObject({ kind: 'text_snapshot', content: 'path: /workspace/code.ts\nunsaved: true' });
  expect(parseAskFlowerContextActionEnvelope(intent.context_action)?.context).toEqual(intent.context_items);
});
