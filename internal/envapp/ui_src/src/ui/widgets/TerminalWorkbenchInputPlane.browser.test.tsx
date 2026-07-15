import { createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import {
  createWorkbenchFilterState,
  type WorkbenchState,
  type WorkbenchWidgetBodyProps,
  type WorkbenchWidgetDefinition,
  type WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';
import { TerminalCore } from '@floegence/floeterm-terminal-web';

import '../../index.css';
import {
  RedevenWorkbenchSurface,
  type RedevenWorkbenchSurfaceApi,
} from '../workbench/surface/RedevenWorkbenchSurface';

const TERMINAL_WIDGET_TYPE = 'test.terminal-input-plane' as WorkbenchWidgetType;

const settleFrames = async (count = 3): Promise<void> => {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
};

const settleWorkbenchTransition = async (): Promise<void> => {
  await settleFrames();
  await new Promise<void>((resolve) => window.setTimeout(resolve, 320));
  await settleFrames();
};

const writeTerminal = (core: TerminalCore, data: string): Promise<void> => (
  new Promise<void>((resolve) => core.write(data, resolve))
);

describe('Workbench terminal input plane', () => {
  let disposeSurface: (() => void) | null = null;

  afterEach(() => {
    disposeSurface?.();
    disposeSurface = null;
    document.body.replaceChildren();
    delete document.documentElement.dataset.theme;
  });

  it('keeps the lower terminal canvas stable after fit, minimum scale, and focus', async () => {
    let core: TerminalCore | null = null;
    let resolveCoreReady: ((value: TerminalCore) => void) | null = null;
    const coreReady = new Promise<TerminalCore>((resolve) => {
      resolveCoreReady = resolve;
    });

    const TerminalBody = (_props: WorkbenchWidgetBodyProps) => {
      let terminalHost: HTMLDivElement | undefined;

      onMount(() => {
        if (!terminalHost) throw new Error('Terminal host was not mounted');
        const nextCore = new TerminalCore(terminalHost, {
          cols: 103,
          rows: 47,
          fontSize: 12,
          rendererType: 'canvas',
          fit: { scrollbarReservePx: 0 },
        });
        core = nextCore;
        void nextCore.initialize().then(async () => {
          await writeTerminal(nextCore, [
            '\x1b[2J\x1b[H',
            'top - 12:00:00 up 1 day, load average: 0.10, 0.08, 0.05\r\n',
            'Tasks: 120 total, 1 running, 119 sleeping\r\n',
            '%Cpu(s): 2.0 us, 1.0 sy, 97.0 id\r\n',
            'MiB Mem : 16384 total, 8192 free, 4096 used, 4096 buff/cache',
          ].join(''));
          resolveCoreReady?.(nextCore);
        });
      });

      onCleanup(() => {
        core?.dispose();
        core = null;
      });

      return (
        <div data-testid="terminal-pane" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
          <div ref={terminalHost} style={{ width: '100%', height: '100%' }} />
        </div>
      );
    };

    const widgetDefinitions: readonly WorkbenchWidgetDefinition[] = [
      {
        type: TERMINAL_WIDGET_TYPE,
        label: 'Terminal',
        icon: () => <span />,
        body: TerminalBody,
        defaultTitle: 'Terminal',
        defaultSize: { width: 824, height: 667 },
        group: 'runtime',
        singleton: true,
      },
    ];
    const widget = {
      id: 'widget-terminal-input-plane',
      type: TERMINAL_WIDGET_TYPE,
      title: 'Terminal',
      x: 220,
      y: 260,
      width: 824,
      height: 667,
      z_index: 1,
      created_at_unix_ms: 1,
    };
    const [state, setState] = createSignal<WorkbenchState>({
      version: 1,
      widgets: [widget],
      viewport: { x: 0, y: 0, scale: 1 },
      locked: false,
      filters: createWorkbenchFilterState(widgetDefinitions),
      selectedWidgetId: widget.id,
      theme: 'default',
    });
    let resolveSurfaceReady: ((api: RedevenWorkbenchSurfaceApi) => void) | null = null;
    const surfaceReady = new Promise<RedevenWorkbenchSurfaceApi>((resolve) => {
      resolveSurfaceReady = resolve;
    });

    document.documentElement.dataset.theme = 'dark';
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.width = '1180px';
    host.style.height = '900px';
    document.body.appendChild(host);

    disposeSurface = render(() => (
      <RedevenWorkbenchSurface
        state={state}
        setState={(updater) => setState(updater)}
        widgetDefinitions={widgetDefinitions}
        filterBarWidgetTypes={[]}
        enableKeyboard={false}
        onApiReady={(api) => {
          if (api) resolveSurfaceReady?.(api);
        }}
      />
    ), host);

    const activeCore = await coreReady;
    const activeSurfaceApi = await surfaceReady;
    await settleWorkbenchTransition();

    activeSurfaceApi.fitWidget(state().widgets[0]!);
    await settleWorkbenchTransition();
    activeSurfaceApi.runViewportTransition(() => {
      setState((previous) => ({
        ...previous,
        viewport: {
          ...previous.viewport,
          scale: 0.45,
        },
      }));
    }, { interactionKind: 'widget_minimize' });
    await settleWorkbenchTransition();
    expect(state().viewport.scale).toBe(0.45);
    expect(state().selectedWidgetId).toBe(widget.id);

    const dimensions = activeCore.getDimensions();
    const cursorX = Math.min(90, dimensions.cols - 1);
    const cursorY = Math.min(40, dimensions.rows - 1);
    await writeTerminal(activeCore, `\x1b[${cursorY + 1};${cursorX + 1}H`);
    activeCore.focus();
    await settleFrames();

    const terminalPane = host.querySelector('[data-testid="terminal-pane"]');
    const canvas = terminalPane?.querySelector('canvas');
    const textarea = document.querySelector('textarea[aria-label="Terminal input"]');
    expect(terminalPane).toBeInstanceOf(HTMLElement);
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    if (
      !(terminalPane instanceof HTMLElement)
      || !(canvas instanceof HTMLCanvasElement)
      || !(textarea instanceof HTMLTextAreaElement)
    ) return;

    const renderHost = canvas.parentElement;
    expect(renderHost).toBeInstanceOf(HTMLElement);
    if (!(renderHost instanceof HTMLElement)) return;

    const canvasRect = canvas.getBoundingClientRect();
    const inputRect = textarea.getBoundingClientRect();
    const expectedLeft = canvasRect.left + cursorX * (canvasRect.width / dimensions.cols);
    const expectedTop = canvasRect.top + cursorY * (canvasRect.height / dimensions.rows);

    expect(textarea.parentElement).toBe(document.body);
    expect(Math.abs(inputRect.left - expectedLeft)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(inputRect.top - expectedTop)).toBeLessThanOrEqual(0.5);
    expect(renderHost.scrollWidth).toBe(renderHost.clientWidth);
    expect(renderHost.scrollHeight).toBe(renderHost.clientHeight);

    renderHost.scrollTo(0, 0);
    const paneRectBefore = terminalPane.getBoundingClientRect();
    const canvasRectBefore = canvas.getBoundingClientRect();
    const offsetBefore = {
      left: canvasRectBefore.left - paneRectBefore.left,
      top: canvasRectBefore.top - paneRectBefore.top,
    };
    const canvasSizeBefore = {
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      width: canvas.width,
      height: canvas.height,
    };

    await page.elementLocator(canvas).click();
    await settleFrames();

    const paneRectAfter = terminalPane.getBoundingClientRect();
    const canvasRectAfter = canvas.getBoundingClientRect();
    expect(document.activeElement).toBe(textarea);
    expect(renderHost.scrollLeft).toBe(0);
    expect(renderHost.scrollTop).toBe(0);
    expect(canvasRectAfter.left - paneRectAfter.left).toBeCloseTo(offsetBefore.left, 3);
    expect(canvasRectAfter.top - paneRectAfter.top).toBeCloseTo(offsetBefore.top, 3);
    expect(canvasRectAfter.left - paneRectAfter.left).toBeGreaterThanOrEqual(0);
    expect(canvasRectAfter.top - paneRectAfter.top).toBeGreaterThanOrEqual(0);
    expect({
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      width: canvas.width,
      height: canvas.height,
    }).toEqual(canvasSizeBefore);
  });
});
