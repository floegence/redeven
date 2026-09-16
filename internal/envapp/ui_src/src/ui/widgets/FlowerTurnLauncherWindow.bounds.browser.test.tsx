import '../../index.css';
import '../flower-feature.css';

import { LayoutProvider } from '@floegence/floe-webapp-core';
import { InfiniteCanvas } from '@floegence/floe-webapp-core/ui';
import { Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowerTurnLauncherWindow } from '../../../../../flower_ui/src/FlowerTurnLauncherWindow';
import { createAskFlowerWindowViewportInsets } from '../../../../../../desktop/src/shared/askFlowerWindowViewport';
import type { DesktopWindowChromeSnapshot } from '../../../../../../desktop/src/shared/windowChromeContract';

const disposers: Array<() => void> = [];
afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  document.body.innerHTML = '';
});

async function settle() {
  for (let index = 0; index < 3; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

async function mountLauncher() {
  await page.viewport(1440, 900);
  const host = document.createElement('div');
  document.body.append(host);
  const [insets, setInsets] = createSignal({ top: 72, right: 0, bottom: 0, left: 0 });
  const onClose = vi.fn();
  const onSubmit = vi.fn(async () => undefined);
  disposers.push(render(() => (
    <LayoutProvider>
      <FlowerTurnLauncherWindow
        open
        anchor={{ x: 240, y: 0 }}
        viewportInsets={insets()}
        intent={{ id: 'launcher-bounds', source_surface: 'monitoring', context_items: [], pending_attachments: [], notes: [] }}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </LayoutProvider>
  ), host));
  await settle();
  const root = document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]')!;
  const titlebar = root.querySelector<HTMLElement>('[data-floe-floating-window-titlebar]')!;
  return { root, titlebar, setInsets, onClose, onSubmit };
}

async function movePointer(target: HTMLElement, root: HTMLElement, dx: number, dy: number) {
  const box = target.getBoundingClientRect();
  const start = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
  const options = { bubbles: true, cancelable: true, pointerId: 23, pointerType: 'mouse', button: 0, buttons: 1 };
  target.dispatchEvent(new PointerEvent('pointerdown', { ...options, ...start }));
  const end = { clientX: start.clientX + dx, clientY: start.clientY + dy };
  root.dispatchEvent(new PointerEvent('pointermove', { ...options, ...end }));
  await settle();
  root.dispatchEvent(new PointerEvent('pointerup', { ...options, ...end, buttons: 0 }));
  await settle();
}

describe('Ask Flower window bounds', () => {
  it('keeps opening, dragging, resizing, and viewport changes below the header', async () => {
    const { root, titlebar, setInsets, onSubmit } = await mountLauncher();
    expect(root.getBoundingClientRect().top).toBeGreaterThanOrEqual(84);
    const editor = root.querySelector<HTMLTextAreaElement>('textarea')!;
    await userEvent.fill(editor, 'Keep this draft');
    await movePointer(titlebar, root, 40, -1000);
    expect(root.getBoundingClientRect().top).toBe(84);
    const resize = root.querySelector<HTMLElement>('[data-floe-floating-window-resize-handle="n"]')!;
    await movePointer(resize, root, 0, -1000);
    expect(root.getBoundingClientRect().top).toBe(84);
    setInsets({ top: 96, right: 0, bottom: 0, left: 0 });
    await settle();
    expect(root.getBoundingClientRect().top).toBeGreaterThanOrEqual(108);
    await page.viewport(900, 400);
    await settle();
    const bounds = root.getBoundingClientRect();
    expect(bounds.top).toBeGreaterThanOrEqual(108);
    expect(bounds.bottom).toBeLessThanOrEqual(388);
    expect(editor.value).toBe('Keep this draft');
    const send = root.querySelector<HTMLElement>('[data-testid="flower-turn-launcher-inline-send"]')!;
    expect(send.getBoundingClientRect().bottom).toBeLessThanOrEqual(bounds.bottom);
    await userEvent.click(send);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('removes all maximize entry points while retaining resize and close controls', async () => {
    const { root, titlebar, onClose } = await mountLauncher();
    expect(root.querySelector('[data-floe-floating-window-control="maximize"]')).toBeNull();
    const initial = root.getBoundingClientRect().toJSON();
    await userEvent.dblClick(titlebar);
    expect(root.getBoundingClientRect().toJSON()).toEqual(initial);
    const resize = root.querySelector<HTMLElement>('[data-floe-floating-window-resize-handle="se"]')!;
    await movePointer(resize, root, 60, 40);
    expect(root.getBoundingClientRect().width).toBeGreaterThan(initial.width);
    await userEvent.click(root.querySelector<HTMLElement>('[data-floe-floating-window-control="close"]')!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('tracks host header replacement and native chrome without taking Workbench input ownership', async () => {
    await page.viewport(1440, 900);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0';
    document.body.append(host);
    const [mode, setMode] = createSignal('activity');
    const [workbenchReady, setWorkbenchReady] = createSignal(false);
    const onCanvasChange = vi.fn();
    const onClose = vi.fn();
    const unsubscribe = vi.fn();
    const snapshot: DesktopWindowChromeSnapshot = {
      mode: 'hidden-inset', controlsSide: 'left', titleBarHeight: 40, contentInsetStart: 84, contentInsetEnd: 16,
    };
    let updateChrome!: (value: DesktopWindowChromeSnapshot) => void;
    function Harness() {
      const viewportInsets = createAskFlowerWindowViewportInsets({
        open: () => true,
        chrome: { getSnapshot: () => snapshot, subscribe: (listener) => { updateChrome = listener; return unsubscribe; } },
      });
      return (
        <LayoutProvider>
          <header data-floe-shell-slot="top-bar" style={{ display: 'none', height: '300px' }} />
          <Show when={mode() === 'activity'} fallback={(
            <Show when={workbenchReady()}><header data-floe-shell-slot="top-bar" style={{ height: '64px' }} /></Show>
          )}>
            <header data-floe-shell-slot="top-bar" style={{ height: '48px' }} />
          </Show>
          <InfiniteCanvas viewport={{ x: 120, y: 80, scale: 0.65 }} onViewportChange={onCanvasChange}>
            <div data-floe-dialog-surface-host="true" style={{ width: '500px', height: '300px' }}>
              <FlowerTurnLauncherWindow
                open
                anchor={{ x: 240, y: 0 }}
                viewportInsets={viewportInsets()}
                intent={{ id: 'host-bounds', source_surface: 'monitoring', context_items: [] }}
                onClose={onClose}
                onSubmit={async () => undefined}
              />
            </div>
          </InfiniteCanvas>
        </LayoutProvider>
      );
    }
    disposers.push(render(() => <Harness />, host));
    await settle();
    const root = document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]')!;
    const titlebar = root.querySelector<HTMLElement>('[data-floe-floating-window-titlebar]')!;
    const editor = root.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(root.getBoundingClientRect().top).toBe(60);
    await userEvent.fill(editor, 'Draft across hosts');
    setMode('workbench');
    await settle();
    setWorkbenchReady(true);
    await settle();
    expect(root.getBoundingClientRect().top).toBe(76);
    const header = host.querySelector<HTMLElement>('header:not([style*="display"])')!;
    header.style.height = '80px';
    await settle();
    expect(root.getBoundingClientRect().top).toBe(92);
    updateChrome({ ...snapshot, titleBarHeight: 100 });
    await settle();
    expect(root.getBoundingClientRect().top).toBe(112);
    await movePointer(titlebar, root, 50, -1000);
    expect(root.getBoundingClientRect().top).toBe(112);
    expect(editor.value).toBe('Draft across hosts');
    const close = root.querySelector<HTMLElement>('[data-floe-floating-window-control="close"]')!;
    const box = close.getBoundingClientRect();
    expect(close.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))).toBe(true);
    await userEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onCanvasChange).not.toHaveBeenCalled();
    disposers.pop()?.();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('uses the compact header gap and keeps controls inside a narrow viewport', async () => {
    const { root, titlebar } = await mountLauncher();
    await page.viewport(390, 500);
    await settle();
    await movePointer(titlebar, root, 0, -1000);
    const bounds = root.getBoundingClientRect();
    expect(bounds.top).toBe(80);
    expect(bounds.right).toBeLessThanOrEqual(390);
    expect(bounds.bottom).toBeLessThanOrEqual(492);
    const send = root.querySelector<HTMLElement>('[data-testid="flower-turn-launcher-inline-send"]')!;
    expect(send.getBoundingClientRect().bottom).toBeLessThanOrEqual(bounds.bottom);
  });
});
