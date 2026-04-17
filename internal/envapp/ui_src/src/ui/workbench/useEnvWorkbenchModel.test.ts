import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { useEnvWorkbenchModel } from './useEnvWorkbenchModel';
import type { EnvWorkbenchWidgetDefinition } from './types';

const definitions: readonly EnvWorkbenchWidgetDefinition[] = [
  {
    type: 'redeven.terminal',
    label: 'Terminal',
    icon: () => null,
    body: () => null,
    defaultTitle: 'Terminal',
    defaultSize: { width: 800, height: 480 },
    singleton: true,
  },
  {
    type: 'redeven.files',
    label: 'Files',
    icon: () => null,
    body: () => null,
    defaultTitle: 'Files',
    defaultSize: { width: 720, height: 520 },
    singleton: true,
  },
];

describe('useEnvWorkbenchModel', () => {
  it('reuses singleton widgets instead of creating duplicates', () => {
    createRoot((dispose) => {
      const [state, setState] = createSignal({
        version: 1 as const,
        widgets: [],
        viewport: { x: 120, y: 84, scale: 1 },
        locked: false,
        filters: {
          'redeven.terminal': true,
          'redeven.files': true,
        },
        selectedWidgetId: null as string | null,
      });

      const model = useEnvWorkbenchModel({
        state,
        setState,
        widgetDefinitions: definitions,
      });

      const first = model.widgetActions.ensureWidget('redeven.terminal', { centerViewport: false });
      expect(first).toBeTruthy();
      expect(state().widgets).toHaveLength(1);

      const second = model.widgetActions.ensureWidget('redeven.terminal', { centerViewport: false });
      expect(second?.id).toBe(first?.id);
      expect(state().widgets).toHaveLength(1);
      expect(state().selectedWidgetId).toBe(first?.id);

      dispose();
    });
  });
});
