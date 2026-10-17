import '../../index.css';
import { page, userEvent } from 'vitest/browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FloeConfigProvider,
  LayoutProvider,
  ThemeProvider,
} from '@floegence/floe-webapp-core';
import { I18nProvider } from '../i18n';
import { PptxPreviewPane } from './PptxPreviewPane';
import fixtureURL from './__fixtures__/preview-pages.pptx?url';

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
});
async function mount(projection: number) {
  const host = document.createElement('div');
  Object.assign(host.style, {
    width: '900px',
    height: '620px',
    transform: 'scale(' + projection + ')',
    transformOrigin: 'top left',
  });
  document.body.append(host);
  const [bytes, setBytes] = createSignal(
    new Uint8Array(await (await fetch(fixtureURL)).arrayBuffer())
  );
  disposers.push(
    render(
      () => (
        <FloeConfigProvider config={{ storage: { enabled: false } }}>
          <ThemeProvider>
            <LayoutProvider>
              <I18nProvider>
                <PptxPreviewPane bytes={bytes()} />
              </I18nProvider>
            </LayoutProvider>
          </ThemeProvider>
        </FloeConfigProvider>
      ),
      host
    )
  );
  await vi.waitFor(() =>
    expect(host.textContent).toContain('Presentation page 1 中文预览')
  );
  return {
    host,
    setBytes,
    viewport: host.querySelector<HTMLElement>('.pptx-preview-pane')!,
  };
}
describe('real PPTX reading surface', () => {
  it.each([0.65, 1, 1.5])(
    'fits and keeps text owners across zoom under a %s projection',
    async (projection) => {
      await page.viewport(1600, 1100);
      const { host, viewport } = await mount(projection);
      const frame = host.querySelector<HTMLElement>(
        '.pptx-preview-pane__page-frame'
      )!;
      const view = viewport.getBoundingClientRect();
      const rect = frame.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(view.left - 1);
      expect(rect.right).toBeLessThanOrEqual(view.right + 1);
      expect(rect.top).toBeGreaterThanOrEqual(view.top - 1);
      expect(rect.bottom).toBeLessThanOrEqual(view.bottom + 1);
      const text = [...frame.querySelectorAll('span')].find(
        (element) => element.textContent === 'Presentation page 1 中文预览'
      )!;
      expect(text).toBeTruthy();
      const range = document.createRange();
      range.selectNodeContents(text);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      expect(getSelection()!.toString()).toContain('中文预览');
      expect(
        host.querySelectorAll('.pptx-preview-pane__page').length
      ).toBeLessThan(8);
      expect(host.querySelectorAll('a[href]').length).toBe(0);
      expect(host.textContent).toContain(
        'External links and resources are disabled'
      );
      await userEvent.click(
        host.querySelector<HTMLButtonElement>(
          'button[aria-label="Zoom in PPTX preview"]'
        )!
      );
      await vi.waitFor(() =>
        expect(frame.getBoundingClientRect().width).toBeGreaterThan(rect.width)
      );
      expect(text.isConnected).toBe(true);
      const trigger = host.querySelector<HTMLElement>(
        '[data-floe-dropdown-trigger]'
      )!;
      await userEvent.click(trigger);
      await userEvent.click(
        page.getByRole('menuitem', { name: 'Actual size', exact: true })
      );
      await vi.waitFor(() =>
        expect(trigger.getAttribute('aria-label')).toContain('100%')
      );
      host.style.width = '300px';
      host.style.height = '260px';
      await vi.waitFor(() =>
        expect(viewport.clientWidth).toBeLessThanOrEqual(300)
      );
      const controls = host
        .querySelector<HTMLElement>('.preview-zoom-controls')!
        .getBoundingClientRect();
      expect(controls.right).toBeLessThanOrEqual(
        host.getBoundingClientRect().right + 1
      );
      viewport.scrollTop = viewport.scrollHeight;
      viewport.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() =>
        expect(host.textContent).toContain('Presentation page 30 中文预览')
      );
      expect(host.querySelector('[data-page-number="1"]')).toBeNull();
    }
  );
  it('replaces failed source bytes and recovers without reloading the surface', async () => {
    const { host, setBytes } = await mount(1);
    setBytes(new Uint8Array([0, 1, 2]));
    await vi.waitFor(() =>
      expect(host.querySelector('.pptx-preview-pane__page')).toBeNull()
    );
    await vi.waitFor(() =>
      expect(
        host.querySelector('[data-testid="file-preview-recovery"]')
      ).not.toBeNull()
    );
    setBytes(new Uint8Array(await (await fetch(fixtureURL)).arrayBuffer()));
    await vi.waitFor(() =>
      expect(host.textContent).toContain('Presentation page 1 中文预览')
    );
  });
});
