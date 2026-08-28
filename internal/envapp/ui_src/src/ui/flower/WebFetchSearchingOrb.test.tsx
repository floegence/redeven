/** @vitest-environment jsdom */

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebFetchSearchingOrb } from '../../../../../flower_ui/src/WebFetchSearchingOrb';

type QueuedFrame = Readonly<{
  id: number;
  callback: FrameRequestCallback;
}>;

function mediaQuery(matches: boolean): MediaQueryList {
  return {
    matches,
    media: '',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
}

describe('WebFetchSearchingOrb', () => {
  let queuedFrames: QueuedFrame[];
  let nextFrameID: number;
  let fill: ReturnType<typeof vi.fn>;
  let cancelAnimationFrame: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queuedFrames = [];
    nextFrameID = 1;
    fill = vi.fn();
    cancelAnimationFrame = vi.fn();
    const context = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill,
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameID;
      nextFrameID += 1;
      queuedFrames.push({ id, callback });
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal('matchMedia', vi.fn((query: string) => mediaQuery(
      query === '(prefers-color-scheme: dark)',
    )));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('animates only while the Web Fetch activity is running, then freezes its last frame', () => {
    const [running, setRunning] = createSignal(true);
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <WebFetchSearchingOrb running={running()} />, host);
    const canvas = host.querySelector('canvas');
    const initialPaintCount = fill.mock.calls.length;

    expect(canvas?.dataset.running).toBe('true');
    expect(initialPaintCount).toBeGreaterThan(0);
    expect(queuedFrames).toHaveLength(1);

    const firstFrame = queuedFrames.shift();
    firstFrame?.callback(1_000);
    expect(fill.mock.calls.length).toBeGreaterThan(initialPaintCount);
    expect(queuedFrames).toHaveLength(1);

    setRunning(false);
    expect(canvas?.dataset.running).toBe('false');
    expect(cancelAnimationFrame).toHaveBeenCalledWith(queuedFrames[0]?.id);
    expect(fill.mock.calls.length).toBeGreaterThan(initialPaintCount);

    dispose();
  });

  it('paints one representative frame without scheduling animation for completed activity', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <WebFetchSearchingOrb running={false} />, host);

    expect(host.querySelector('canvas')?.dataset.running).toBe('false');
    expect(fill).toHaveBeenCalled();
    expect(queuedFrames).toHaveLength(0);

    dispose();
  });

  it('honors reduced motion while keeping the Searching orb visible', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => mediaQuery(
      query === '(prefers-reduced-motion: reduce)',
    )));
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <WebFetchSearchingOrb running />, host);

    expect(host.querySelector('canvas')?.dataset.running).toBe('true');
    expect(fill).toHaveBeenCalled();
    expect(queuedFrames).toHaveLength(0);

    dispose();
  });

  it('starts only after entering the viewport and pauses again when hidden', () => {
    let intersectionCallback: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      observe() {}

      disconnect() {
        disconnect();
      }
    });
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <WebFetchSearchingOrb running />, host);

    expect(queuedFrames).toHaveLength(0);
    intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(queuedFrames).toHaveLength(1);

    intersectionCallback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(queuedFrames[0]?.id);

    dispose();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
