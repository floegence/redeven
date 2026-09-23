import '../../index.css';
import { page, userEvent } from 'vitest/browser';
import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloeConfigProvider, LayoutProvider, ThemeProvider } from '@floegence/floe-webapp-core';
import { readViewportSnapshot } from '@floegence/floe-webapp-core/viewport';
import { I18nProvider } from '../i18n';
import { EnvAppDrawer } from '../primitives/EnvAppDrawer';
import { FilePreviewSurface } from './FilePreviewSurface';
import { FilePreviewContext } from './FilePreviewContext';
import { createFilePreviewController } from './createFilePreviewController';
import { PreviewWindow } from './PreviewWindow';
import { PersistentFloatingWindow } from './PersistentFloatingWindow';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  vi.unstubAllGlobals();
});

function mount(children: () => JSX.Element, mode: 'light' | 'dark') {
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => {
    const controller = createFilePreviewController({
      client: () => undefined,
      rpc: () => undefined,
      canWrite: () => false,
    });
    return (
      <FloeConfigProvider config={{ storage: { enabled: false }, theme: { defaultTheme: mode } }}>
        <ThemeProvider>
          <LayoutProvider>
            <I18nProvider>
              <FilePreviewContext.Provider
                value={{ controller, openPreview: controller.openPreview, closePreview: controller.closePreview }}
              >
                {children()}
              </FilePreviewContext.Provider>
            </I18nProvider>
          </LayoutProvider>
        </ThemeProvider>
      </FloeConfigProvider>
    );
  }, host);
}

function visibleViewport() {
  const viewport = Object.assign(new EventTarget(), {
    width: 390,
    height: 700,
    offsetTop: 44,
    offsetLeft: 0,
    scale: 1,
  });
  vi.stubGlobal('visualViewport', viewport);
  return {
    viewport,
    change: (height: number, offsetTop: number) => {
      Object.assign(viewport, { height, offsetTop });
      viewport.dispatchEvent(new Event('resize'));
    },
  };
}

async function assertBounds(viewport: { height: number; offsetTop: number }) {
  await vi.waitFor(() => {
    const snapshot = readViewportSnapshot(window);
    expect(snapshot.visible.height).toBe(viewport.height);
    expect(snapshot.visible.top + snapshot.fixedOffset.top).toBe(viewport.offsetTop);
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const rect = panel.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(snapshot.visible.top - 1);
    expect(rect.bottom).toBeLessThanOrEqual(snapshot.visible.bottom + 1);
    expect(rect.left).toBeGreaterThanOrEqual(snapshot.visible.left - 1);
    expect(rect.right).toBeLessThanOrEqual(snapshot.visible.right + 1);
    const close = panel.querySelector<HTMLElement>('button[aria-label="Close"]')!.getBoundingClientRect();
    expect(close.top).toBeGreaterThanOrEqual(rect.top);
    expect(close.bottom).toBeLessThanOrEqual(rect.bottom);
    const footer = panel.querySelector<HTMLElement>('[data-floe-dialog-footer], [data-floe-floating-window-footer]');
    if (footer) {
      const footerRect = footer.getBoundingClientRect();
      expect(footerRect.top).toBeGreaterThanOrEqual(rect.top);
      expect(footerRect.bottom).toBeLessThanOrEqual(rect.bottom);
    }
  });
}

describe('Overlay visible viewport boundaries', () => {
  for (const mode of ['light', 'dark'] as const) {
    it.each(['markdown', 'preview', 'drawer', 'plugin'] as const)(
      'keeps the %s surface reachable in ' + mode,
      async (kind) => {
        await page.viewport(390, 844);
        const { viewport, change } = visibleViewport();
        const [open, setOpen] = createSignal(true);
        const body = () => (
          <>
            <textarea aria-label="Draft" style={{ 'font-size': '16px' }} />
            <div style={{ height: '1800px' }}>Long content</div>
            <p data-last>Last line</p>
          </>
        );
        mount(
          () =>
            kind === 'markdown' ? (
              <FilePreviewSurface
                open={open()}
                onOpenChange={setOpen}
                item={{
                  id: '/workspace/story.md',
                  name: 'A very long Markdown document title.md',
                  path: '/workspace/story.md',
                  type: 'file',
                }}
                descriptor={{ mode: 'markdown' }}
                text={
                  '# Story\n\n' +
                  Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}. Text remains readable.`).join('\n\n') +
                  '\n\nLast line'
                }
              />
            ) : kind === 'drawer' ? (
              <EnvAppDrawer
                open={open()}
                onOpenChange={setOpen}
                title="Service settings"
                footer={<button>Save</button>}
              >
                {body()}
              </EnvAppDrawer>
            ) : kind === 'plugin' ? (
              <PersistentFloatingWindow
                open={open()}
                onOpenChange={setOpen}
                title="Plugin surface"
                compactBelow={768}
                viewportInsets={{ top: 4, right: 4, bottom: 4, left: 4 }}
                surfaceRef={(el) => el?.setAttribute('data-redeven-plugin-activity-window', 'true')}
              >
                {body()}
              </PersistentFloatingWindow>
            ) : (
              <PreviewWindow open={open()} onOpenChange={setOpen} title="Preview" footer={<button>Save</button>}>
                {body()}
              </PreviewWindow>
            ),
          mode,
        );
        await assertBounds(viewport);
        const content = document.querySelector(kind === 'markdown' ? '.file-markdown-body' : 'textarea')!;
        expect(content).toBeTruthy();
        if (kind !== 'markdown') {
          await userEvent.fill(content, 'Retained draft 中文');
          (content as HTMLTextAreaElement).setSelectionRange(2, 4);
        }
        for (let cycle = 0; cycle < 3; cycle++) {
          change(320, 120);
          await assertBounds(viewport);
          expect(document.querySelector(kind === 'markdown' ? '.file-markdown-body' : 'textarea')).toBe(content);
          if (kind !== 'markdown') {
            expect(document.activeElement).toBe(content);
            expect((content as HTMLTextAreaElement).value).toBe('Retained draft 中文');
            expect((content as HTMLTextAreaElement).selectionStart).toBe(2);
          }
          change(700, 44);
          await assertBounds(viewport);
        }
        const scroll = document.querySelector<HTMLElement>(
          kind === 'markdown' ? '.file-markdown-body' : '[data-floe-dialog-body], [data-floe-floating-window-content]',
        )!;
        scroll.scrollTop = scroll.scrollHeight;
        await vi.waitFor(() => {
          expect(scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight).toBeLessThanOrEqual(1);
          const last = page.getByText('Last line', { exact: true }).element().getBoundingClientRect();
          const readingArea = scroll.getBoundingClientRect();
          expect(last.top).toBeGreaterThanOrEqual(readingArea.top - 1);
          expect(last.bottom).toBeLessThanOrEqual(readingArea.bottom + 1);
        });
        expect(document.scrollingElement!.scrollTop).toBe(0);
        expect(document.scrollingElement!.scrollHeight).toBeLessThanOrEqual(document.scrollingElement!.clientHeight + 1);
        await userEvent.click(page.getByRole('button', { name: 'Close', exact: true }));
        expect(open()).toBe(false);
      },
    );
  }
});
