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
