import { describe, expect, it } from 'vitest';
import { buildFilePathFlowerTurnLauncherIntent } from './filePathAskFlower';

describe('filePathAskFlower', () => {
  it('builds a file-browser Ask Flower intent for a single directory path', () => {
    const result = buildFilePathFlowerTurnLauncherIntent({
      items: [
        {
          path: '/workspace/demo',
          isDirectory: true,
          rootLabel: 'Workspace',
        },
      ],
      fallbackWorkingDirAbs: '/workspace',
    });

    expect(result.error).toBeUndefined();
    expect(result.intent).toMatchObject({
      source_surface: 'file_browser',
      suggested_working_dir: '/workspace/demo',
      context_items: [
        {
          kind: 'file_path',
          path: '/workspace/demo',
          is_directory: true,
          root_label: 'Workspace',
        },
      ],
      pending_attachments: [],
      notes: [],
      context_action: {
        schema_version: 2,
        action_id: 'assistant.ask.flower',
        provider: 'flower',
        target: {
          target_id: 'current',
          locality: 'auto',
        },
        source: {
          surface: 'file_browser',
        },
        context: [
          {
            kind: 'file_path',
            path: '/workspace/demo',
            is_directory: true,
            root_label: 'Workspace',
          },
        ],
        presentation: {
          label: 'Ask Flower',
          priority: 100,
        },
        suggested_working_dir_abs: '/workspace/demo',
      },
    });
  });

  it('derives a common working directory for mixed file and directory paths', () => {
    const result = buildFilePathFlowerTurnLauncherIntent({
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

    expect(result.intent?.suggested_working_dir).toBe('/workspace/demo');
    expect(result.intent?.context_items).toMatchObject([
      {
        kind: 'file_path',
        path: '/workspace/demo/src/index.ts',
        is_directory: false,
      },
      {
        kind: 'file_path',
        path: '/workspace/demo/docs',
        is_directory: true,
      },
    ]);
  });

  it('returns a readable error when all input paths are invalid', () => {
    const result = buildFilePathFlowerTurnLauncherIntent({
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
