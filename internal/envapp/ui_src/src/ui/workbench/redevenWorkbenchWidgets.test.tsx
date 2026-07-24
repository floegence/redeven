// @vitest-environment jsdom

import { createRoot, createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkbenchFilterState,
  useWorkbenchModel,
  type WorkbenchState,
  WorkbenchWidgetBodyProps as RedevenWorkbenchWidgetBodyProps,
  type WorkbenchWidgetDefinition,
  type WorkbenchWidgetItem,
} from '@floegence/floe-webapp-core/workbench';
import {
  type InfiniteCanvasContextMenuEvent,
  WORKBENCH_WIDGET_ACTIVATION_SURFACE_ATTR,
} from '@floegence/floe-webapp-core/ui';

import { CodexWorkbenchIcon } from '../icons/CodexIcon';
import { FlowerWorkbenchIcon } from '../icons/FlowerSoftAuraIcon';
import { RedevenWorkbenchSurface } from './surface/RedevenWorkbenchSurface';

const workbenchMocks = vi.hoisted(() => ({
  terminalPanelState: vi.fn(() => ({
    sessionIds: ['session-1', 'session-2'],
    activeSessionId: 'session-2',
  })),
  terminalGeometryPreferences: vi.fn(() => ({
    fontSize: 14,
    fontFamilyId: 'jetbrains',
  })),
  terminalOpenRequest: vi.fn(() => null),
  consumeTerminalOpenRequest: vi.fn(),
  updateTerminalGeometryPreferences: vi.fn(),
  updateTerminalPanelState: vi.fn(),
  createTerminalSession: vi.fn(),
  deleteTerminalSession: vi.fn(),
  updateWidgetTitle: vi.fn(),
  pluginSurfaceState: vi.fn(() => ({
    kind: 'plugin' as const,
    plugin_instance_id: 'instance-containers',
    plugin_id: 'io.redeven.containers',
    surface_id: 'containers',
    display_name: 'Containers',
    expected_management_revision: 7,
  })),
  registerPluginSurfaceClose: vi.fn(),
}));

const terminalPanelMocks = vi.hoisted(() => ({
  render: vi.fn(),
}));

const pluginSurfaceMocks = vi.hoisted(() => ({ render: vi.fn(), cleanup: vi.fn() }));

vi.mock('./EnvWorkbenchInstancesContext', () => ({
  useEnvWorkbenchInstancesContext: () => workbenchMocks,
}));

vi.mock('../widgets/TerminalPanel', async () => {
  const { createEffect } = await import('solid-js');

  return {
    TerminalPanel: (props: any) => {
      let inputEl: HTMLTextAreaElement | undefined;
      let lastActivationSeq = 0;
      terminalPanelMocks.render(props);
      createEffect(() => {
        const activationSeq = props.workbenchActivationSeq ?? 0;
        if (activationSeq <= lastActivationSeq) return;
        lastActivationSeq = activationSeq;
        queueMicrotask(() => inputEl?.focus());
      });

      return (
        <div data-testid="live-terminal-panel">
          <div
            data-testid="terminal-surface"
            {...{ [WORKBENCH_WIDGET_ACTIVATION_SURFACE_ATTR]: 'true' }}
          >
            <textarea ref={inputEl} data-testid="terminal-input" />
          </div>
        </div>
      );
    },
  };
});

vi.mock('../plugins/PluginSurfaceFrame', () => ({
  PluginSurfaceBody: (props: any) => {
    pluginSurfaceMocks.render(props);
    onCleanup(pluginSurfaceMocks.cleanup);
    props.registerClose?.(async () => true);
    return <div data-testid="plugin-surface-body" data-revision={props.target.expectedManagementRevision} />;
  },
}));

import { redevenWorkbenchWidgets } from './redevenWorkbenchWidgets';
import { WorkbenchPluginSurfaceContext } from './WorkbenchPluginSurfaceContext';

function terminalBody() {
  const entry = redevenWorkbenchWidgets.find((widget) => widget.type === 'redeven.terminal');
  if (!entry?.body) throw new Error('missing terminal widget body');
  return entry.body as (props: RedevenWorkbenchWidgetBodyProps) => any;
}

function renderTerminalBody(overrides: Partial<RedevenWorkbenchWidgetBodyProps> = {}) {
  const Body = terminalBody();
  const props = {
    widgetId: 'widget-terminal-1',
    title: 'Terminal',
    type: 'redeven.terminal' as any,
    ...overrides,
  } satisfies RedevenWorkbenchWidgetBodyProps;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <Body {...props} />, host);
  return { host, dispose };
}

