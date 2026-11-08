import '../index.css';
import '../ui/flower-feature.css';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { editor as monaco } from 'monaco-editor/editor';
import { afterEach, expect, it, vi } from 'vitest';
import { TessivenPage } from '../../../../tessiven_ui/src/TessivenPage';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import type { TessivenTransport } from '../../../../tessiven_ui/src/types';

const yaml = `apiVersion: redeven.io/tessiven/v1.1.0
kind: ServiceCanvas
metadata:
  title: Commerce architecture
  description: >-
    A shared view of the storefront, checkout and payment services. ${'Long descriptions should stay readable without horizontal scrolling. '.repeat(6)}
# Runtime nodes host the service instances.
nodes:
  - id: runtime.primary
    name: Primary Runtime
services:
  - id: service.checkout
    name: Checkout
    kind: application
instances:
  - id: checkout.primary
    service: service.checkout
    node: runtime.primary
`;
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks();
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark', 'light');
  delete document.documentElement.dataset.floeShellTheme;
});
async function openDocument(mode: 'light' | 'dark' = 'dark', width = 1200, source = yaml) {
  await page.viewport(width, 850);
  const host = document.createElement('div');
  host.style.cssText = 'width:100%;height:780px'; document.body.append(host);
  const canvas = { id: 'commerce', title: 'Commerce architecture', description: '', latest_version: 9, archived: false, created_at: 1, updated_at: 2 };
  let changed = () => {};
  const request = vi.fn(async (_method: string, path: string) => {
    if (path.endsWith('/flower-threads')) return { threads: [] };
    if (path.startsWith('/canvases?')) return { canvases: [canvas] };
    if (path === '/canvases/commerce') return canvas;
    if (path.includes('/versions/')) return { canvas_id: canvas.id, number: canvas.latest_version, document_yaml: source, document: { apiVersion: 'redeven.io/tessiven/v1.1.0', kind: 'ServiceCanvas', metadata: { title: canvas.title } }, digest: 'fixture', created_at: 1, source: 'flower', summary: 'Architecture' };
    throw new Error(`Unexpected path: ${path}`);
  });
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false }, theme: { defaultTheme: mode, shellPresets: builtInShellThemePresets, defaultShellPreset: { light: 'porcelain-light', dark: 'classic-dark' } } }}>
    <TessivenPage t={tessivenText('en-US')} canWrite transport={{ request, subscribe: notify => { changed = notify; return () => {}; } } as TessivenTransport}
      renderFlower={() => <div />} onOpenService={() => {}} openRequest={{ canvasID: 'commerce', nonce: 1 }} />
  </FloeProvider>, host);
  await page.getByRole('button', { name: 'Canvas actions', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'View document', exact: true }).click();
  await expect.element(page.getByRole('dialog', { name: 'View document', exact: true })).toBeVisible();
  return { request, updateVersion: (text: string, number: number) => { source = text; canvas.latest_version = number; changed(); } };
}

it.each(['light', 'dark'] as const)('renders the saved YAML with syntax colors and line numbers in %s', async mode => {
  await openDocument(mode);
  await expect.poll(() => document.querySelector('.tessiven-document-editor .view-lines'), { timeout: 15000 }).toBeTruthy();
  await expect.poll(() => new Set([...document.querySelectorAll('.tessiven-document-editor .view-line span')].map(node => getComputedStyle(node).color)).size).toBeGreaterThan(2);
  expect([...document.querySelectorAll('.tessiven-document-editor .line-numbers')].some(node => node.textContent === '1')).toBe(true);
  await page.screenshot({ element: document.querySelector('.tessiven-document-dialog')!, path: '__screenshots__/tessiven-document-' + mode + '.png' });
}, 25000);

