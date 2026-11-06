import '../index.css';
import './flower-feature.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { FlowerAttachmentPreviewWindow, type FlowerAttachmentPreviewSource } from '../../../../flower_ui/src/attachments/FlowerAttachmentPreviewWindow';
import { taskFilesEnUS } from '../../../../flower_ui/src/taskFilesCopy';
import { FlowerTaskFilePreviewContent } from './flower/FlowerTaskFilePreviewContent';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks(); });
it('retains attachment content across tabs, deduplicates files and returns to a single title', async () => {
  await page.viewport(1280, 900);
  const loadA = vi.fn(async () => new Blob(['Attachment A'], { type: 'text/plain' }));
  const loadB = vi.fn(async () => new Blob(['Attachment B'], { type: 'text/plain' }));
  const a = { id: 'a', name: 'notes.txt', mimeType: 'text/plain', load: loadA };
  const b = { id: 'b', name: 'other.txt', mimeType: 'text/plain', load: loadB };
  const [source, setSource] = createSignal<FlowerAttachmentPreviewSource | null>(a);
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FlowerAttachmentPreviewWindow source={source()} copy={taskFilesEnUS} loadingLabel="Loading" unavailableLabel="Unavailable" onClose={() => setSource(null)} />, host);
  await expect.poll(() => document.querySelector('.flower-attachment-preview-text')?.textContent).toBe('Attachment A');
  const original = document.querySelector('.flower-attachment-preview-text');
  expect(document.querySelector('[role="tablist"]')).toBeNull();
  setSource(b); await expect.poll(() => document.querySelectorAll('[role="tab"]').length).toBe(2);
  await userEvent.click(page.getByRole('tab', { name: 'notes.txt' }));
  expect(document.querySelector('[data-attachment-preview-document="a"] .flower-attachment-preview-text')).toBe(original);
  const activeTab = document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!; activeTab.focus();
  await userEvent.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
  expect(document.querySelector('[role="tab"]')?.textContent).toContain('other.txt');
  expect(document.querySelector('[data-attachment-preview-document="a"] .flower-attachment-preview-text')).toBe(original);
  setSource({ ...a }); expect(loadA).toHaveBeenCalledTimes(1); expect(loadB).toHaveBeenCalledTimes(1);
  await userEvent.click(page.getByRole('button', { name: 'Close other.txt', exact: true }));
  await expect.poll(() => document.querySelector('[role="tablist"]')).toBeNull();
  expect(document.querySelector('.flower-attachment-preview-text')).toBe(original);
  await userEvent.click(document.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="close"]')!);
  await expect.poll(() => document.querySelector('.flower-attachment-preview-window')).toBeNull();
  setSource(b); await expect.poll(() => document.querySelector('.flower-attachment-preview-text')?.textContent).toBe('Attachment B');
  expect(document.querySelector('[role="tablist"]')).toBeNull(); expect(loadB).toHaveBeenCalledTimes(2);
});
it('aborts retired attachment loads and ignores late content after rapid reopen', async () => {
  await page.viewport(390, 844);
  let oldSignal!: AbortSignal; let finish!: (value: Blob) => void;
  const [source, setSource] = createSignal<FlowerAttachmentPreviewSource | null>({ id: 'slow', name: 'slow.txt', mimeType: 'text/plain', load: signal => { oldSignal = signal; return new Promise(resolve => { finish = resolve; }); } });
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FlowerAttachmentPreviewWindow source={source()} copy={taskFilesEnUS} loadingLabel="Loading" unavailableLabel="Unavailable" onClose={() => setSource(null)} />, host);
  await expect.poll(() => oldSignal).toBeTruthy(); setSource(null); expect(oldSignal.aborted).toBe(true);
  setSource({ id: 'fresh', name: 'fresh.txt', mimeType: 'text/plain', load: async () => new Blob(['Fresh'], { type: 'text/plain' }) });
  finish(new Blob(['Obsolete'], { type: 'text/plain' }));
  await expect.poll(() => document.querySelector('.flower-attachment-preview-text')?.textContent).toBe('Fresh');
  expect(document.body.textContent).not.toContain('Obsolete'); expect(document.querySelector('[role="tablist"]')).toBeNull();
});

