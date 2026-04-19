// @vitest-environment jsdom

import { createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchState, WorkbenchWidgetDefinition } from '@floegence/floe-webapp-core/workbench';
import { createWorkbenchFilterState } from '@floegence/floe-webapp-core/workbench';

import { RedevenWorkbenchCanvas } from './RedevenWorkbenchCanvas';

vi.mock('./RedevenInfiniteCanvas', () => ({
  RedevenInfiniteCanvas: (props: any) => (
    <div data-testid="mock-redeven-infinite-canvas">
      {props.children}
    </div>
  ),
}));

const bodyLifecycle = {
  mounts: new Map<string, number>(),
  cleanups: new Map<string, number>(),
};

const widgetDefinitions: readonly WorkbenchWidgetDefinition[] = [
  {
    type: 'redeven.primary',
    label: 'Primary',
    icon: () => null,
    body: (props) => {
      onMount(() => {
        bodyLifecycle.mounts.set(props.widgetId, (bodyLifecycle.mounts.get(props.widgetId) ?? 0) + 1);
      });
      onCleanup(() => {
        bodyLifecycle.cleanups.set(props.widgetId, (bodyLifecycle.cleanups.get(props.widgetId) ?? 0) + 1);
      });
      return <div data-testid={`body-${props.widgetId}`}>Primary</div>;
    },
    defaultTitle: 'Primary',
    defaultSize: { width: 360, height: 240 },
  },
  {
    type: 'redeven.secondary',
    label: 'Secondary',
    icon: () => null,
    body: (props) => <div data-testid={`body-${props.widgetId}`}>Secondary</div>,
    defaultTitle: 'Secondary',
    defaultSize: { width: 360, height: 240 },
  },
];

function dispatchPointerDown(target: EventTarget): void {
  const EventCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const event = new EventCtor('pointerdown', {
    bubbles: true,
    button: 0,
  });
  if (!('pointerId' in event)) {
    Object.defineProperty(event, 'pointerId', { configurable: true, value: 1 });
  }
  target.dispatchEvent(event);
}

function createInitialState(): WorkbenchState {
  return {
    version: 1,
    widgets: [
      {
        id: 'widget-primary',
        type: 'redeven.primary',
        title: 'Primary',
        x: 40,
        y: 24,
        width: 360,
        height: 240,
        z_index: 42,
        created_at_unix_ms: 1,
      },
      {
        id: 'widget-secondary',
        type: 'redeven.secondary',
        title: 'Secondary',
        x: 420,
        y: 64,
        width: 360,
        height: 240,
        z_index: 420,
        created_at_unix_ms: 2,
      },
    ],
    viewport: { x: 0, y: 0, scale: 1 },
    locked: false,
    filters: createWorkbenchFilterState(widgetDefinitions),
    selectedWidgetId: null,
  };
}

function renderCanvasHarness(host: HTMLDivElement) {
  const [state, setState] = createSignal(createInitialState());

  const topZIndex = () => state().widgets.reduce((max, widget) => Math.max(max, widget.z_index), 1);

  const dispose = render(() => (
    <>
      <button
        type="button"
        data-testid="move-primary"
        onClick={() => {
          setState((prev) => ({
            ...prev,
            widgets: prev.widgets.map((widget) => (
              widget.id === 'widget-primary'
                ? { ...widget, x: widget.x + 48, y: widget.y + 12 }
                : widget
            )),
          }));
        }}
      >
        Move primary
      </button>
      <RedevenWorkbenchCanvas
        widgetDefinitions={widgetDefinitions}
        widgets={state().widgets}
        viewport={state().viewport}
        selectedWidgetId={state().selectedWidgetId}
        optimisticFrontWidgetId={null}
        locked={state().locked}
        filters={state().filters}
        setCanvasFrameRef={() => {}}
        onViewportCommit={(viewport) => {
          setState((prev) => ({ ...prev, viewport }));
        }}
        onCanvasContextMenu={vi.fn()}
        onSelectWidget={(widgetId) => {
          setState((prev) => ({ ...prev, selectedWidgetId: widgetId }));
        }}
        onWidgetContextMenu={vi.fn()}
        onStartOptimisticFront={vi.fn()}
        onCommitFront={(widgetId) => {
          const top = topZIndex();
          setState((prev) => ({
            ...prev,
            widgets: prev.widgets.map((widget) => (
              widget.id === widgetId && widget.z_index < top
                ? { ...widget, z_index: top + 1 }
                : widget
            )),
          }));
        }}
        onCommitMove={(widgetId, position) => {
          setState((prev) => ({
            ...prev,
            widgets: prev.widgets.map((widget) => (
              widget.id === widgetId
                ? { ...widget, x: position.x, y: position.y }
                : widget
            )),
          }));
        }}
        onCommitResize={(widgetId, size) => {
          setState((prev) => ({
            ...prev,
            widgets: prev.widgets.map((widget) => (
              widget.id === widgetId
                ? { ...widget, width: size.width, height: size.height }
                : widget
            )),
          }));
        }}
        onRequestDelete={(widgetId) => {
          setState((prev) => ({
            ...prev,
            widgets: prev.widgets.filter((widget) => widget.id !== widgetId),
          }));
        }}
      />
    </>
  ), host);

  return { dispose };
}

describe('RedevenWorkbenchCanvas widget instance identity', () => {
  afterEach(() => {
    bodyLifecycle.mounts.clear();
    bodyLifecycle.cleanups.clear();
    document.body.innerHTML = '';
  });

  it('keeps the same widget body mounted when click-to-front updates z-index', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { dispose } = renderCanvasHarness(host);
    await Promise.resolve();

    expect(bodyLifecycle.mounts.get('widget-primary')).toBe(1);

    const widget = host.querySelector('[data-floe-workbench-widget-id="widget-primary"]') as HTMLElement | null;
    expect(widget).toBeTruthy();
    dispatchPointerDown(widget!);
    await Promise.resolve();

    expect(bodyLifecycle.mounts.get('widget-primary')).toBe(1);
    expect(bodyLifecycle.cleanups.get('widget-primary') ?? 0).toBe(0);

    dispose();
  });

  it('keeps the same widget body mounted when geometry updates replace the widget snapshot object', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { dispose } = renderCanvasHarness(host);
    await Promise.resolve();

    expect(bodyLifecycle.mounts.get('widget-primary')).toBe(1);

    const moveButton = host.querySelector('[data-testid="move-primary"]') as HTMLButtonElement | null;
    expect(moveButton).toBeTruthy();
    moveButton!.click();
    await Promise.resolve();

    expect(bodyLifecycle.mounts.get('widget-primary')).toBe(1);
    expect(bodyLifecycle.cleanups.get('widget-primary') ?? 0).toBe(0);

    dispose();
  });

  it('renders normalized widget layers instead of leaking persisted z-index values', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { dispose } = renderCanvasHarness(host);
    await Promise.resolve();

    const primaryWidget = host.querySelector('[data-floe-workbench-widget-id="widget-primary"]') as HTMLElement | null;
    const secondaryWidget = host.querySelector('[data-floe-workbench-widget-id="widget-secondary"]') as HTMLElement | null;
    expect(primaryWidget?.style.zIndex).toBe('1');
    expect(secondaryWidget?.style.zIndex).toBe('2');

    dispose();
  });
});