function dispatchPointerDown(target: EventTarget): void {
  const EventCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const event = new EventCtor('pointerdown', {
    bubbles: true,
    button: 0,
    clientX: 0,
    clientY: 0,
  });
  if (!('pointerId' in event)) {
    Object.defineProperty(event, 'pointerId', {
      configurable: true,
      value: 1,
    });
  }
  if (!('pointerType' in event)) {
    Object.defineProperty(event, 'pointerType', {
      configurable: true,
      value: 'mouse',
    });
  }
  target.dispatchEvent(event);
}

function createContextMenuEvent(worldX = 480, worldY = 320): InfiniteCanvasContextMenuEvent {
  return {
    clientX: 16,
    clientY: 24,
    worldX,
    worldY,
  };
}

function createWorkbenchState(widgets: readonly WorkbenchWidgetItem[]): WorkbenchState {
  return {
    version: 1,
    widgets: [...widgets],
    viewport: { x: 0, y: 0, scale: 1 },
    locked: false,
    filters: createWorkbenchFilterState(redevenWorkbenchWidgets),
    selectedWidgetId: null,
  };
}

async function flushWorkbenchInteraction(): Promise<void> {
  await Promise.resolve();
  if (typeof requestAnimationFrame === 'function') {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  await Promise.resolve();
  await Promise.resolve();
}

describe('redevenWorkbenchWidgets default geometry', () => {
  it('creates workbench widgets at focus-ready sizes', () => {
    const sizes = Object.fromEntries(
      redevenWorkbenchWidgets.map((widget) => [widget.type, widget.defaultSize])
    );

    expect(sizes).toEqual({
      'redeven.files': { width: 1200, height: 800 },
      'redeven.terminal': { width: 1120, height: 780 },
      'redeven.preview': { width: 1080, height: 700 },
      'redeven.plugin': { width: 1120, height: 760 },
      'redeven.monitor': { width: 1040, height: 800 },
      'redeven.codespaces': { width: 1040, height: 660 },
      'redeven.ports': { width: 1000, height: 620 },
      'redeven.ai': { width: 1200, height: 760 },
      'redeven.codex': { width: 1200, height: 760 },
    });
  });
});

describe('redevenWorkbenchWidgets terminal behavior', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('always mounts the live workbench terminal panel', async () => {
    const { host } = renderTerminalBody();
    await flushWorkbenchInteraction();

    expect(host.querySelector('[data-testid="live-terminal-panel"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="terminal-paused-preview"]')).toBeNull();
    expect(terminalPanelMocks.render).toHaveBeenCalledTimes(1);
    expect(terminalPanelMocks.render.mock.calls[0]?.[0]).toMatchObject({
      variant: 'workbench',
      sessionGroupState: {
        sessionIds: ['session-1', 'session-2'],
        activeSessionId: 'session-2',
      },
      terminalGeometryPreferences: {
        fontSize: 14,
        fontFamilyId: 'jetbrains',
      },
    });
    terminalPanelMocks.render.mock.calls[0]?.[0].terminalGeometryPreferences.onFontSizeChange(15);
    expect(workbenchMocks.updateTerminalGeometryPreferences).toHaveBeenCalledWith('widget-terminal-1', expect.any(Function));
  });

  it('forwards the shared workbench activation sequence into the live terminal panel', async () => {
    renderTerminalBody({
      activation: {
        seq: 7,
      },
    });
    await flushWorkbenchInteraction();

    expect(terminalPanelMocks.render).toHaveBeenCalledTimes(1);
    expect(terminalPanelMocks.render.mock.calls[0]?.[0]).toMatchObject({
      workbenchActivationSeq: 7,
    });
  });

  it('forwards the current workbench selection state into the live terminal panel', async () => {
    renderTerminalBody({
      selected: false,
    });
    await flushWorkbenchInteraction();

    expect(terminalPanelMocks.render).toHaveBeenCalledTimes(1);
    expect(terminalPanelMocks.render.mock.calls[0]?.[0]).toMatchObject({
      workbenchSelected: false,
    });
  });

  it('keeps high-frequency workbench surface scale out of the live terminal panel', async () => {
    const surfaceMetrics = vi.fn(() => ({
      ready: true,
      rect: {
        widgetId: 'widget-terminal-1',
        worldX: 0,
        worldY: 0,
        worldWidth: 840,
        worldHeight: 500,
        screenX: 0,
        screenY: 0,
        screenWidth: 1680,
        screenHeight: 1000,
        viewportScale: 2,
      },
    }));

    renderTerminalBody({
      surfaceMetrics,
    });
    await flushWorkbenchInteraction();

    expect(terminalPanelMocks.render).toHaveBeenCalledTimes(1);
    expect(surfaceMetrics).not.toHaveBeenCalled();
    expect(terminalPanelMocks.render.mock.calls[0]?.[0]).not.toHaveProperty('workbenchPresentationScale');
  });

  it('focuses the terminal input on the first click after switching workbench widgets', async () => {
    const terminalEntry = redevenWorkbenchWidgets.find((widget) => widget.type === 'redeven.terminal');
    expect(terminalEntry).toBeTruthy();

    const widgetDefinitions = [
      {
        type: 'redeven.placeholder',
        label: 'Placeholder',
        icon: () => null,
        body: () => <div data-testid="placeholder-widget">Placeholder</div>,
        defaultTitle: 'Placeholder',
        defaultSize: { width: 320, height: 220 },
      },
      terminalEntry!,
    ] satisfies readonly WorkbenchWidgetDefinition[];
    const [state, setState] = createSignal<WorkbenchState>({
      version: 1,
      widgets: [
        {
          id: 'widget-placeholder-1',
          type: 'redeven.placeholder',
          title: 'Placeholder',
          x: 0,
          y: 0,
          width: 320,
          height: 220,
          z_index: 2,
          created_at_unix_ms: 1,
        },
        {
          id: 'widget-terminal-1',
          type: 'redeven.terminal',
          title: 'Terminal',
          x: 360,
          y: 0,
          width: 520,
          height: 320,
          z_index: 1,
          created_at_unix_ms: 2,
        },
      ],
      viewport: { x: 0, y: 0, scale: 1 },
      locked: false,
      filters: createWorkbenchFilterState(widgetDefinitions),
      selectedWidgetId: 'widget-placeholder-1',
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => (
      <RedevenWorkbenchSurface
        state={state}
        setState={(updater) => setState(updater)}
        widgetDefinitions={widgetDefinitions}
        filterBarWidgetTypes={[]}
        enableKeyboard={false}
      />
    ), host);
    await flushWorkbenchInteraction();

    const terminalSurface = host.querySelector('[data-testid="terminal-surface"]') as HTMLElement | null;
    const terminalInput = host.querySelector('[data-testid="terminal-input"]') as HTMLTextAreaElement | null;
    expect(terminalSurface).toBeTruthy();
    expect(terminalInput).toBeTruthy();

    dispatchPointerDown(terminalInput!);
    await flushWorkbenchInteraction();

    expect(state().selectedWidgetId).toBe('widget-terminal-1');
    expect(document.activeElement).toBe(terminalInput);
    expect(terminalPanelMocks.render).toHaveBeenCalledWith(
      expect.objectContaining({
        workbenchActivationSeq: 1,
      })
    );
  });
});

describe('redevenWorkbenchWidgets plugin behavior', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('projects the persisted plugin target into one standard Workbench surface', () => {
    const definition = redevenWorkbenchWidgets.find((widget) => widget.type === 'redeven.plugin');
    if (!definition) throw new Error('missing plugin widget definition');
    const Body = definition.body;
    const requestActivate = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => (
      <WorkbenchPluginSurfaceContext.Provider value={{
        coordinator: {} as any,
        confirmationQueue: {} as any,
        workbenchVisible: () => true,
        resolveTarget: (target) => target,
        onRetirementError: vi.fn(),
      }}>
        <Body widgetId="widget-plugin-1" title="Containers" type={'redeven.plugin' as any} lifecycle="hot" requestActivate={requestActivate} />
      </WorkbenchPluginSurfaceContext.Provider>
    ), host);

    expect(pluginSurfaceMocks.render).toHaveBeenCalledWith(expect.objectContaining({
      target: {
        pluginID: 'io.redeven.containers',
        pluginInstanceID: 'instance-containers',
        surfaceID: 'containers',
        displayName: 'Containers',
        expectedManagementRevision: 7,
        preferredPlacement: 'workbench',
      },
      visible: true,
    }));
    const wrapper = host.querySelector('[data-redeven-plugin-workbench-surface]');
    expect(wrapper?.getAttribute('data-floe-canvas-wheel-interactive')).toBe('true');
    expect(wrapper?.getAttribute('data-redeven-workbench-text-selection-surface')).toBe('true');
    expect(wrapper?.getAttribute('data-redeven-workbench-action-surface')).toBe('true');
    expect(wrapper?.getAttribute(WORKBENCH_WIDGET_ACTIVATION_SURFACE_ATTR)).toBe('true');
    expect(workbenchMocks.registerPluginSurfaceClose).toHaveBeenCalledWith('widget-plugin-1', expect.any(Function));
    pluginSurfaceMocks.render.mock.calls.at(-1)?.[0]?.onInteraction({
      kind: 'activation', sequence: 1, localScroll: false, selectionActive: false,
    });
    expect(requestActivate).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('keeps the iframe mounted for unrelated state replacement and remounts for target revisions', async () => {
    const definition = redevenWorkbenchWidgets.find((widget) => widget.type === 'redeven.plugin');
    if (!definition) throw new Error('missing plugin widget definition');
    const Body = definition.body;
    const [pluginState, setPluginState] = createSignal(workbenchMocks.pluginSurfaceState());
    workbenchMocks.pluginSurfaceState.mockImplementation(() => pluginState());
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => (
      <WorkbenchPluginSurfaceContext.Provider value={{
        coordinator: {} as any,
        confirmationQueue: {} as any,
        workbenchVisible: () => true,
        resolveTarget: (target) => target,
        onRetirementError: vi.fn(),
      }}>
        <Body widgetId="widget-plugin-1" title="Containers" type={'redeven.plugin' as any} lifecycle="hot" />
      </WorkbenchPluginSurfaceContext.Provider>
    ), host);
    const initialSurface = host.querySelector('[data-testid="plugin-surface-body"]');
    expect(initialSurface).not.toBeNull();

    setPluginState((current) => ({ ...current, display_name: 'Containers renamed' }));
    await Promise.resolve();
    expect(host.querySelector('[data-testid="plugin-surface-body"]')).toBe(initialSurface);

    setPluginState((current) => ({ ...current, expected_management_revision: 8 }));
    await Promise.resolve();
    const revisedSurface = host.querySelector('[data-testid="plugin-surface-body"]');
    expect(revisedSurface).not.toBe(initialSurface);
    expect(revisedSurface?.getAttribute('data-revision')).toBe('8');
    expect(pluginSurfaceMocks.render.mock.calls.at(-1)?.[0]?.target.expectedManagementRevision).toBe(8);
    dispose();
  });

  it.each(['stale', 'disabled', 'uninstalled'] as const)(
    'does not mount a restored %s plugin target before inventory reconciliation',
    (state) => {
      const definition = redevenWorkbenchWidgets.find((widget) => widget.type === 'redeven.plugin');
      if (!definition) throw new Error('missing plugin widget definition');
      const Body = definition.body;
      const host = document.createElement('div');
      document.body.appendChild(host);
      const dispose = render(() => (
        <WorkbenchPluginSurfaceContext.Provider value={{
          coordinator: {} as any,
          confirmationQueue: {} as any,
          workbenchVisible: () => true,
          resolveTarget: (target) => state === 'stale'
            ? { ...target, expectedManagementRevision: target.expectedManagementRevision + 1 }
            : null,
          onRetirementError: vi.fn(),
        }}>
          <Body widgetId="widget-plugin-1" title="Containers" type={'redeven.plugin' as any} lifecycle="hot" />
        </WorkbenchPluginSurfaceContext.Provider>
      ), host);

      expect(pluginSurfaceMocks.render).not.toHaveBeenCalled();
      expect(host.querySelector('[data-testid="plugin-surface-body"]')).toBeNull();
      expect(host.textContent).toContain('Containers');
      expect(host.textContent).toContain('Needs attention');
      expect(host.textContent).toContain('Unavailable');
      dispose();
    },
  );
});

