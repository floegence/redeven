import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { GitTemplateImport } from './GitTemplateImport';
import { template } from './gitTemplateImportFixture';

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
  files: Array.from({ length: 20 }, (_, index) => ({ path: `scripts/helper-${index}.sh`, change: 'modified' })),
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
            before: { mode: '100644', sha256: 'c'.repeat(64), binary: false, text: 'echo previous' },
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
    api.request.mockReset();
  });
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
      const credential = document.querySelector<HTMLInputElement>('input[type=password]')!;
      expect(credential.labels?.[0]?.textContent).toContain('token');
      expect(credential.autocomplete).toBe('off');
      await userEvent.click(page.getByRole('button', { name: 'Check template updates', exact: true }));
      await expect.element(page.getByText('Existing service', { exact: true })).toBeVisible();
      expect(api.request.mock.calls.some(([url]) => String(url).endsWith('source-confirmations'))).toBe(false);
      await userEvent.click(page.getByText('Changed files (20)', { exact: true }));
      await userEvent.click(page.getByRole('button', { name: 'Modified scripts/helper-0.sh', exact: true }));
      await expect.element(page.getByText('echo previous', { exact: true })).toBeVisible();
      expect(document.body.textContent).toContain('REDEVEN_TEMPLATE_DIR');
      const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
      const button = Array.from(panel.querySelectorAll('button')).find(
        (item) => item.textContent === 'Confirm template update',
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