it('keeps an attachment failure local, retries it, and revokes each image URL on retirement', async () => {
  await page.viewport(1280, 900);
  const createURL = vi.spyOn(URL, 'createObjectURL');
  const revokeURL = vi.spyOn(URL, 'revokeObjectURL');
  const loadFailed = vi.fn().mockRejectedValueOnce(new Error('Attachment temporarily unavailable'))
    .mockResolvedValue(new Blob(['Recovered attachment'], { type: 'text/plain' }));
  const [source, setSource] = createSignal<FlowerAttachmentPreviewSource | null>({
    id: 'image', name: 'picture.svg', mimeType: 'image/svg+xml',
    load: async () => new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="green"/></svg>'], { type: 'image/svg+xml' }),
  });
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FlowerAttachmentPreviewWindow source={source()} copy={taskFilesEnUS} loadingLabel="Loading" unavailableLabel="Unavailable" onClose={() => setSource(null)} />, host);
  await expect.poll(() => document.querySelector('.flower-attachment-preview-image')).toBeTruthy();
  const image = document.querySelector('.flower-attachment-preview-image');
  const url = createURL.mock.results[0].value;
  setSource({ id: 'failed', name: 'failed.txt', mimeType: 'text/plain', load: loadFailed });
  await expect.element(page.getByRole('alert')).toHaveTextContent('Attachment temporarily unavailable');
  await userEvent.click(page.getByRole('button', { name: taskFilesEnUS.retry, exact: true }));
  await expect.poll(() => document.querySelector('.flower-attachment-preview-text')?.textContent).toBe('Recovered attachment');
  expect(loadFailed).toHaveBeenCalledTimes(2); expect(revokeURL).not.toHaveBeenCalled();
  await userEvent.click(page.getByRole('tab', { name: 'picture.svg' }));
  expect(document.querySelector('.flower-attachment-preview-image')).toBe(image);
  await userEvent.click(page.getByRole('button', { name: 'Close picture.svg', exact: true }));
  await expect.poll(() => revokeURL.mock.calls.some(([value]) => value === url)).toBe(true);
  expect(document.querySelector('.flower-attachment-preview-text')?.textContent).toBe('Recovered attachment');
});

it('keeps HTML attachment paint and state continuous through real tab switches', async () => {
  await page.viewport(1280, 900);
  const load = vi.fn(async () => new Blob(['<style>html,body{margin:0;background:#0a1018;color:#eee}main{height:2400px;padding:24px}</style><main><input aria-label="Frame draft"></main><script>window.previewBoots=(window.previewBoots||0)+1</script>'], { type: 'text/html' }));
  const [source, setSource] = createSignal<FlowerAttachmentPreviewSource | null>({ id: 'a', name: 'one.html', mimeType: 'text/html', load });
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FlowerAttachmentPreviewWindow source={source()} copy={taskFilesEnUS} loadingLabel="Loading" unavailableLabel="Unavailable" onClose={() => setSource(null)} />, host);
  await expect.poll(() => document.querySelector('[data-floe-html-state="ready"]')).toBeTruthy();
  setSource({ id: 'b', name: 'two.html', mimeType: 'text/html', load });
  await expect.poll(() => document.querySelectorAll('[data-floe-html-state="ready"]').length).toBe(2);
  const result = await (commands as unknown as { inspectPreviewDocumentContinuity(selector: string, names: string[]): Promise<{ whiteSamples: number }> }).inspectPreviewDocumentContinuity('[data-attachment-preview-document]', ['one.html', 'two.html']);
  expect(result.whiteSamples).toBe(0); expect(load).toHaveBeenCalledTimes(2);
  await userEvent.click(page.getByRole('button', { name: 'Close two.html', exact: true }));
  await expect.poll(() => document.querySelectorAll('iframe').length).toBe(1);
});

it.each([
  { name: 'report.XHTML', mime: 'application/octet-stream' },
  { name: 'report', mime: 'application/xhtml+xml; charset=utf-8' },
  { name: 'report', mime: 'text/html; charset=utf-8' },
])('renders an HTML snapshot through the Env adapter for $name and $mime', async ({ name, mime }) => {
  await page.viewport(1280, 900);
  const source = { id: 'html', name, mimeType: mime, load: async () => new Blob(['<h1>Snapshot report</h1>'], { type: mime }) };
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FlowerAttachmentPreviewWindow source={source} renderContent={FlowerTaskFilePreviewContent} copy={taskFilesEnUS} loadingLabel="Loading" unavailableLabel="Unavailable" onClose={() => undefined} />, host);
  await expect.poll(() => document.querySelector('[data-floe-html-state="ready"]')).toBeTruthy();
  expect(document.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
});

it('rejects oversized HTML snapshots before mounting a sandbox document', async () => {
  await page.viewport(1280, 900);
  const source = { id: 'large', name: 'large.XHTML', mimeType: 'application/octet-stream', load: async () => new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]) };
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FlowerAttachmentPreviewWindow source={source} copy={taskFilesEnUS} loadingLabel="Loading" unavailableLabel="Unavailable" onClose={() => undefined} />, host);
  await expect.element(page.getByRole('alert')).toHaveTextContent('Unavailable');
  expect(document.querySelector('iframe')).toBeNull();
});
