import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { GitTemplateImport } from './GitTemplateImport';
import { template } from './gitTemplateImportFixture';
import { I18nProvider } from '../i18n';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from '../i18n/storageKey';

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../services/localApi', async (original) => ({
  ...(await original<typeof import('../services/localApi')>()),
  fetchLocalApiJSON: api.request,
}));

const preview = {
  candidate_id: 'review-candidate',
  sha256: 'b'.repeat(64),
  expected_sha256: 'c'.repeat(64),
  changed: true,
  template,
  previous_template: { ...template, revision: 0 },
  files: Array.from({ length: 20 }, (_, index) => ({
    path: `scripts/helper-${index}.sh`,
    change: 'modified',
  })),
  affected_service_ids: ['existing-service'],
  source_document_version: 2,
  source_spec_version: 5,
};

describe('GitHub source review in the browser', () => {
  let dispose: (() => void) | undefined;
  beforeEach(() => {
    document.documentElement.classList.add('dark');
    api.request.mockImplementation(async (url: string) =>
      url.endsWith('/file')
        ? {
            path: 'scripts/helper-0.sh',
            before: {
              mode: '100644',
              sha256: 'c'.repeat(64),
              binary: false,
              text: 'echo previous',
            },
            after: {
              mode: '100755',
              sha256: 'b'.repeat(64),
              binary: false,
              text: '#!/bin/sh\nexec "$REDEVEN_TEMPLATE_DIR/scripts/start.sh"',
            },
          }
        : url.endsWith('source-previews')
          ? preview
          : {},
    );
  });
  afterEach(() => {
    dispose?.();
    document.body.replaceChildren();
    document.documentElement.classList.remove('dark');
    delete window.redevenDesktopTemplateSources;
    localStorage.removeItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY);
    api.request.mockReset();
  });
  for (const [width, height, scoped] of [
    [1280, 1000, false],
    [390, 760, false],
    [1280, 900, true],
  ] as const) {
    it(`keeps dialog geometry stable when disclosures toggle at ${width}×${height}, scoped=${scoped}`, async () => {
      await page.viewport(width, height);
      document.documentElement.classList.toggle('dark', width < 500);
      window.redevenDesktopTemplateSources = { acquire: vi.fn(), cancel: vi.fn() };
      const scrollbarStyle = document.createElement('style');
      // Exercise a space-consuming scrollbar even on systems using overlay scrollbars.
      scrollbarStyle.textContent =
        '[data-floe-dialog-panel] > div { scrollbar-width: auto; } [data-floe-dialog-panel] > div::-webkit-scrollbar { width: 14px; }';
      document.body.append(scrollbarStyle);
      const host = document.createElement('div');
      if (scoped) {
        host.setAttribute('data-floe-dialog-surface-host', 'true');
        host.setAttribute('data-floe-surface-portal-layer', 'true');
        host.style.cssText = 'position:absolute;left:140px;top:90px;width:850px;height:460px';
      }
      document.body.append(host);
      dispose = render(
        () => (
          <GitTemplateImport open onClose={() => undefined} onImported={() => undefined} serviceName={(id) => id} />
        ),
        host,
      );
      await expect.element(page.getByRole('dialog')).toBeVisible();
      const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
      await expect
        .element(panel.closest<HTMLElement>('[data-floe-dialog-mode]')!)
        .toHaveAttribute('data-floe-dialog-mode', scoped ? 'surface' : 'global');
      await expect.poll(() => getComputedStyle(panel).opacity).toBe('1');
      await Promise.all(panel.getAnimations().map((animation) => animation.finished));
      const title = panel.querySelector('h2')!;
      const footer = Array.from(panel.querySelectorAll('button')).at(-1)!;
      const link = panel.querySelector<HTMLInputElement>('input[placeholder="https://github.com/owner/repository"]')!;
      const initial = [panel, title, footer].map((element) => element.getBoundingClientRect());
      const initialLink = link.getBoundingClientRect();
      const checkGeometry = () => {
        [panel, title, footer].forEach((element, index) => {
          const actual = element.getBoundingClientRect();
          for (const edge of ['x', 'y', 'width', 'height'] as const) {
            expect(actual[edge], `${element.tagName} ${edge}`).toBeCloseTo(initial[index][edge], 1);
          }
        });
        expect(link.getBoundingClientRect().x).toBeCloseTo(initialLink.x, 1);
        expect(link.getBoundingClientRect().width).toBeCloseTo(initialLink.width, 1);
        expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
      };
      const sourceOptions = panel.querySelector<HTMLDetailsElement>('[data-source-options]')!;
      const privateRepository = panel.querySelector<HTMLDetailsElement>('[data-private-repository]')!;
      for (const details of [sourceOptions, privateRepository]) {
        await userEvent.click(details.querySelector('summary')!);
        expect(details.open).toBe(true);
        checkGeometry();
      }
      const scroller = Array.from(panel.children).find(
        (child) => getComputedStyle(child).overflowY === 'auto',
      ) as HTMLElement;
      expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
      expect(scroller.offsetWidth - scroller.clientWidth).toBeGreaterThan(0);
      const credential = panel.querySelector<HTMLInputElement>('input[type=password]')!;
      await userEvent.fill(credential, 'request-only-token');
      for (const details of [privateRepository, sourceOptions]) {
        await userEvent.click(details.querySelector('summary')!);
        expect(details.open).toBe(false);
        checkGeometry();
      }
      expect(credential.value).toBe('request-only-token');
      const boundary = scoped ? host.getBoundingClientRect() : { top: 0, left: 0, right: width, bottom: height };
      expect(initial[0].top).toBeGreaterThanOrEqual(boundary.top);
      expect(initial[0].left).toBeGreaterThanOrEqual(boundary.left);
      expect(initial[0].right).toBeLessThanOrEqual(boundary.right);
      expect(initial[0].bottom).toBeLessThanOrEqual(boundary.bottom);
      expect(api.request).not.toHaveBeenCalled();
    });
  }
  for (const [locale, width, dark] of [
    ['en-US', 1280, false],
    ['zh-CN', 1280, true],
    ['de-DE', 390, false],
    ['fr-FR', 390, true],
    ['zh-TW', 390, false],
    ['ja-JP', 390, true],
    ['ko-KR', 390, false],
    ['es-ES', 390, true],
    ['pt-BR', 390, false],
    ['ru-RU', 390, true],
  ] as const) {
    it(`supports keyboard selection and progressive options in ${locale} at ${width}px`, async () => {
      await page.viewport(width, 800);
      document.documentElement.classList.toggle('dark', dark);
      localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, locale);
      const acquire = vi.fn().mockImplementation(async ({ action }) =>
        action === 'discover'
          ? {
              ok: true,
              catalog: {
                source: template.git_source,
                templates: [
                  {
                    path: 'templates/analytics',
                    entrypoint: 'redeven-service-template.json',
                  },
                  {
                    path: 'templates/documentation',
                    entrypoint: 'redeven-service-template.json',
                  },
                ],
              },
            }
          : {
              ok: true,
              snapshot: {
                source: template.git_source,
                files: [],
                sha256: 'b'.repeat(64),
              },
            },
      );
      window.redevenDesktopTemplateSources = { acquire, cancel: vi.fn() };
      const host = document.createElement('div');
      document.body.append(host);
      dispose = render(
        () => (
          <I18nProvider>
            <GitTemplateImport
              open
              environmentName="Production · Singapore"
              onClose={() => undefined}
              onImported={() => undefined}
              serviceName={(id) => id}
            />
          </I18nProvider>
        ),
        host,
      );
      await expect.element(page.getByRole('dialog')).toBeVisible();
      const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
      const credential = document.querySelector<HTMLInputElement>('input[type=password]')!;
      await expect.element(credential).not.toBeVisible();
      expect(document.querySelector<HTMLDetailsElement>('[data-source-options]')!.open).toBe(false);
      const local = document.querySelector<HTMLInputElement>('input[value=desktop_transfer]')!;
      await userEvent.click(local.labels![0]);
      await userEvent.keyboard('{ArrowRight}');
      expect(document.querySelector<HTMLInputElement>('input[value=remote_download]')!.checked).toBe(true);
      await userEvent.keyboard('{ArrowLeft}');
      expect(local.checked).toBe(true);
      const link = document.querySelector<HTMLInputElement>(
        'input[placeholder="https://github.com/owner/repository"]',
      )!;
      await userEvent.fill(link, 'https://github.com/owner/repo');
      await userEvent.keyboard('{Enter}');
      await expect.element(page.getByRole('radio', { name: /analytics/ })).toBeVisible();
      expect(acquire).toHaveBeenCalledTimes(1);
      await userEvent.click(page.getByText('documentation', { exact: true }));
      expect(acquire).toHaveBeenCalledTimes(1);
      const footer = Array.from(panel.querySelectorAll('button')).at(-1)!;
      const bounds = footer.getBoundingClientRect();
      expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
      expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
      await userEvent.click(footer);
      await expect.element(page.getByText('Example', { exact: true })).toBeVisible();
      expect(acquire.mock.calls[1][0].source.path).toBe('templates/documentation');
      expect(api.request.mock.calls.some(([url]) => String(url).endsWith('source-confirmations'))).toBe(false);
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
      const confirmButton = Array.from(panel.querySelectorAll('button')).at(-1)!;
      const confirmBounds = confirmButton.getBoundingClientRect();
      const editButton = Array.from(panel.querySelectorAll('button')).at(-3)!;
      const cancelButton = Array.from(panel.querySelectorAll('button')).at(-2)!;
      expect(editButton.getBoundingClientRect().right).toBeLessThanOrEqual(cancelButton.getBoundingClientRect().left);
      expect(confirmBounds.right).toBeLessThanOrEqual(window.innerWidth);
      expect(confirmBounds.left).toBeGreaterThanOrEqual(0);
    });
  }
  for (const [width, height] of [
    [1280, 720],
    [390, 760],
  ]) {
    it(`keeps manual review and confirmation usable at ${width}×${height}`, async () => {
      await page.viewport(width, height);
      const host = document.createElement('div');
      document.body.append(host);
      dispose = render(
        () => (
          <GitTemplateImport
            open
            template={template}
            onClose={() => undefined}
            onImported={() => undefined}
            serviceName={() => 'Existing service'}
          />
        ),
        host,
      );
      await expect.element(page.getByRole('dialog')).toBeVisible();
      await userEvent.click(page.getByText('Private repository', { exact: true }));
      const credential = document.querySelector<HTMLInputElement>('input[type=password]')!;
      expect(credential.labels?.[0]?.textContent).toContain('token');
      expect(credential.autocomplete).toBe('off');
      await userEvent.click(page.getByRole('button', { name: 'Check updates', exact: true }));
      await expect.element(page.getByText('Existing service', { exact: true })).toBeVisible();
      expect(api.request.mock.calls.some(([url]) => String(url).endsWith('source-confirmations'))).toBe(false);
      await userEvent.click(page.getByText('Changed files (20)', { exact: true }));
      await userEvent.click(
        page.getByRole('button', {
          name: 'Modified scripts/helper-0.sh',
          exact: true,
        }),
      );
      await expect.element(page.getByText('echo previous', { exact: true })).toBeVisible();
      expect(document.body.textContent).toContain('REDEVEN_TEMPLATE_DIR');
      const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
      const button = Array.from(panel.querySelectorAll('button')).find(
        (item) => item.textContent?.trim() === 'Update template',
      )!;
      const bounds = button.getBoundingClientRect();
      expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
      await userEvent.click(button);
      expect(api.request.mock.calls.filter(([url]) => String(url).endsWith('source-confirmations'))).toHaveLength(1);
    });
  }
});