describe('redevenWorkbenchWidgets assistant metadata', () => {
  it('uses compact singleton icons for Flower and Codex workbench widgets', () => {
    const flower = redevenWorkbenchWidgets.find((widget) => widget.type === 'redeven.ai');
    const codex = redevenWorkbenchWidgets.find((widget) => widget.type === 'redeven.codex');

    expect(flower).toMatchObject({
      label: 'Flower',
      singleton: true,
      icon: FlowerWorkbenchIcon,
    });
    expect(codex).toMatchObject({
      label: 'Codex',
      singleton: true,
      icon: CodexWorkbenchIcon,
    });
  });

  it('shows Go to for existing singleton assistant widgets in the canvas context menu', () => {
    createRoot((dispose) => {
      const [state, setState] = createSignal<WorkbenchState>(createWorkbenchState([
        {
          id: 'widget-flower-1',
          type: 'redeven.ai',
          title: 'Flower',
          x: 0,
          y: 0,
          width: 980,
          height: 620,
          z_index: 1,
          created_at_unix_ms: 1,
        },
        {
          id: 'widget-codex-1',
          type: 'redeven.codex',
          title: 'Codex',
          x: 1040,
          y: 0,
          width: 980,
          height: 620,
          z_index: 2,
          created_at_unix_ms: 2,
        },
      ]));

      const model = useWorkbenchModel({
        state,
        setState,
        onClose: vi.fn(),
        widgetDefinitions: redevenWorkbenchWidgets,
      });

      model.canvas.openCanvasContextMenu(createContextMenuEvent());

      const labels = model.contextMenu.items()
        .filter((item) => item.kind === 'action')
        .map((item) => item.label);

      expect(labels).toContain('Go to Flower');
      expect(labels).toContain('Go to Codex');
      expect(labels).toContain('Add Terminal');

      dispose();
    });
  });
});
