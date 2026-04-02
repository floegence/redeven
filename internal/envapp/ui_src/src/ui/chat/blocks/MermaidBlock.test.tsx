// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LARGE_MERMAID_FIXTURE } from '../__fixtures__/largeMermaid';

const deferredPaintCallbacks = vi.hoisted(() => [] as Array<() => void>);
const mermaidInitializeMock = vi.hoisted(() => vi.fn());
const mermaidRenderMock = vi.hoisted(() => vi.fn());

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  deferAfterPaint: (fn: () => void) => {
    deferredPaintCallbacks.push(fn);
  },
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: (...args: unknown[]) => mermaidInitializeMock(...args),
    render: (...args: unknown[]) => mermaidRenderMock(...args),
  },
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushAfterPaint(): Promise<void> {
  while (deferredPaintCallbacks.length > 0) {
    const callback = deferredPaintCallbacks.shift();
    callback?.();
    await flushAsync();
  }
}

describe('MermaidBlock', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    deferredPaintCallbacks.length = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(16), 0));
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle));
    mermaidRenderMock.mockResolvedValue({ svg: '<svg data-testid="mermaid-diagram"></svg>' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders mermaid diagrams after paint instead of in the initial effect', async () => {
    const { MermaidBlock } = await import('./MermaidBlock');
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <MermaidBlock content="graph TD\nA-->B" />, host);

    expect(mermaidRenderMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Rendering diagram...');

    await flushAfterPaint();

    expect(mermaidInitializeMock).toHaveBeenCalledTimes(1);
    expect(mermaidRenderMock).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="mermaid-diagram"]')).toBeTruthy();
  });

  it('uses idle scheduling for large diagrams and reuses the cached svg', async () => {
    const requestIdleCallbackMock = vi.fn((callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) => {
      callback({ didTimeout: false, timeRemaining: () => 50 });
      return 1;
    });
    vi.stubGlobal('requestIdleCallback', requestIdleCallbackMock);
    vi.stubGlobal('cancelIdleCallback', vi.fn());

    const { MermaidBlock } = await import('./MermaidBlock');
    const firstHost = document.createElement('div');
    document.body.appendChild(firstHost);

    render(() => <MermaidBlock content={LARGE_MERMAID_FIXTURE} />, firstHost);
    await flushAfterPaint();

    expect(requestIdleCallbackMock).toHaveBeenCalled();
    expect(mermaidRenderMock).toHaveBeenCalledTimes(1);
    expect(firstHost.querySelector('[data-testid="mermaid-diagram"]')).toBeTruthy();

    const secondHost = document.createElement('div');
    document.body.appendChild(secondHost);

    render(() => <MermaidBlock content={LARGE_MERMAID_FIXTURE} />, secondHost);
    await flushAsync();

    expect(mermaidRenderMock).toHaveBeenCalledTimes(1);
    expect(secondHost.querySelector('[data-testid="mermaid-diagram"]')).toBeTruthy();
  });
});
