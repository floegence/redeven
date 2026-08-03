// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TerminalSharedGeometryNotice } from './TerminalSharedGeometryNotice';
import type { TerminalSharedGeometryPresentation } from './terminalSharedGeometryPresentation';

const floatingLayerState = vi.hoisted(() => ({
  owner: null as HTMLElement | null,
  position: null as { x: number; y: number } | null,
}));

vi.mock('@floegence/floe-webapp-core/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@floegence/floe-webapp-core/ui')>(),
  SurfaceFloatingLayer: (props: any) => {
    floatingLayerState.owner = props.owner;
    floatingLayerState.position = props.position;
    return (
      <div ref={props.layerRef} data-testid="surface-floating-layer" class={props.class}>
        {props.children}
      </div>
    );
  },
}));

vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, number>) => {
      const values: Record<string, string> = {
        'terminal.sharedGeometry.compact': `Shared across views · ${params?.cols}×${params?.rows}`,
        'terminal.sharedGeometry.short': `Shared ${params?.cols}×${params?.rows}`,
        'terminal.sharedGeometry.label': 'Shared',
        'terminal.sharedGeometry.ariaLabel': `Terminal layout shared at ${params?.cols} by ${params?.rows}`,
        'terminal.sharedGeometry.title': 'Shared terminal layout',
        'terminal.sharedGeometry.description': `Using a shared grid of ${params?.cols}×${params?.rows}`,
        'terminal.sharedGeometry.localSize': 'This view',
        'terminal.sharedGeometry.effectiveSize': 'Shared size',
        'terminal.sharedGeometry.resolution': 'The shared grid adjusts automatically.',
        'terminal.sharedGeometry.triggerDescription': 'Open details about the shared terminal layout.',
      };
      return values[key] ?? key;
    },
  }),
}));

const presentation: TerminalSharedGeometryPresentation = {
  lifecycleEpoch: 3,
  rendererEpoch: 2,
  requestEpoch: 4,
  local: { cols: 120, rows: 40 },
  effective: {
    lifecycleEpoch: 3,
    rendererEpoch: 2,
    generation: 5,
    outputSequenceBoundary: 12,
    cols: 80,
    rows: 24,
  },
};

function renderNotice(options: Readonly<{
  interactive?: boolean;
  previousFocus?: () => HTMLElement | null;
  nextFocus?: () => HTMLElement | null;
  fallbackFocus?: () => HTMLElement | null;
}> = {}) {
  const host = document.createElement('div');
  const fallback = document.createElement('button');
  fallback.textContent = 'fallback';
  document.body.append(fallback, host);
  const dispose = render(() => (
    <TerminalSharedGeometryNotice
      presentation={presentation}
      mobile={false}
      interactive={options.interactive ?? true}
      fallbackFocus={options.fallbackFocus ?? (() => fallback)}
      surfaceBoundary={() => host}
      previousFocus={options.previousFocus}
      nextFocus={options.nextFocus}
    />
  ), host);
  return { host, fallback, dispose };
}

