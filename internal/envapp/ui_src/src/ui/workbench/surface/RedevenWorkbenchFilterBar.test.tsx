// @vitest-environment jsdom

import { splitProps, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  WorkbenchWidgetDefinition,
  WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';

import { RedevenWorkbenchFilterBar } from './RedevenWorkbenchFilterBar';

type MotionSpanProps = JSX.IntrinsicElements['span'] & {
  animate?: unknown;
  transition?: unknown;
};

vi.mock('solid-motionone', () => ({
  Motion: {
    span: (props: MotionSpanProps) => {
      const [, domProps] = splitProps(props, ['animate', 'transition']);
      return <span {...domProps} />;
    },
  },
}));

const widgetDefinitions: readonly WorkbenchWidgetDefinition[] = [
  {
    type: 'redeven.files',
    label: 'Files',
    icon: () => <svg aria-hidden="true" />,
    body: () => null,
    defaultTitle: 'Files',
    defaultSize: { width: 320, height: 220 },
  },
];

const widgetFilters = {
  terminal: true,
  'file-browser': true,
  'system-monitor': true,
  'log-viewer': true,
  'code-editor': true,
  'redeven.files': true,
} satisfies Record<WorkbenchWidgetType, boolean>;

function dispatchPointerEvent(
  type: string,
  target: EventTarget,
  options: {
    pointerId?: number;
    clientX?: number;
    clientY?: number;
    buttons?: number;
  } = {},
): void {
  const EventCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const event = new EventCtor(type, {
    bubbles: true,
    button: 0,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
  });
  if (!('pointerId' in event)) {
    Object.defineProperty(event, 'pointerId', {
      configurable: true,
      value: options.pointerId ?? 1,
    });
  }
  Object.defineProperty(event, 'buttons', {
    configurable: true,
    value: options.buttons ?? 1,
  });
  target.dispatchEvent(event);
}

function mockCanvasFrame(): void {
  const frame = document.createElement('div');
  frame.setAttribute('data-floe-workbench-canvas-frame', 'true');
  Object.defineProperty(frame, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    }),
  });
  document.body.appendChild(frame);
}

describe('RedevenWorkbenchFilterBar', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.innerHTML = '';
  });

  it('commits a widget creation once when the release is only observable through a later buttons=0 move', async () => {
    mockCanvasFrame();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onCreateAt = vi.fn();
    const onSoloFilter = vi.fn();

    dispose = render(
      () => (
        <RedevenWorkbenchFilterBar
          widgetDefinitions={widgetDefinitions}
          widgets={[]}
          filters={widgetFilters}
          onSoloFilter={onSoloFilter}
          onShowAll={() => {}}
          onCreateAt={onCreateAt}
        />
      ),
      host,
    );

    const filesButton = host.querySelector(
      'button[aria-label="Files — click to solo, drag to canvas to create"]',
    ) as HTMLButtonElement | null;
    expect(filesButton).toBeTruthy();

    dispatchPointerEvent('pointerdown', filesButton!, {
      pointerId: 13,
      clientX: 20,
      clientY: 20,
      buttons: 1,
    });
    dispatchPointerEvent('pointermove', document, {
      pointerId: 13,
      clientX: 120,
      clientY: 120,
      buttons: 1,
    });
    dispatchPointerEvent('pointermove', document, {
      pointerId: 13,
      clientX: 320,
      clientY: 320,
      buttons: 0,
    });
    dispatchPointerEvent('pointermove', document, {
      pointerId: 13,
      clientX: 420,
      clientY: 420,
      buttons: 0,
    });
    await Promise.resolve();

    expect(onCreateAt).toHaveBeenCalledTimes(1);
    expect(onCreateAt).toHaveBeenCalledWith('redeven.files', 120, 120);
    expect(onSoloFilter).not.toHaveBeenCalled();
  });
});
