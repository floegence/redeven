// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkbenchFilterState,
  type WorkbenchState,
  WorkbenchWidgetBodyProps as RedevenWorkbenchWidgetBodyProps,
  type WorkbenchWidgetDefinition,
} from '@floegence/floe-webapp-core/workbench';

import { RedevenWorkbenchSurface } from './surface/RedevenWorkbenchSurface';

const workbenchMocks = vi.hoisted(() => ({
  terminalPanelState: vi.fn(() => ({
    sessionIds: ['session-1', 'session-2'],
    activeSessionId: 'session-2',
  })),
  terminalOpenRequest: vi.fn(() => null),
  consumeTerminalOpenRequest: vi.fn(),
  updateTerminalPanelState: vi.fn(),
  createTerminalSession: vi.fn(),
  deleteTerminalSession: vi.fn(),
  updateWidgetTitle: vi.fn(),
}));

const terminalPanelMocks = vi.hoisted(() => ({
  render: vi.fn(),
}));

vi.mock('./EnvWorkbenchInstancesContext', () => ({
  useEnvWorkbenchInstancesContext: () => workbenchMocks,
}));

vi.mock('../widgets/TerminalPanel', async () => {
  const { createEffect } = await import('solid-js');

  return {
    TerminalPanel: (props: any) => {
      let inputEl: HTMLInputElement | undefined;
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
          <div data-testid="terminal-surface">Terminal surface</div>
          <input ref={inputEl} data-testid="terminal-input" />
        </div>
      );
    },
  };
});

import { redevenWorkbenchWidgets } from './redevenWorkbenchWidgets';

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

async function flushWorkbenchInteraction(): Promise<void> {
  await Promise.resolve();
  if (typeof requestAnimationFrame === 'function') {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  await Promise.resolve();
  await Promise.resolve();
}

describe('redevenWorkbenchWidgets terminal behavior', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('always mounts the live workbench terminal panel', () => {
    const { host } = renderTerminalBody();

    expect(host.querySelector('[data-testid="live-terminal-panel"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="terminal-paused-preview"]')).toBeNull();
    expect(terminalPanelMocks.render).toHaveBeenCalledTimes(1);
    expect(terminalPanelMocks.render.mock.calls[0]?.[0]).toMatchObject({
      variant: 'workbench',
      sessionGroupState: {
        sessionIds: ['session-1', 'session-2'],
        activeSessionId: 'session-2',
      },
    });
  });

  it('forwards the shared workbench activation sequence into the live terminal panel', () => {
    renderTerminalBody({
      activation: {
        seq: 7,
      },
    });

    expect(terminalPanelMocks.render).toHaveBeenCalledTimes(1);
    expect(terminalPanelMocks.render.mock.calls[0]?.[0]).toMatchObject({
      workbenchActivationSeq: 7,
    });
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

    const terminalSurface = host.querySelector('[data-testid="terminal-surface"]') as HTMLElement | null;
    const terminalInput = host.querySelector('[data-testid="terminal-input"]') as HTMLInputElement | null;
    expect(terminalSurface).toBeTruthy();
    expect(terminalInput).toBeTruthy();

    dispatchPointerDown(terminalSurface!);
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
