import '../../index.css';
import '../flower-feature.css';

import { LayoutProvider } from '@floegence/floe-webapp-core';
import { InfiniteCanvas } from '@floegence/floe-webapp-core/ui';
import { Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { commands, page, userEvent } from 'vitest/browser';
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
  await expect.poll(() => document.querySelector<HTMLElement>('[data-flower-ask-card]')?.getAnimations().some(a => a.playState === 'running')).toBe(false);
  const root = document.querySelector<HTMLElement>('[data-flower-ask-card]')!;
  const titlebar = root.querySelector<HTMLElement>('.flower-ask-card-header')!;
  return { root, titlebar, setInsets, onClose, onSubmit };
}

describe('Ask Flower card bounds', () => {
  it('keeps content-sized opening and viewport changes below the header', async () => {
    const { root, setInsets, onSubmit } = await mountLauncher();
    expect(root.getBoundingClientRect().top).toBeGreaterThanOrEqual(84);
    const editor = root.querySelector<HTMLTextAreaElement>('textarea')!;
    await userEvent.fill(editor, 'Keep this draft');
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

  it('replaces window chrome with a compact identity and accessible close control', async () => {
    const { root, titlebar, onClose } = await mountLauncher();
    expect(root.querySelector('[data-floe-floating-window-control]')).toBeNull();
    expect(root.querySelector('[data-floe-floating-window-resize-handle]')).toBeNull();
    const initial = root.getBoundingClientRect().toJSON();
    await userEvent.dblClick(titlebar);
    expect(root.getBoundingClientRect().toJSON()).toEqual(initial);
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(root.querySelector<HTMLElement>('[data-testid="flower-ask-card-close"]')!);
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
    await expect.poll(() => document.querySelector<HTMLElement>('[data-flower-ask-card]')?.getAnimations().some(a => a.playState === 'running')).toBe(false);
    const root = document.querySelector<HTMLElement>('[data-flower-ask-card]')!;
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
    expect(editor.value).toBe('Draft across hosts');
    const close = root.querySelector<HTMLElement>('[data-testid="flower-ask-card-close"]')!;
    const box = close.getBoundingClientRect();
    expect(close.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))).toBe(true);
    await userEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onCanvasChange).not.toHaveBeenCalled();
    disposers.pop()?.();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('uses the compact header gap and keeps controls inside a narrow viewport', async () => {
    const { root } = await mountLauncher();
    await page.viewport(390, 500);
    await settle();
    const bounds = root.getBoundingClientRect();
    expect(bounds.top).toBe(80);
    expect(bounds.right).toBeLessThanOrEqual(390);
    expect(bounds.bottom).toBeLessThanOrEqual(492);
    const send = root.querySelector<HTMLElement>('[data-testid="flower-turn-launcher-inline-send"]')!;
    expect(send.getBoundingClientRect().bottom).toBeLessThanOrEqual(bounds.bottom);
  });
});


it('keeps the same draft and position through interrupted exit, then restores trigger focus', async () => {
  await page.viewport(1280, 800);
  const host = document.createElement('div'); document.body.append(host);
  const [open, setOpen] = createSignal(false);
  const intent = { id: 'reversible-card', source_surface: 'monitoring' as const, context_items: [] };
  disposers.push(render(() => <LayoutProvider>
    <button data-testid="ask-trigger" onClick={() => setOpen(true)}>Ask Flower</button>
    <FlowerTurnLauncherWindow open={open()} intent={open() ? intent : null} anchor={open() ? { x: 120, y: 300 } : null}
      onClose={() => setOpen(false)} onSubmit={async () => undefined} />
  </LayoutProvider>, host));
  const trigger = host.querySelector<HTMLButtonElement>('button')!;
  await userEvent.click(trigger);
  await expect.poll(() => document.activeElement?.tagName).toBe('TEXTAREA');
  const card = document.querySelector<HTMLElement>('[data-flower-ask-card]')!;
  await expect.poll(() => card.getAnimations().some(a => a.playState === 'running')).toBe(false);
  const editor = card.querySelector<HTMLTextAreaElement>('textarea')!;
  await userEvent.fill(editor, 'Preserve this exact draft');
  const position = card.parentElement!.style.cssText;
  setOpen(false);
  expect(card.dataset.floatingPresence).toBe('exiting');
  expect(card.inert).toBe(true);
  expect(editor.value).toBe('Preserve this exact draft');
  expect(card.parentElement!.style.cssText).toBe(position);
  setOpen(true);
  expect(document.querySelector('textarea')).toBe(editor);
  expect(editor.value).toBe('Preserve this exact draft');
  expect(card.inert).toBe(false);
  expect(card.dataset.floatingPresence).toBe('open');
  await userEvent.click(editor);
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => card.isConnected).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

it('keeps preview controls inside dismissal ownership and lets outside clicks reach their destination', async () => {
  const { root, onClose } = await mountLauncher();
  const preview = document.createElement('div');
  preview.dataset.floeGeometrySurface = 'floating-window';
  preview.innerHTML = '<div class="flower-turn-launcher-related-surface"><button>Preview close</button></div><div data-resize-handle></div>';
  document.body.append(preview);
  preview.querySelector('button')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  preview.querySelector('[data-resize-handle]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  const previewEscape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  preview.querySelector('button')!.dispatchEvent(previewEscape);
  expect(onClose).not.toHaveBeenCalled();
  const editor = root.querySelector('textarea')!;
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }));
  expect(onClose).not.toHaveBeenCalled();
  const outside = document.createElement('button'); outside.textContent = 'Outside destination'; document.body.append(outside);
  const destination = vi.fn(); outside.addEventListener('click', destination);
  await userEvent.click(outside);
  expect(destination).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(outside);
});

it('keeps the editor and Send reachable above a narrow soft keyboard', async () => {
  const media = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
  await media.emulateTouchInput(true);
  const descriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  const visual = Object.assign(new EventTarget(), { width: 390, height: 700, offsetLeft: 0, offsetTop: 0, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
  try {
    const { root, onSubmit } = await mountLauncher();
    await page.viewport(390, 700);
    const editor = root.querySelector<HTMLTextAreaElement>('textarea')!;
    await userEvent.fill(editor, 'Keep my draft above the keyboard');
    visual.height = 340;
    visual.dispatchEvent(new Event('resize'));
    await expect.poll(() => root.getBoundingClientRect().bottom).toBeLessThanOrEqual(332);
    const send = root.querySelector<HTMLElement>('[data-testid="flower-turn-launcher-inline-send"]')!;
    expect(send.getBoundingClientRect().bottom).toBeLessThanOrEqual(332);
    expect(editor.value).toBe('Keep my draft above the keyboard');
    await userEvent.click(send);
    expect(onSubmit).toHaveBeenCalledOnce();
  } finally {
    if (descriptor) Object.defineProperty(window, 'visualViewport', descriptor);
    else Reflect.deleteProperty(window, 'visualViewport');
    await media.emulateTouchInput(false);
  }
});
