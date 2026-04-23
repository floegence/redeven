// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  buildWorkbenchLocalStateStorageKey,
  derivePersistedWorkbenchLocalState,
  extractRuntimeWorkbenchLayoutFromWorkbenchState,
  normalizeRuntimeWorkbenchLayoutSnapshot,
  projectWorkbenchStateFromRuntimeLayout,
  runtimeWorkbenchLayoutWidgetsEqual,
  runtimeWorkbenchWidgetStateById,
  runtimeWorkbenchWidgetStateDataEqual,
  runtimeWorkbenchWidgetStatesEqual,
  sanitizePersistedWorkbenchLocalState,
  type RuntimeWorkbenchLayoutSnapshot,
} from './runtimeWorkbenchLayout';

const widgetDefinitions = [
  {
    type: 'redeven.files',
    label: 'Files',
    icon: () => null,
    body: () => null,
    defaultTitle: 'Files',
    defaultSize: { width: 720, height: 520 },
    singleton: false,
  },
  {
    type: 'redeven.terminal',
    label: 'Terminal',
    icon: () => null,
    body: () => null,
    defaultTitle: 'Terminal',
    defaultSize: { width: 840, height: 500 },
    singleton: false,
  },
] as const;

describe('runtimeWorkbenchLayout', () => {
  it('builds a dedicated local state storage key', () => {
    expect(buildWorkbenchLocalStateStorageKey('workbench:env-1')).toBe('workbench:env-1:local_state');
  });

  it('projects runtime layout while preserving local viewport, selection, and titles', () => {
    const existingState = {
      version: 1,
      widgets: [
        {
          id: 'widget-files-1',
          type: 'redeven.files',
          title: 'Files · repo',
          x: 20,
          y: 20,
          width: 720,
          height: 520,
          z_index: 1,
          created_at_unix_ms: 100,
        },
      ],
      viewport: { x: 180, y: 120, scale: 1.25 },
      locked: true,
      filters: {
        'redeven.files': true,
        'redeven.terminal': false,
      },
      selectedWidgetId: 'widget-files-1',
      theme: 'mica',
    };
    const localState = derivePersistedWorkbenchLocalState(existingState as any, true);
    const snapshot: RuntimeWorkbenchLayoutSnapshot = {
      seq: 4,
      revision: 2,
      updated_at_unix_ms: 200,
      widgets: [
        {
          widget_id: 'widget-files-1',
          widget_type: 'redeven.files',
          x: 320,
          y: 180,
          width: 760,
          height: 560,
          z_index: 3,
          created_at_unix_ms: 100,
        },
      ],
      widget_states: [],
    };

    const projected = projectWorkbenchStateFromRuntimeLayout({
      snapshot,
      localState,
      existingState: existingState as any,
      widgetDefinitions: widgetDefinitions as any,
    });

    expect(projected.viewport).toEqual({ x: 180, y: 120, scale: 1.25 });
    expect(projected.selectedWidgetId).toBe('widget-files-1');
    expect(projected.locked).toBe(true);
    expect(projected.theme).toBe('mica');
    expect(projected.widgets[0]).toMatchObject({
      id: 'widget-files-1',
      type: 'redeven.files',
      title: 'Files · repo',
      x: 320,
      y: 180,
      width: 760,
      height: 560,
      z_index: 3,
    });
  });

  it('prefers the live selected widget over a stale persisted selection', () => {
    const existingState = {
      version: 1,
      widgets: [
        {
          id: 'widget-files-1',
          type: 'redeven.files',
          title: 'Files',
          x: 20,
          y: 20,
          width: 720,
          height: 520,
          z_index: 1,
          created_at_unix_ms: 100,
        },
        {
          id: 'widget-terminal-1',
          type: 'redeven.terminal',
          title: 'Terminal',
          x: 80,
          y: 80,
          width: 840,
          height: 500,
          z_index: 2,
          created_at_unix_ms: 101,
        },
      ],
      viewport: { x: 80, y: 60, scale: 1 },
      locked: false,
      filters: {
        'redeven.files': true,
        'redeven.terminal': true,
      },
      selectedWidgetId: 'widget-terminal-1',
      theme: 'default',
    };
    const localState = {
      ...derivePersistedWorkbenchLocalState(existingState as any, true),
      selectedWidgetId: 'widget-files-1',
    };

    const projected = projectWorkbenchStateFromRuntimeLayout({
      snapshot: {
        seq: 5,
        revision: 3,
        updated_at_unix_ms: 300,
        widgets: [
          {
            widget_id: 'widget-files-1',
            widget_type: 'redeven.files',
            x: 20,
            y: 20,
            width: 720,
            height: 520,
            z_index: 1,
            created_at_unix_ms: 100,
          },
          {
            widget_id: 'widget-terminal-1',
            widget_type: 'redeven.terminal',
            x: 80,
            y: 80,
            width: 840,
            height: 500,
            z_index: 2,
            created_at_unix_ms: 101,
          },
        ],
        widget_states: [],
      },
      localState,
      existingState: existingState as any,
      widgetDefinitions: widgetDefinitions as any,
    });

    expect(projected.selectedWidgetId).toBe('widget-terminal-1');
  });

  it('does not restore persisted selection when no live widget is selected', () => {
    const existingState = {
      version: 1,
      widgets: [
        {
          id: 'widget-files-1',
          type: 'redeven.files',
          title: 'Files',
          x: 20,
          y: 20,
          width: 720,
          height: 520,
          z_index: 1,
          created_at_unix_ms: 100,
        },
      ],
      viewport: { x: 80, y: 60, scale: 1 },
      locked: false,
      filters: {
        'redeven.files': true,
        'redeven.terminal': true,
      },
      selectedWidgetId: null,
      theme: 'default',
    };
    const localState = {
      ...derivePersistedWorkbenchLocalState(existingState as any, true),
      selectedWidgetId: 'widget-files-1',
    };

    const projected = projectWorkbenchStateFromRuntimeLayout({
      snapshot: {
        seq: 5,
        revision: 3,
        updated_at_unix_ms: 300,
        widgets: [
          {
            widget_id: 'widget-files-1',
            widget_type: 'redeven.files',
            x: 20,
            y: 20,
            width: 720,
            height: 520,
            z_index: 1,
            created_at_unix_ms: 100,
          },
        ],
        widget_states: [],
      },
      localState,
      existingState: existingState as any,
      widgetDefinitions: widgetDefinitions as any,
    });

    expect(projected.selectedWidgetId).toBeNull();
  });

  it('keeps existing widget order stable when runtime z-index order changes', () => {
    const existingState = {
      version: 1,
      widgets: [
        {
          id: 'widget-files-1',
          type: 'redeven.files',
          title: 'Files · repo',
          x: 20,
          y: 20,
          width: 720,
          height: 520,
          z_index: 1,
          created_at_unix_ms: 100,
        },
        {
          id: 'widget-terminal-1',
          type: 'redeven.terminal',
          title: 'Terminal · api',
          x: 80,
          y: 80,
          width: 840,
          height: 500,
          z_index: 2,
          created_at_unix_ms: 101,
        },
      ],
      viewport: { x: 80, y: 60, scale: 1 },
      locked: false,
      filters: {
        'redeven.files': true,
        'redeven.terminal': true,
      },
      selectedWidgetId: 'widget-files-1',
      theme: 'default',
    };
    const localState = derivePersistedWorkbenchLocalState(existingState as any, true);

    const projected = projectWorkbenchStateFromRuntimeLayout({
      snapshot: {
        seq: 6,
        revision: 4,
        updated_at_unix_ms: 400,
        widgets: [
          {
            widget_id: 'widget-terminal-1',
            widget_type: 'redeven.terminal',
            x: 88,
            y: 96,
            width: 860,
            height: 510,
            z_index: 1,
            created_at_unix_ms: 101,
          },
          {
            widget_id: 'widget-files-1',
            widget_type: 'redeven.files',
            x: 30,
            y: 42,
            width: 740,
            height: 530,
            z_index: 9,
            created_at_unix_ms: 100,
          },
        ],
        widget_states: [],
      },
      localState,
      existingState: existingState as any,
      widgetDefinitions: widgetDefinitions as any,
    });

    expect(projected.widgets.map((widget) => widget.id)).toEqual([
      'widget-files-1',
      'widget-terminal-1',
    ]);
    expect(projected.widgets[0]).toMatchObject({
      id: 'widget-files-1',
      title: 'Files · repo',
      x: 30,
      y: 42,
      width: 740,
      height: 530,
      z_index: 9,
    });
    expect(projected.widgets[1]).toMatchObject({
      id: 'widget-terminal-1',
      title: 'Terminal · api',
      x: 88,
      y: 96,
      width: 860,
      height: 510,
      z_index: 1,
    });
  });

  it('appends new runtime widgets after the stable live widget order', () => {
    const existingState = {
      version: 1,
      widgets: [
        {
          id: 'widget-files-1',
          type: 'redeven.files',
          title: 'Files',
          x: 20,
          y: 20,
          width: 720,
          height: 520,
          z_index: 1,
          created_at_unix_ms: 100,
        },
      ],
      viewport: { x: 80, y: 60, scale: 1 },
      locked: false,
      filters: {
        'redeven.files': true,
        'redeven.terminal': true,
      },
      selectedWidgetId: null,
      theme: 'default',
    };
    const localState = derivePersistedWorkbenchLocalState(existingState as any, true);

    const projected = projectWorkbenchStateFromRuntimeLayout({
      snapshot: {
        seq: 7,
        revision: 5,
        updated_at_unix_ms: 500,
        widgets: [
          {
            widget_id: 'widget-terminal-1',
            widget_type: 'redeven.terminal',
            x: 80,
            y: 80,
            width: 840,
            height: 500,
            z_index: 1,
            created_at_unix_ms: 101,
          },
          {
            widget_id: 'widget-files-1',
            widget_type: 'redeven.files',
            x: 20,
            y: 20,
            width: 720,
            height: 520,
            z_index: 2,
            created_at_unix_ms: 100,
          },
        ],
        widget_states: [],
      },
      localState,
      existingState: existingState as any,
      widgetDefinitions: widgetDefinitions as any,
    });

    expect(projected.widgets.map((widget) => widget.id)).toEqual([
      'widget-files-1',
      'widget-terminal-1',
    ]);
    expect(projected.widgets[1]).toMatchObject({
      id: 'widget-terminal-1',
      type: 'redeven.terminal',
      title: 'Terminal',
    });
  });

  it('drops local-only fields when extracting runtime layout widgets', () => {
    const state = {
      version: 1,
      widgets: [
        {
          id: 'widget-terminal-1',
          type: 'redeven.terminal',
          title: 'Terminal · api',
          x: 410,
          y: 150,
          width: 840,
          height: 500,
          z_index: 2,
          created_at_unix_ms: 111,
        },
      ],
      viewport: { x: 80, y: 60, scale: 1 },
      locked: false,
      filters: {
        'redeven.files': true,
        'redeven.terminal': true,
      },
      selectedWidgetId: 'widget-terminal-1',
      theme: 'midnight',
    };

    expect(extractRuntimeWorkbenchLayoutFromWorkbenchState(state as any)).toEqual({
      widgets: [
        {
          widget_id: 'widget-terminal-1',
          widget_type: 'redeven.terminal',
          x: 410,
          y: 150,
          width: 840,
          height: 500,
          z_index: 2,
          created_at_unix_ms: 111,
        },
      ],
    });
  });

  it('sanitizes local-only state from persisted data and legacy fallback', () => {
    const legacyState = {
      version: 1,
      widgets: [],
      viewport: { x: 80, y: 60, scale: 1 },
      locked: false,
      filters: {
        'redeven.files': true,
        'redeven.terminal': true,
      },
      selectedWidgetId: null,
      theme: 'default',
    };

    const sanitized = sanitizePersistedWorkbenchLocalState({
      viewport: { x: 200, y: 140, scale: 1.3 },
      locked: true,
      filters: {
        'redeven.files': false,
        ignored: true,
      },
      selectedWidgetId: 'widget-files-1',
      legacyLayoutMigrated: true,
    }, legacyState as any, widgetDefinitions as any);

    expect(sanitized).toEqual({
      version: 1,
      viewport: { x: 200, y: 140, scale: 1.3 },
      locked: true,
      filters: {
        'redeven.files': false,
        'redeven.terminal': true,
      },
      selectedWidgetId: 'widget-files-1',
      theme: 'default',
      legacyLayoutMigrated: true,
    });
  });

  it('compares runtime widget arrays deterministically', () => {
    const left = extractRuntimeWorkbenchLayoutFromWorkbenchState({
      widgets: [
        {
          id: 'a',
          type: 'redeven.files',
          title: 'A',
          x: 1,
          y: 2,
          width: 3,
          height: 4,
          z_index: 1,
          created_at_unix_ms: 5,
        },
      ],
    } as any).widgets;
    const right = extractRuntimeWorkbenchLayoutFromWorkbenchState({
      widgets: [
        {
          id: 'a',
          type: 'redeven.files',
          title: 'B',
          x: 1,
          y: 2,
          width: 3,
          height: 4,
          z_index: 1,
          created_at_unix_ms: 5,
        },
      ],
    } as any).widgets;

    expect(runtimeWorkbenchLayoutWidgetsEqual(left, right)).toBe(true);
  });

  it('normalizes shared widget state snapshots', () => {
    const snapshot = normalizeRuntimeWorkbenchLayoutSnapshot({
      seq: 3,
      revision: 1,
      updated_at_unix_ms: 200,
      widgets: [],
      widget_states: [
        {
          widget_id: 'widget-terminal-1',
          widget_type: 'redeven.terminal',
          revision: 2,
          updated_at_unix_ms: 210,
          state: {
            kind: 'terminal',
            session_ids: ['session-1', 'session-1', ' session-2 '],
          },
        },
        {
          widget_id: 'widget-preview-1',
          widget_type: 'redeven.preview',
          revision: 1,
          updated_at_unix_ms: 211,
          state: {
            kind: 'preview',
            item: {
              path: '/workspace/demo.txt',
              name: '',
              type: 'file',
            },
          },
        },
      ],
    });

    const states = runtimeWorkbenchWidgetStateById(snapshot.widget_states);
    expect(states['widget-terminal-1']?.state).toEqual({
      kind: 'terminal',
      session_ids: ['session-1', 'session-2'],
    });
    expect(states['widget-preview-1']?.state).toEqual({
      kind: 'preview',
      item: {
        id: '/workspace/demo.txt',
        type: 'file',
        path: '/workspace/demo.txt',
        name: 'demo.txt',
      },
    });
  });

  it('compares widget states by semantic data', () => {
    const left = normalizeRuntimeWorkbenchLayoutSnapshot({
      widget_states: [
        {
          widget_id: 'widget-files-1',
          widget_type: 'redeven.files',
          revision: 1,
          updated_at_unix_ms: 100,
          state: {
            kind: 'files',
            current_path: '/workspace',
          },
        },
      ],
    }).widget_states;
    const right = normalizeRuntimeWorkbenchLayoutSnapshot({
      widget_states: [
        {
          widget_id: 'widget-files-1',
          widget_type: 'redeven.files',
          revision: 1,
          updated_at_unix_ms: 200,
          state: {
            kind: 'files',
            current_path: '/workspace',
          },
        },
      ],
    }).widget_states;

    expect(runtimeWorkbenchWidgetStatesEqual(left, right)).toBe(true);
    expect(runtimeWorkbenchWidgetStateDataEqual(left[0]!.state, {
      kind: 'files',
      current_path: '/workspace/src',
    })).toBe(false);
  });
});
