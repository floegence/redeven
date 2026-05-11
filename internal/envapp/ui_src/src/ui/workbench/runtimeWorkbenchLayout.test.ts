// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  WORKBENCH_DEFAULT_REGION_FILL,
  WORKBENCH_DEFAULT_TEXT_COLOR,
  WORKBENCH_TEXT_FONT_OPTIONS,
} from '@floegence/floe-webapp-core/workbench';

import {
  buildWorkbenchLocalStateStorageKey,
  createWorkbenchOverviewViewport,
  derivePersistedWorkbenchLocalState,
  extractRuntimeWorkbenchLayoutFromWorkbenchState,
  normalizeRuntimeWorkbenchLayoutSnapshot,
  projectWorkbenchStateFromRuntimeLayout,
  REDEVEN_WORKBENCH_TEXT_ANNOTATION_DEFAULT_FONT_SIZE,
  runtimeWorkbenchAnnotationsEqual,
  runtimeWorkbenchBackgroundLayersEqual,
  runtimeWorkbenchSharedLayoutEqual,
  runtimeWorkbenchStickyNotesEqual,
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
const sansTextFont = WORKBENCH_TEXT_FONT_OPTIONS.find((option) => option.id === 'sans') ?? WORKBENCH_TEXT_FONT_OPTIONS[0]!;

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
      sticky_notes: [],
      annotations: [],
      background_layers: [],
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

  it('keeps the live selected widget when projecting a remote scene', () => {
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
    const localState = derivePersistedWorkbenchLocalState(existingState as any, true);

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
        sticky_notes: [],
        annotations: [],
        background_layers: [],
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
    const localState = derivePersistedWorkbenchLocalState(existingState as any, true);

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
        sticky_notes: [],
        annotations: [],
        background_layers: [],
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
        sticky_notes: [],
        annotations: [],
        background_layers: [],
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
        sticky_notes: [],
        annotations: [],
        background_layers: [],
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
      sticky_notes: [],
      annotations: [],
      background_layers: [],
    });
  });

  it('extracts and projects layered canvas objects as shared runtime layout', () => {
    const existingState = {
      version: 1,
      widgets: [],
      viewport: { x: 80, y: 60, scale: 1 },
      locked: false,
      filters: {
        'redeven.files': true,
        'sticky-note': true,
        text: true,
        'background-region': true,
      },
      selectedWidgetId: null,
      selectedObject: { kind: 'annotation', id: 'annotation-1' },
      theme: 'default',
      mode: 'annotation',
      activeTool: 'text',
      stickyNotes: [
        {
          id: 'note-1',
          kind: 'sticky_note',
          body: 'Check deploy notes',
          color: 'sage',
          x: 100,
          y: 120,
          width: 260,
          height: 180,
          z_index: 4,
          created_at_unix_ms: 10,
          updated_at_unix_ms: 11,
        },
      ],
      annotations: [
        {
          id: 'annotation-1',
          kind: 'text',
          text: 'Release gate',
          font_family: sansTextFont.fontFamily,
          font_size: 45,
          font_weight: sansTextFont.fontWeight,
          color: WORKBENCH_DEFAULT_TEXT_COLOR,
          align: 'center',
          x: 420,
          y: 80,
          width: 460,
          height: 120,
          z_index: 5,
          created_at_unix_ms: 12,
          updated_at_unix_ms: 13,
        },
      ],
      backgroundLayers: [
        {
          id: 'background-1',
          name: 'Planning lane',
          fill: WORKBENCH_DEFAULT_REGION_FILL,
          opacity: 0.42,
          material: 'grid',
          x: 60,
          y: 40,
          width: 920,
          height: 640,
          z_index: 1,
          created_at_unix_ms: 8,
          updated_at_unix_ms: 9,
        },
      ],
    };

    const extracted = extractRuntimeWorkbenchLayoutFromWorkbenchState(existingState as any);
    expect(extracted).toMatchObject({
      widgets: [],
      sticky_notes: [{ id: 'note-1', kind: 'sticky_note', body: 'Check deploy notes' }],
      annotations: [{ id: 'annotation-1', kind: 'text', font_size: 45, width: 460 }],
      background_layers: [{ id: 'background-1', material: 'grid', opacity: 0.42 }],
    });

    const localState = derivePersistedWorkbenchLocalState(existingState as any, true);
    const projected = projectWorkbenchStateFromRuntimeLayout({
      snapshot: {
        seq: 8,
        revision: 6,
        updated_at_unix_ms: 600,
        widget_states: [],
        ...extracted,
      },
      localState,
      existingState: existingState as any,
      widgetDefinitions: widgetDefinitions as any,
    });

    expect(projected.mode).toBe('annotation');
    expect(projected.activeTool).toBe('text');
    expect(projected.selectedObject).toEqual({ kind: 'annotation', id: 'annotation-1' });
    expect(projected.stickyNotes).toEqual(extracted.sticky_notes);
    expect(projected.annotations).toEqual(extracted.annotations);
    expect(projected.backgroundLayers).toEqual(extracted.background_layers);
    expect(runtimeWorkbenchStickyNotesEqual(extracted.sticky_notes, projected.stickyNotes ?? [])).toBe(true);
    expect(runtimeWorkbenchAnnotationsEqual(extracted.annotations, projected.annotations ?? [])).toBe(true);
    expect(runtimeWorkbenchBackgroundLayersEqual(extracted.background_layers, projected.backgroundLayers ?? [])).toBe(true);
    expect(runtimeWorkbenchSharedLayoutEqual(extracted, {
      widgets: [],
      sticky_notes: projected.stickyNotes ?? [],
      annotations: projected.annotations ?? [],
      background_layers: projected.backgroundLayers ?? [],
    })).toBe(true);
  });

  it('normalizes text annotations with the Redeven default font size', () => {
    const snapshot = normalizeRuntimeWorkbenchLayoutSnapshot({
      annotations: [
        {
          id: 'annotation-1',
          kind: 'text',
          text: 'Large note',
          x: 20,
          y: 30,
          width: 420,
          height: 160,
        },
      ],
    });

    expect(snapshot.annotations[0]?.font_size).toBe(REDEVEN_WORKBENCH_TEXT_ANNOTATION_DEFAULT_FONT_SIZE);
  });

  it('clears selected layered object when the runtime snapshot no longer contains it', () => {
    const existingState = {
      version: 1,
      widgets: [],
      viewport: { x: 80, y: 60, scale: 1 },
      locked: false,
      filters: {
        'redeven.files': true,
        'redeven.terminal': true,
      },
      selectedWidgetId: null,
      selectedObject: { kind: 'sticky_note', id: 'missing-note' },
      theme: 'default',
      stickyNotes: [
        {
          id: 'missing-note',
          kind: 'sticky_note',
          body: 'Local only',
          color: 'amber',
          x: 0,
          y: 0,
          width: 200,
          height: 160,
          z_index: 1,
          created_at_unix_ms: 1,
          updated_at_unix_ms: 1,
        },
      ],
    };

    const projected = projectWorkbenchStateFromRuntimeLayout({
      snapshot: {
        seq: 9,
        revision: 7,
        updated_at_unix_ms: 700,
        widgets: [],
        widget_states: [],
        sticky_notes: [],
        annotations: [],
        background_layers: [],
      },
      localState: derivePersistedWorkbenchLocalState(existingState as any, true),
      existingState: existingState as any,
      widgetDefinitions: widgetDefinitions as any,
    });

    expect(projected.selectedObject).toBeNull();
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
      version: 3,
      locked: true,
      filters: {
        'redeven.files': false,
        'redeven.terminal': true,
      },
      theme: 'default',
      mode: 'work',
      activeTool: 'select',
      legacyLayoutMigrated: true,
    });
  });

  it('preserves upstream layered filter ids in local state normalization', () => {
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
      filters: {
        'sticky-note': false,
        text: true,
        'background-region': false,
        ignored: false,
      },
      mode: 'background',
      activeTool: 'background-region',
    }, legacyState as any, widgetDefinitions as any);

    expect(sanitized.filters).toMatchObject({
      'redeven.files': true,
      'redeven.terminal': true,
      'sticky-note': false,
      text: true,
      'background-region': false,
    });
    expect(sanitized.filters).not.toHaveProperty('ignored');
    expect(sanitized.mode).toBe('background');
    expect(sanitized.activeTool).toBe('background-region');
  });

  it('drops viewport and selection from the persisted local-state contract', () => {
    const localState = derivePersistedWorkbenchLocalState({
      version: 1,
      widgets: [],
      viewport: { x: 180, y: 120, scale: 1.25 },
      locked: true,
      filters: {
        'redeven.files': false,
        'redeven.terminal': true,
      },
      selectedWidgetId: 'widget-files-1',
      theme: 'mica',
    } as any, true);

    expect(localState).toEqual({
      version: 3,
      locked: true,
      filters: {
        'redeven.files': false,
        'redeven.terminal': true,
      },
      theme: 'mica',
      mode: 'work',
      activeTool: 'select',
      legacyLayoutMigrated: true,
    });
  });

  it('builds an overview viewport around the scene center at minimum scale', () => {
    const viewport = createWorkbenchOverviewViewport({
      widgets: [
        {
          id: 'widget-files-1',
          type: 'redeven.files',
          title: 'Files',
          x: 100,
          y: 80,
          width: 300,
          height: 200,
          z_index: 1,
          created_at_unix_ms: 1,
        },
        {
          id: 'widget-terminal-1',
          type: 'redeven.terminal',
          title: 'Terminal',
          x: 700,
          y: 420,
          width: 400,
          height: 240,
          z_index: 2,
          created_at_unix_ms: 2,
        },
      ] as any,
      frameWidth: 1200,
      frameHeight: 800,
    });

    expect(viewport.scale).toBe(0.45);
    expect(viewport.x).toBe(330);
    expect(viewport.y).toBe(233.5);
  });

  it('centers the empty scene at minimum scale', () => {
    expect(createWorkbenchOverviewViewport({
      widgets: [],
      frameWidth: 1200,
      frameHeight: 800,
    })).toEqual({
      x: 600,
      y: 400,
      scale: 0.45,
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

    expect(runtimeWorkbenchSharedLayoutEqual({
      widgets: left,
      sticky_notes: [],
      annotations: [],
      background_layers: [],
    }, {
      widgets: right,
      sticky_notes: [],
      annotations: [],
      background_layers: [],
    })).toBe(true);
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
            font_size: 99,
            font_family_id: ' jetbrains ',
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
      font_size: 20,
      font_family_id: 'jetbrains',
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
    expect(runtimeWorkbenchWidgetStateDataEqual(
      { kind: 'terminal', session_ids: ['session-1'], font_size: 12, font_family_id: 'monaco' },
      { kind: 'terminal', session_ids: ['session-1'], font_size: 14, font_family_id: 'monaco' },
    )).toBe(false);
  });
});
