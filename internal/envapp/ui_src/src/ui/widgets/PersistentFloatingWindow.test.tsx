// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUIStorageAdapter, readUIStorageJSON, removeUIStorageItem, writeUIStorageJSON } from '../services/uiStorage';
import { PersistentFloatingWindow, floatingWindowStorageKey } from './PersistentFloatingWindow';
import { LOCAL_INTERACTION_SURFACE_ATTR } from '@floegence/floe-webapp-core/ui';
import { DESKTOP_WINDOW_CHROME_NO_DRAG_ATTR } from '../../../../../../desktop/src/shared/windowChromeContract';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  LOCAL_INTERACTION_SURFACE_ATTR: 'data-floe-local-interaction-surface',
  FloatingWindow: (props: any) => (
    props.open ? (
      <div
        data-testid="floating-root"
        data-floe-geometry-surface="floating-window"
        data-default-x={String(props.defaultPosition?.x ?? '')}
        data-default-y={String(props.defaultPosition?.y ?? '')}
        data-default-width={String(props.defaultSize?.width ?? '')}
        data-default-height={String(props.defaultSize?.height ?? '')}
        data-viewport-insets={JSON.stringify(props.viewportInsets ?? null)}
        style={{
          transform: `translate3d(${props.defaultPosition?.x ?? 0}px, ${props.defaultPosition?.y ?? 0}px, 0)`,
          width: `${props.defaultSize?.width ?? 400}px`,
          height: `${props.defaultSize?.height ?? 300}px`,
        }}
      >
        <div data-testid="floating-surface" class={props.class}>
          <div data-testid="floating-titlebar">{props.title}</div>
          <div data-testid="floating-content">{props.children}</div>
          {props.footer ? <div data-testid="floating-footer">{props.footer}</div> : null}
        </div>
      </div>
    ) : null
  ),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
});

function adapterKeys(): string[] {
  return createUIStorageAdapter().keys?.() ?? [];
}

afterEach(() => {
  delete window.redevenDesktopWindowChrome;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const key of adapterKeys()) {
    removeUIStorageItem(key);
  }
  document.body.innerHTML = '';
});

describe('PersistentFloatingWindow', () => {
  it('restores the persisted default position and size', () => {
    writeUIStorageJSON(floatingWindowStorageKey('demo'), { x: 140, y: 96, width: 720, height: 480 });

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <PersistentFloatingWindow open onOpenChange={() => undefined} title="Demo" persistenceKey="demo">
        <div>content</div>
      </PersistentFloatingWindow>
    ), host);

    const root = host.querySelector('[data-testid="floating-root"]') as HTMLDivElement | null;
    expect(root?.dataset.defaultX).toBe('140');
    expect(root?.dataset.defaultY).toBe('96');
    expect(root?.dataset.defaultWidth).toBe('720');
    expect(root?.dataset.defaultHeight).toBe('480');
  });

  it('persists updated geometry after style mutations', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <PersistentFloatingWindow open onOpenChange={() => undefined} title="Demo" persistenceKey="demo">
        <div>content</div>
      </PersistentFloatingWindow>
    ), host);

    const root = host.querySelector('[data-testid="floating-root"]') as HTMLDivElement | null;
    expect(root).toBeTruthy();
    Object.defineProperty(root!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 220, y: 180, width: 860, height: 540 }),
    });

    root!.style.transform = 'translate3d(220px, 180px, 0)';
    root!.style.width = '860px';
    root!.style.height = '540px';

    vi.advanceTimersByTime(200);

    expect(readUIStorageJSON(floatingWindowStorageKey('demo'), null)).toEqual({
      x: 220,
      y: 180,
      width: 860,
      height: 540,
    });
  });

  it('applies custom content and footer classes to the floating window slots', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <PersistentFloatingWindow
        open
        onOpenChange={() => undefined}
        title="Demo"
        persistenceKey="demo"
        contentClass="!p-0"
        footerClass="!px-2.5"
        footer={<div>footer</div>}
      >
        <div>content</div>
      </PersistentFloatingWindow>
    ), host);

    await Promise.resolve();
    vi.advanceTimersByTime(1);
    await Promise.resolve();

    const content = host.querySelector('[data-testid="floating-content"]');
    const footer = host.querySelector('[data-testid="floating-footer"]');

    expect(content?.className).toContain('!p-0');
    expect(footer?.className).toContain('!px-2.5');
  });

  it('exposes the floating surface root through surfaceRef while open', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const surfaceRef = vi.fn();

    render(() => (
      <PersistentFloatingWindow
        open
        onOpenChange={() => undefined}
        title="Demo"
        persistenceKey="demo"
        surfaceRef={surfaceRef}
      >
        <div>content</div>
      </PersistentFloatingWindow>
    ), host);

    await Promise.resolve();
    vi.advanceTimersByTime(1);
    await Promise.resolve();

    const root = host.querySelector('[data-testid="floating-root"]') as HTMLDivElement | null;
    expect(root).toBeTruthy();
    expect(surfaceRef).toHaveBeenCalledWith(root);
  });

  it('marks both the geometry root and the visible floating surface as local input surfaces', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <PersistentFloatingWindow open onOpenChange={() => undefined} title="Demo" persistenceKey="demo">
        <div>content</div>
      </PersistentFloatingWindow>
    ), host);

    await Promise.resolve();
    vi.advanceTimersByTime(1);
    await Promise.resolve();

    const root = host.querySelector('[data-testid="floating-root"]') as HTMLDivElement | null;
    const surface = host.querySelector('[data-testid="floating-surface"]') as HTMLDivElement | null;
    expect(root?.getAttribute(LOCAL_INTERACTION_SURFACE_ATTR)).toBe('true');
    expect(surface?.getAttribute(LOCAL_INTERACTION_SURFACE_ATTR)).toBe('true');
    expect(root?.getAttribute(DESKTOP_WINDOW_CHROME_NO_DRAG_ATTR)).toBe('true');
    expect(surface?.getAttribute(DESKTOP_WINDOW_CHROME_NO_DRAG_ATTR)).toBe('true');
  });

  it('passes desktop window chrome safe area to the shared floating window', () => {
    window.redevenDesktopWindowChrome = {
      getSnapshot: () => ({
        mode: 'hidden-inset',
        controlsSide: 'right',
        titleBarHeight: 52,
        contentInsetStart: 16,
        contentInsetEnd: 144,
      }),
      subscribe: () => () => undefined,
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <PersistentFloatingWindow
        open
        onOpenChange={() => undefined}
        title="Demo"
        viewportInsets={{ top: 20, right: 12, bottom: 8, left: 4 }}
      >
        <div>content</div>
      </PersistentFloatingWindow>
    ), host);

    const root = host.querySelector('[data-testid="floating-root"]') as HTMLDivElement | null;
    expect(root?.dataset.viewportInsets).toBe(JSON.stringify({
      top: 52,
      right: 12,
      bottom: 8,
      left: 4,
    }));
  });
});
