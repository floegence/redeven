import { describe, expect, it } from 'vitest';

import {
  buildWorkbenchFilePreviewTitle,
  createDefaultWorkbenchInstanceState,
  findWorkbenchPreviewWidgetIdByPath,
  sanitizeWorkbenchInstanceState,
} from './workbenchInstanceState';

describe('workbenchInstanceState', () => {
  it('keeps preview items only for preview widgets when sanitizing persisted instance state', () => {
    const state = sanitizeWorkbenchInstanceState(
      {
        version: 2,
        latestWidgetIdByType: {
          'redeven.preview': 'widget-preview-1',
          'redeven.terminal': 'widget-terminal-1',
        },
        terminalPanelsByWidgetId: {},
        previewItemsByWidgetId: {
          'widget-preview-1': {
            id: '/workspace/demo.txt',
            type: 'file',
            name: 'demo.txt',
            path: '/workspace/demo.txt',
            size: 12,
          },
          'widget-terminal-1': {
            id: '/workspace/should-drop.txt',
            type: 'file',
            name: 'should-drop.txt',
            path: '/workspace/should-drop.txt',
            size: 8,
          },
        },
      },
      [
        {
          id: 'widget-preview-1',
          type: 'redeven.preview',
          title: 'Preview · demo.txt',
          x: 0,
          y: 0,
          width: 900,
          height: 620,
          z_index: 3,
          created_at_unix_ms: 100,
        },
        {
          id: 'widget-terminal-1',
          type: 'redeven.terminal',
          title: 'Terminal',
          x: 20,
          y: 20,
          width: 840,
          height: 500,
          z_index: 2,
          created_at_unix_ms: 90,
        },
      ],
    );

    expect(state.version).toBe(2);
    expect(state.previewItemsByWidgetId).toEqual({
      'widget-preview-1': expect.objectContaining({
        path: '/workspace/demo.txt',
        name: 'demo.txt',
      }),
    });
  });

  it('builds preview titles from the current file item', () => {
    expect(buildWorkbenchFilePreviewTitle({
      id: '/workspace/notes.md',
      type: 'file',
      name: 'notes.md',
      path: '/workspace/notes.md',
      size: 42,
    })).toBe('Preview · notes.md');
    expect(buildWorkbenchFilePreviewTitle(null)).toBe('Preview');
  });

  it('finds the existing preview widget for the same file path', () => {
    expect(findWorkbenchPreviewWidgetIdByPath(
      [
        {
          id: 'widget-preview-1',
          type: 'redeven.preview',
          title: 'Preview · demo.txt',
          x: 0,
          y: 0,
          width: 900,
          height: 620,
          z_index: 3,
          created_at_unix_ms: 100,
        },
        {
          id: 'widget-files-1',
          type: 'redeven.files',
          title: 'Files',
          x: 20,
          y: 20,
          width: 720,
          height: 520,
          z_index: 2,
          created_at_unix_ms: 90,
        },
      ],
      {
        'widget-preview-1': {
          id: '/workspace/demo.txt',
          type: 'file',
          name: 'demo.txt',
          path: '/workspace/demo.txt',
          size: 12,
        },
      },
      '/workspace/demo.txt',
    )).toBe('widget-preview-1');
  });

  it('creates version 2 preview-aware default instance state', () => {
    expect(createDefaultWorkbenchInstanceState()).toEqual({
      version: 2,
      latestWidgetIdByType: {},
      terminalPanelsByWidgetId: {},
      previewItemsByWidgetId: {},
    });
  });
});