function dispatchKey(target: Element, key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe('TerminalSharedGeometryNotice', () => {
  beforeEach(() => {
    floatingLayerState.owner = null;
    floatingLayerState.position = null;
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('renders an inert visual instead of a dead button for an unselected Workbench', () => {
    const { host } = renderNotice({ interactive: false });

    expect(host.querySelector('button[aria-expanded]')).toBeNull();
    const inert = host.querySelector('[data-terminal-shared-geometry-inert="true"]');
    expect(inert?.getAttribute('aria-hidden')).toBe('true');
  });

  it('opens a labelled disclosure in the trigger-owned surface without moving focus', async () => {
    const { host } = renderNotice();
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    trigger.focus();
    trigger.click();
    await Promise.resolve();

    const region = host.querySelector<HTMLElement>('[role="region"]')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(region.id);
    expect(trigger.getAttribute('aria-describedby')).toBeTruthy();
    expect(region.getAttribute('aria-labelledby')).toBeTruthy();
    expect(region.textContent).toContain('120×40');
    expect(region.textContent).toContain('80×24');
    expect(floatingLayerState.owner).toBe(trigger);
    expect(document.activeElement).toBe(trigger);
  });

  it('moves the disclosure above a bottom-anchored trigger inside the surface boundary', async () => {
    const { host } = renderNotice();
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 40,
      y: 550,
      left: 40,
      top: 550,
      right: 224,
      bottom: 578,
      width: 184,
      height: 28,
      toJSON: () => undefined,
    });
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
      x: 20,
      y: 100,
      left: 20,
      top: 100,
      right: 820,
      bottom: 600,
      width: 800,
      height: 500,
      toJSON: () => undefined,
    });

    trigger.click();
    await Promise.resolve();

    expect(floatingLayerState.position).toEqual({ x: 40, y: 372 });
  });

  it('closes on Escape and consumes the key exactly once', async () => {
    const { host } = renderNotice();
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    trigger.focus();
    trigger.click();
    await Promise.resolve();

    const event = dispatchKey(trigger, 'Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when a projected ancestor moves the point anchor', async () => {
    const animationFrame = { callback: null as FrameRequestCallback | null };
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrame.callback = callback;
      return 17;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const { host } = renderNotice();
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    let left = 20;
    vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => ({
      x: left,
      y: 10,
      left,
      top: 10,
      right: left + 100,
      bottom: 38,
      width: 100,
      height: 28,
      toJSON: () => undefined,
    }));
    trigger.click();
    await Promise.resolve();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    left = 45;
    expect(animationFrame.callback).not.toBeNull();
    animationFrame.callback!(performance.now());
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves non-overflow content out of the tab order and preserves native Tab', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
    const { host } = renderNotice();
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    trigger.click();
    await Promise.resolve();

    const region = host.querySelector<HTMLElement>('[role="region"]')!;
    expect(region.hasAttribute('tabindex')).toBe(false);
    const event = dispatchKey(trigger, 'Tab');
    expect(event.defaultPrevented).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.click();
    await Promise.resolve();
    const reverseEvent = dispatchKey(trigger, 'Tab', true);
    expect(reverseEvent.defaultPrevented).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('routes overflow Tab and Shift+Tab through the scrollable region', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(240);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(80);
    const previous = document.createElement('button');
    const next = document.createElement('button');
    document.body.append(previous, next);
    const { host } = renderNotice({
      previousFocus: () => previous,
      nextFocus: () => next,
    });
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    trigger.click();
    await Promise.resolve();
    const region = host.querySelector<HTMLElement>('[role="region"]')!;

    expect(region.tabIndex).toBe(0);
    const intoRegion = dispatchKey(trigger, 'Tab');
    expect(intoRegion.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(region);

    const backToTrigger = dispatchKey(region, 'Tab', true);
    expect(backToTrigger.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger);

    const backwardOut = dispatchKey(trigger, 'Tab', true);
    expect(backwardOut.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(previous);

    trigger.click();
    await Promise.resolve();
    dispatchKey(trigger, 'Tab');
    const forwardOut = dispatchKey(host.querySelector<HTMLElement>('[role="region"]')!, 'Tab');
    expect(forwardOut.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(next);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('moves focus to the stable fallback when the focused notice unmounts', () => {
    const { host, fallback, dispose } = renderNotice();
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    trigger.focus();

    dispose();
    expect(document.activeElement).toBe(fallback);
  });

  it('moves region focus to the stable fallback before an interactive notice becomes inert', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(240);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(80);
    const host = document.createElement('div');
    const fallback = document.createElement('button');
    document.body.append(fallback, host);
    const [interactive, setInteractive] = createSignal(true);
    const dispose = render(() => (
      <TerminalSharedGeometryNotice
        presentation={presentation}
        mobile={false}
        interactive={interactive()}
        fallbackFocus={() => fallback}
        surfaceBoundary={() => host}
      />
    ), host);
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    trigger.click();
    await Promise.resolve();
    const region = host.querySelector<HTMLElement>('[role="region"]')!;
    region.focus();

    setInteractive(false);
    await Promise.resolve();
    expect(document.activeElement).toBe(fallback);
    expect(host.querySelector('button[aria-expanded]')).toBeNull();
    dispose();
  });
});
