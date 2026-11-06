import '../../index.css';
import '../flower-feature.css';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import type { ContextMenuItem } from '@floegence/floe-webapp-core/file-browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { FlowerTurnLauncherWindow, type FlowerTurnLauncherAnchor } from '../../../../../flower_ui/src/FlowerTurnLauncherWindow';
import type { FlowerTurnLauncherIntent } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { FileBrowserWorkspace } from './FileBrowserWorkspace';
import { FilePreviewActions } from './FilePreviewActions';
import { buildFilePathFlowerTurnLauncherIntent } from '../utils/filePathAskFlower';

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose());
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.floeShellTheme;
});
async function settle() {
  for (let index = 0; index < 3; index += 1) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}
async function settledCard() {
  await expect.poll(() => document.querySelector('[data-floe-prompt-card]')).toBeTruthy();
  const card = document.querySelector<HTMLElement>('[data-floe-prompt-card]')!;
  await expect.poll(() => card.dataset.floatingPresence).toBe('open');
  await Promise.allSettled(card.getAnimations().map(animation => animation.finished));
  return card;
}
const file = { id: '/workspace/story.html', name: 'story.html', path: '/workspace/story.html', type: 'file' as const };
function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  const [intent, setIntent] = createSignal<FlowerTurnLauncherIntent | null>(null);
  const [anchor, setAnchor] = createSignal<FlowerTurnLauncherAnchor | null>(null);
  const [open, setOpen] = createSignal(false);
  const frames: Array<{ opacity: number; y: number }> = [];
  const launch = (point?: FlowerTurnLauncherAnchor) => {
    setAnchor(point ?? null);
    setIntent(buildFilePathFlowerTurnLauncherIntent({ items: [{ path: file.path, isDirectory: false }], fallbackWorkingDirAbs: '/workspace' }).intent);
    setOpen(true);
    const start = performance.now();
    const sample = () => {
      const card = document.querySelector('[data-floe-prompt-card]');
      if (card) {
        const style = getComputedStyle(card);
        frames.push({ opacity: Number(style.opacity), y: new DOMMatrixReadOnly(style.transform).m42 });
      }
      if (open() && performance.now() - start < 350) requestAnimationFrame(sample);
    };
    sample();
  };
  const items: ContextMenuItem[] = [{ id: 'ask-flower', label: 'Ask Flower', type: 'custom', onAction: (_files, event) => launch(event) }];
  disposers.push(render(() => <FloeConfigProvider><LayoutProvider>
    <main style={{ position: 'fixed', inset: '0', background: 'var(--background)' }}>
      <header style={{ height: '56px', display: 'flex', 'justify-content': 'flex-end', padding: '12px' }}>
        <FilePreviewActions presentation="menu" item={file} descriptor={{ mode: 'html' }} onAskFlower={(_text, point) => launch(point)} />
      </header>
      <section style={{ position: 'absolute', inset: '56px 0 0' }}>
        <FileBrowserWorkspace mode="files" onModeChange={() => {}} currentPath="/workspace" initialPath="/workspace" instanceId="ask-flower-anchor" resetKey={0} open={false}
          files={[{ id: '/workspace', name: 'workspace', path: '/workspace', type: 'folder', children: [...Array.from({ length: 23 }, (_, index) => ({ id: `/workspace/note-${index}.md`, path: `/workspace/note-${index}.md`, name: `note-${index}.md`, type: 'file' as const })), file] }]} overrideContextMenuItems={items} />
      </section>
    </main>
    <FlowerTurnLauncherWindow open={open()} intent={intent()} anchor={anchor()} viewportInsets={{ top: 56 }} onClose={() => { setOpen(false); setIntent(null); setAnchor(null); }} onSubmit={async () => {}} />
  </LayoutProvider></FloeConfigProvider>, host));
  return { host, frames };
}

describe('Ask Flower contextual placement and motion', () => {
  it.each([{ width: 1440, view: 'Grid', dark: false }, { width: 1440, view: 'List', dark: true }, { width: 390, view: 'Grid', dark: true }])('keeps the card beside the original $view target at $width pixels', async ({ width, view, dark }) => {
    await page.viewport(width, 900);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.floeShellTheme = dark ? 'porcelain-dark' : 'porcelain-light';
    const { host, frames } = mount();
    await settle();
    Array.from(host.querySelectorAll('button')).find(button => button.textContent === view)!.click();
    await settle();
    const content = host.querySelector<HTMLElement>('[data-testid="file-browser-content-scroll-region"]')!;
    const scroll = Array.from(content.querySelectorAll<HTMLElement>('*')).find(element => element.scrollHeight > element.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(element).overflowY)) ?? content;
    scroll.scrollTop = scroll.scrollHeight;
    await expect.poll(() => host.querySelector('[data-file-browser-item-path="/workspace/story.html"]')).toBeTruthy();
    const target = host.querySelector<HTMLElement>('[data-file-browser-item-path="/workspace/story.html"]')!;
    target.scrollIntoView({ block: 'center' });
    await settle();
    const rect = target.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const event = { bubbles: true, cancelable: true, button: 2, clientX: point.x, clientY: point.y };
    target.dispatchEvent(new PointerEvent('pointerdown', { ...event, pointerType: 'mouse' }));
    target.dispatchEvent(new MouseEvent('contextmenu', event));
    await userEvent.click(page.getByRole('menuitem', { name: 'Ask Flower', exact: true }));
    const card = await settledCard();
    const box = card.getBoundingClientRect();
    expect(Math.min(Math.abs(box.top - point.y - 8), Math.abs(box.bottom - point.y + 8))).toBeLessThan(1);
    expect(box.left).toBeGreaterThanOrEqual(width < 640 ? 8 : 12);
    expect(box.right).toBeLessThanOrEqual(width - (width < 640 ? 8 : 12));
    expect(document.activeElement).toBe(card.querySelector('textarea'));
    expect(card.querySelector('textarea')!.placeholder).toBe('');
    expect(frames.some(frame => Math.abs(frame.y) >= 6)).toBe(true);
    await userEvent.fill(card.querySelector('textarea')!, 'Inspect this file');
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1000);
    await page.screenshot({ path: `__screenshots__/FlowerTurnLauncherWindow.anchor.browser.test.tsx/accepted-${width}-${view}-${dark ? 'dark' : 'light'}.png` });
    const editor = card.querySelector('textarea')!;
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(card.inert).toBe(true);
    const exitBox = card.parentElement!.getBoundingClientRect();
    const exitFrames: number[] = [];
    const started = performance.now();
    while (card.isConnected && performance.now() - started < 500) {
      exitFrames.push(new DOMMatrixReadOnly(getComputedStyle(card).transform).m42);
      expect(card.parentElement!.getBoundingClientRect().x).toBe(exitBox.x);
      expect(editor.value).toBe('Inspect this file');
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    expect(exitFrames.some(y => Math.abs(y) >= 1)).toBe(true);
    expect(card.isConnected).toBe(false);
  });

  it('retains the preview menu trigger after its menu closes', async () => {
    await page.viewport(1280, 900);
    const { host } = mount();
    await settle();
    const more = host.querySelector<HTMLButtonElement>('button[aria-label="More file actions"]')!;
    const source = more.getBoundingClientRect();
    await userEvent.click(more);
    await userEvent.click(page.getByRole('menuitem', { name: 'Ask Flower', exact: true }));
    const card = await settledCard();
    expect(card.getBoundingClientRect().top).toBeGreaterThanOrEqual(68);
    expect(card.getBoundingClientRect().right).toBeGreaterThan(source.left - 12);
    expect(document.activeElement).toBe(card.querySelector('textarea'));
  });
});
