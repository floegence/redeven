import '../../index.css';

import { page, userEvent } from 'vitest/browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { builtInShellThemePresets, FloeConfigProvider, LayoutProvider, ThemeProvider } from '@floegence/floe-webapp-core';
import { removeUIStorageItem, writeUIStorageJSON } from '../services/uiStorage';
import { floatingWindowStorageKey } from './PersistentFloatingWindow';
import { FilePreviewSurface } from './FilePreviewSurface';
import { FilePreviewContext } from './FilePreviewContext';
import { createFilePreviewController } from './createFilePreviewController';

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
  removeUIStorageItem(floatingWindowStorageKey('file-preview'));
});

describe('File preview titlebar', () => {
  it.each(['light', 'dark'] as const)('keeps file actions accessible at narrow widths in %s mode', async (mode) => {
    await page.viewport(1280, 900);
    document.documentElement.classList.add(mode);
    document.documentElement.dataset.floeShellTheme = mode === 'dark' ? 'classic-dark' : 'paper';
    document.documentElement.dataset.floeSurfaceStyle = 'soft-neumorphic';
    writeUIStorageJSON(floatingWindowStorageKey('file-preview'), { x: 40, y: 60, width: 420, height: 600 });
    const onCopyPath = vi.fn(async () => true);
    const onAskFlower = vi.fn();
    const onDownload = vi.fn();
    const [editing, setEditing] = createSignal(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => {
      const controller = createFilePreviewController({ client: () => undefined, rpc: () => undefined, canWrite: () => true });
      return (
        <FloeConfigProvider config={{ theme: {
          storageKey: `preview-test-${mode}`,
          defaultTheme: mode,
          defaultSurfaceStyle: 'soft-neumorphic',
          shellPresets: builtInShellThemePresets,
          defaultShellPreset: { light: 'paper', dark: 'classic-dark' },
        } }}>
          <ThemeProvider>
            <LayoutProvider>
              <FilePreviewContext.Provider value={{ controller, openPreview: controller.openPreview, closePreview: controller.closePreview }}>
                <FilePreviewSurface
                  open
                  onOpenChange={() => undefined}
                  item={{ id: '/workspace/review.md', name: 'protocol-consistency-review-final-20260914.md', path: '/workspace/review.md', type: 'file' }}
                  descriptor={{ mode: 'markdown' }}
                  text={'# Protocol review\n\nSelected preview paragraph.\n\n## Findings\n\nAll checks complete.'}
                  draftText="# Local draft"
                  canEdit
                  editing={editing()}
                  dirty
                  onStartEdit={() => setEditing(true)}
                  onDiscard={() => setEditing(false)}
                  onCopyPath={onCopyPath}
                  onAskFlower={onAskFlower}
                  onDownload={onDownload}
                />
              </FilePreviewContext.Provider>
            </LayoutProvider>
          </ThemeProvider>
        </FloeConfigProvider>
      );
    }, host);
    try {
      await vi.waitFor(() => expect(document.querySelector('.file-markdown-body p')).toBeTruthy());
      const root = document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]')!;
      const titlebar = root.querySelector<HTMLElement>('[data-floe-floating-window-titlebar]')!;
      const actions = titlebar.querySelector<HTMLElement>('[data-floe-floating-window-header-actions]')!;
      expect(actions).toBeTruthy();
      expect(root.querySelector('.redeven-file-preview-toolbar')).toBeNull();
      expect(root.textContent).not.toContain('/workspace/review.md');
      expect(root.querySelectorAll('button[aria-label="Download file"]')).toHaveLength(1);
      const title = titlebar.querySelector('h2')!;
      const controls = titlebar.querySelector<HTMLElement>('[data-floe-floating-window-control="maximize"]')!;
      const assertLayout = () => {
        expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(actions.getBoundingClientRect().left);
        expect(actions.getBoundingClientRect().right).toBeLessThanOrEqual(controls.getBoundingClientRect().left);
        expect(titlebar.getBoundingClientRect().height).toBe(32);
        expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
      };
      assertLayout();
      const body = root.querySelector<HTMLElement>('.redeven-file-preview')!;
      expect(Math.abs(body.getBoundingClientRect().top - titlebar.getBoundingClientRect().bottom)).toBeLessThan(1);
      const originalRect = root.getBoundingClientRect().toJSON();
      await userEvent.click(actions.querySelector<HTMLButtonElement>('button[aria-label="Copy path"]')!);
      expect(onCopyPath).toHaveBeenCalledOnce();
      expect(actions.querySelector('button[aria-label="Path copied"]')).toBeTruthy();
      const paragraph = root.querySelector('.file-markdown-body p')!;
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      await userEvent.click(actions.querySelector<HTMLButtonElement>('button[aria-label="Ask Flower"]')!);
      expect(onAskFlower).toHaveBeenLastCalledWith('Selected preview paragraph.');
      expect(root.getBoundingClientRect().toJSON()).toEqual(originalRect);
      actions.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      expect(root.getBoundingClientRect().toJSON()).toEqual(originalRect);
      await userEvent.click(actions.querySelector<HTMLButtonElement>('button[aria-label="Edit file"]')!);
      expect(actions.querySelector('button[aria-label="Save file"]')).toBeTruthy();
      expect(actions.querySelector('button[aria-label="Discard changes"]')).toBeTruthy();
      assertLayout();
      await userEvent.click(actions.querySelector<HTMLButtonElement>('button[aria-label="Discard changes"]')!);
      await userEvent.click(actions.querySelector<HTMLButtonElement>('button[aria-label="Download file"]')!);
      expect(onDownload).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });
});
