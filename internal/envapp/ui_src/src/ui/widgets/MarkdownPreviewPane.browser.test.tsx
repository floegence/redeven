import '../../index.css';

import { page, userEvent } from 'vitest/browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { builtInShellThemePresets, FloeConfigProvider, LayoutProvider, ThemeProvider } from '@floegence/floe-webapp-core';
import { FilePreviewContext } from './FilePreviewContext';
import { FilePreviewSurface } from './FilePreviewSurface';
import { createFilePreviewController } from './createFilePreviewController';
import { floatingWindowStorageKey } from './PersistentFloatingWindow';
import { removeUIStorageItem, writeUIStorageJSON } from '../services/uiStorage';

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
  removeUIStorageItem(floatingWindowStorageKey('file-preview'));
});

const cases = [420, 680, 1040].flatMap(width => (['light', 'dark'] as const).map(mode => ({ width, mode })));

it.each(cases)('overlays Contents without reflowing a $width px floating preview in $mode mode', async ({ width, mode }) => {
  await page.viewport(1280, 900);
  writeUIStorageJSON(floatingWindowStorageKey('file-preview'), { x: 40, y: 60, width, height: 600 });
  const onOpenChange = vi.fn();
  const [path, setPath] = createSignal('/workspace/guide.md');
  const [content, setContent] = createSignal('# Repository guide\n\n' + Array.from({ length: 12 }, (_, index) => (
    `## Section ${index + 1}\n\n${'Readable document content keeps its full available width. '.repeat(7)}`
  )).join('\n\n'));
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => {
    const controller = createFilePreviewController({ client: () => undefined, rpc: () => undefined, canWrite: () => true });
    return (
      <FloeConfigProvider config={{ theme: {
        storageKey: `markdown-drawer-${mode}-${width}`, defaultTheme: mode, defaultSurfaceStyle: 'soft-neumorphic',
        shellPresets: builtInShellThemePresets, defaultShellPreset: { light: 'paper', dark: 'classic-dark' },
      } }}>
        <ThemeProvider>
          <LayoutProvider>
            <FilePreviewContext.Provider value={{ controller, openPreview: controller.openPreview, closePreview: controller.closePreview }}>
              <FilePreviewSurface open onOpenChange={onOpenChange}
                item={{ id: path(), path: path(), name: 'guide.md', type: 'file' }}
                descriptor={{ mode: 'markdown' }} text={content()} />
            </FilePreviewContext.Provider>
          </LayoutProvider>
        </ThemeProvider>
      </FloeConfigProvider>
    );
  }, host);
  try {
    await vi.waitFor(() => expect(document.querySelector('.file-markdown-body p')).toBeTruthy());
    const root = document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]')!;
    const layout = root.querySelector<HTMLElement>('.fm-markdown-layout')!;
    const body = root.querySelector<HTMLElement>('.file-markdown-body')!;
    const paragraph = body.querySelector('p')!;
    const toggle = root.querySelector<HTMLButtonElement>('button[aria-label="Toggle table of contents"]')!;
    expect(root.querySelector('.fm-toc-panel, .fm-toc-drawer')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    body.scrollTop = 180;
    const before = { width: body.clientWidth, scrollTop: body.scrollTop, paragraphWidth: paragraph.getBoundingClientRect().width };
    const assertUnchanged = () => {
      expect(root.querySelector('.file-markdown-body')).toBe(body);
      expect(body.querySelector('p')).toBe(paragraph);
      expect(body.clientWidth).toBe(before.width);
      expect(body.scrollTop).toBe(before.scrollTop);
      expect(paragraph.getBoundingClientRect().width).toBe(before.paragraphWidth);
    };
    const openContents = async () => {
      await userEvent.click(toggle);
      await vi.waitFor(() => expect(layout.querySelector('.fm-toc-drawer[data-floating-presence="open"]')).toBeTruthy());
      const drawer = layout.querySelector<HTMLElement>('.fm-toc-drawer')!;
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      await vi.waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));
      await vi.waitFor(() => expect(Math.abs(drawer.getBoundingClientRect().right - layout.getBoundingClientRect().right)).toBeLessThan(1));
      return drawer;
    };
    const assertClosed = async (restoreFocus = true) => {
      await vi.waitFor(() => expect(layout.querySelector('.fm-toc-drawer')).toBeNull());
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      if (restoreFocus) await vi.waitFor(() => expect(document.activeElement === toggle).toBe(true));
      expect(onOpenChange).not.toHaveBeenCalled();
    };

    let drawer = await openContents();
    assertUnchanged();
    const bounds = layout.getBoundingClientRect();
    const drawerBounds = drawer.getBoundingClientRect();
    expect(drawerBounds.width).toBeCloseTo(320, 0);
    expect(Math.abs(drawerBounds.right - bounds.right)).toBeLessThan(1);
    expect(Math.abs(drawerBounds.top - bounds.top)).toBeLessThan(1);
    expect(Math.abs(drawerBounds.bottom - bounds.bottom)).toBeLessThan(1);
    expect(drawerBounds.left).toBeGreaterThan(bounds.left);
    expect(drawer.scrollWidth).toBeLessThanOrEqual(drawer.clientWidth);
    expect(root.querySelectorAll('.fm-toolbar')).toHaveLength(1);
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(drawer.contains(document.activeElement)).toBe(true);
    if (width === 680) await page.screenshot({ path: `__screenshots__/markdown-toc-drawer-${mode}.png` });
    await userEvent.keyboard('{Escape}');
    await assertClosed();
    assertUnchanged();

    drawer = await openContents();
    await userEvent.click(drawer.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!);
    await assertClosed();
    assertUnchanged();

    await openContents();
    await userEvent.click(layout.querySelector<HTMLElement>('[data-floe-dialog-backdrop]')!, { position: { x: 8, y: 100 } });
    await assertClosed(false);
    assertUnchanged();

    drawer = await openContents();
    await userEvent.click(drawer.querySelector<HTMLAnchorElement>('a[href="#section-8"]')!);
    await assertClosed();
    await vi.waitFor(() => expect(body.scrollTop).toBeGreaterThan(before.scrollTop + 100));
    expect(body.clientWidth).toBe(before.width);
    expect(window.scrollY).toBe(0);

    await openContents();
    setPath('/workspace/another.md');
    await assertClosed();
    setContent('A document without headings.');
    await vi.waitFor(() => expect(toggle.disabled).toBe(true));
  } finally {
    dispose();
  }
});