it('finds document content, dismisses search first, and preserves read-only YAML', async () => {
  const { request } = await openDocument();
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await expect.element(page.getByRole('button', { name: 'Find in document' })).toBeEnabled();
  await page.getByRole('button', { name: 'Wrap lines' }).click();
  const modifier = /Mac/.test(navigator.platform) ? 'Meta' : 'Control';
  await userEvent.keyboard(`{${modifier}>}{f}{/${modifier}}`);
  await expect.poll(() => document.querySelector('.find-widget.visible')).toBeTruthy();
  const input = document.querySelector<HTMLTextAreaElement>('.find-widget textarea[aria-label="Find"]')!;
  await userEvent.fill(input, 'service.checkout');
  await expect.poll(() => document.querySelector('.find-widget .matchesCount')?.textContent).toContain('of 2');
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.find-widget.visible')).toBeNull();
  await expect.element(page.getByRole('dialog', { name: 'View document', exact: true })).toBeVisible();
  const editor = monaco.getEditors().find(editor => editor.getDomNode()?.closest('.tessiven-document-editor'))!;
  expect(editor.getRawOptions().readOnly).toBe(true);
  editor.focus();
  await userEvent.keyboard('Unwanted edit');
  expect(editor.getValue()).toBe(yaml);
  await editor.getAction('editor.foldAll')?.run();
  await expect.poll(() => document.querySelector('.tessiven-document-editor .view-lines')?.textContent).not.toContain('Primary Runtime');
  expect(editor.getValue()).toBe(yaml);
  await editor.getAction('editor.unfoldAll')?.run();
  await expect.poll(() => document.querySelector('.tessiven-document-editor .view-lines')?.textContent?.replaceAll('\u00a0', ' ')).toContain('Primary Runtime');
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  expect(copy).toHaveBeenCalledWith(yaml);
  await expect.element(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(request.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.element(page.getByRole('dialog', { name: 'View document', exact: true })).not.toBeInTheDocument();
});

it('wraps long lines in a narrow window and can restore unwrapped source', async () => {
  await openDocument('light', 390);
  await expect.element(page.getByRole('button', { name: 'Find in document' })).toBeEnabled();
  const wrap = page.getByRole('button', { name: 'Wrap lines', exact: true });
  await expect.element(wrap).toHaveAttribute('aria-pressed', 'true');
  const horizontal = () => document.querySelector<HTMLElement>('.tessiven-document-editor .scrollbar.horizontal')!;
  await expect.poll(() => horizontal().classList.contains('invisible')).toBe(true);
  const bounds = document.querySelector('.tessiven-document-dialog')!.getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(390);
  expect(document.querySelector('.tessiven-document-toolbar')!.scrollWidth).toBeLessThanOrEqual(358);
  await page.screenshot({ element: document.querySelector('.tessiven-document-dialog')!, path: '__screenshots__/tessiven-document-narrow.png' });
  await wrap.click();
  await expect.element(wrap).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => horizontal().classList.contains('invisible')).toBe(false);
  await wrap.click();
  await expect.poll(() => horizontal().classList.contains('invisible')).toBe(true);
});

it('reports clipboard failure and exports the original saved bytes', async () => {
  await openDocument();
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Denied'));
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('Could not copy the document.');
  expect(page.getByRole('button', { name: 'Copied', exact: true }).query()).toBeNull();
  let exported: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { exported = blob as Blob; return 'blob:document-export'; });
  const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  expect(clicked).toHaveBeenCalledOnce();
  expect((clicked.mock.instances[0] as HTMLAnchorElement).download).toBe('commerce-v9.yaml');
  expect(await exported?.text()).toBe(yaml);
});


it('reads a large saved document, follows a newer version, and disposes its model on close', async () => {
  const large = yaml + 'evidence:\n' + Array.from({ length: 700 }, (_, i) => `  - id: evidence.${i}\n    source: code\n    summary: Verified deployment record ${i}\n`).join('');
  expect(large.length).toBeGreaterThan(32768);
  const { updateVersion } = await openDocument('dark', 1200, large);
  await expect.element(page.getByRole('button', { name: 'Find in document' })).toBeEnabled();
  const editor = monaco.getEditors().find(editor => editor.getDomNode()?.closest('.tessiven-document-editor'))!;
  const original = editor.getModel()!;
  expect(original.getValue()).toBe(large);
  await expect.poll(() => new Set([...document.querySelectorAll('.tessiven-document-editor .view-line span')].map(node => getComputedStyle(node).color)).size).toBeGreaterThan(2);
  const copied = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  expect(copied).toHaveBeenLastCalledWith(large);
  updateVersion(yaml.replace('Commerce architecture', 'Revised architecture'), 10);
  await expect.poll(() => editor.getModel()?.uri.path).toContain('commerce-v10.yaml');
  expect(original.isDisposed()).toBe(true);
  const next = editor.getModel()!;
  expect(next.getValue()).toBe(yaml.replace('Commerce architecture', 'Revised architecture'));
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  expect(copied).toHaveBeenLastCalledWith(next.getValue());
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(() => next.isDisposed()).toBe(true);
}, 25000);
