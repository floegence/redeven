import '../../index.css';
import { builtInShellThemePresets, FloeConfigProvider, LayoutProvider, ThemeProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { FilePreviewContext } from './FilePreviewContext';
import { FilePreviewHost } from './FilePreviewHost';
import { createFilePreviewWorkspace, type FilePreviewWorkspace } from './createFilePreviewWorkspace';
const transport = vi.hoisted(() => ({ read: vi.fn(), enqueue: vi.fn(), copy: vi.fn() }));
vi.mock('../utils/fileStreamReader', () => ({ openReadFileStreamChannel: (...args: unknown[]) => transport.read(...args) }));
vi.mock('../utils/clipboard', () => ({ writeTextToClipboard: (...args: unknown[]) => transport.copy(...args) }));
vi.mock('../pages/EnvContext', () => ({ useEnvContext: () => ({ openFlowerTurnLauncher: vi.fn(), openFileBrowserAtPath: vi.fn() }) }));
vi.mock('../downloads/DownloadContext', () => ({ useDownloadManager: () => ({ enqueue: transport.enqueue }) }));
vi.mock('@floegence/floe-webapp-core', async original => ({ ...await original<typeof import('@floegence/floe-webapp-core')>(), useNotification: () => ({ error: vi.fn() }) }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); window.localStorage.clear(); vi.clearAllMocks(); });
const file = (name: string, directory = '/workspace') => ({ id: directory + '/' + name, path: directory + '/' + name, name, type: 'file' as const });
function mount(mode: 'light' | 'dark' = 'light') {
  let workspace!: FilePreviewWorkspace;
  transport.read.mockImplementation(async ({ path }: { path: string }) => {
    const bytes = new TextEncoder().encode(path.endsWith('.csv') ? 'Name,Status\nPreview,Ready\nReport,Reviewed' : path.endsWith('.html') ? '<h1>Persistent document</h1><input aria-label="Frame draft" />' : '# ' + path + '\n\nOriginal content');
    return { meta: { content_len: bytes.length }, channel: { reader: { readExactly: async () => bytes }, close: vi.fn(), stream: { reset: vi.fn() } } };
  });
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => {
    workspace = createFilePreviewWorkspace({ client: () => ({} as never), rpc: () => null, canWrite: () => true });
    return <FloeConfigProvider config={{ theme: { storageKey: 'preview-tabs-test', defaultTheme: mode, defaultSurfaceStyle: 'soft-neumorphic', shellPresets: builtInShellThemePresets, defaultShellPreset: { light: 'porcelain-light', dark: 'classic-dark' } } }}><ThemeProvider><LayoutProvider>
      <FilePreviewContext.Provider value={{ workspace, get controller() { return workspace.activeController(); }, openPreview: workspace.openPreview, closePreview: workspace.requestClose }}><FilePreviewHost /></FilePreviewContext.Provider>
    </LayoutProvider></ThemeProvider></FloeConfigProvider>;
  }, host);
  return workspace;
}
it.each(['light', 'dark'] as const)('keeps actual preview nodes, independent drafts and actions in %s', async mode => {
  await page.viewport(1280, 900); const workspace = mount(mode);
  await workspace.openPreview(file('report.md'));
  await expect.poll(() => document.querySelector('.file-markdown-body')).toBeTruthy();
  expect(document.querySelector('[role="tablist"]')).toBeNull();
  const firstPanel = document.querySelector('[data-preview-document]')!;
  const markdown = firstPanel.querySelector('.file-markdown-body');
  await workspace.openPreview(file('report.md', '/other'));
  await expect.poll(() => document.querySelectorAll('[role="tab"]').length).toBe(2);
  const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
  expect(tabs.map(tab => tab.title)).toEqual(['/workspace/report.md', '/other/report.md']);
  await userEvent.click(tabs[0]);
  await expect.poll(() => workspace.activeId()).toBe('/workspace/report.md');
  expect(firstPanel.querySelector('.file-markdown-body')).toBe(markdown);
  const first = workspace.activeController(); first.beginEditing(); first.updateDraft('Retained unsaved A');
  await userEvent.click(tabs[1]); await expect.poll(() => workspace.activeId()).toBe('/other/report.md'); workspace.activeController().beginEditing(); workspace.activeController().updateDraft('Retained unsaved B');
  expect(first.draftText()).toBe('Retained unsaved A');
  expect(first.closeConfirmOpen()).toBe(false);
  await workspace.openPreview(file('report.md'));
  expect(transport.read).toHaveBeenCalledTimes(2);
  const titlebar = document.querySelector('[data-floe-floating-window-titlebar]')!;
  expect(titlebar.querySelectorAll('[role="tab"]')).toHaveLength(2);
  expect(document.querySelectorAll('[data-floe-geometry-surface="floating-window"]')).toHaveLength(1);
  await userEvent.click(document.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="close"]')!);
  await expect.element(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  expect(workspace.pendingDirty()).toHaveLength(2);
  await userEvent.click(page.getByRole('button', { name: 'Cancel', exact: true }));
  expect(workspace.open()).toBe(true);
  workspace.requestClose('/workspace/report.md'); workspace.confirmClose();
  await expect.poll(() => document.querySelector('[role="tablist"]')).toBeNull();
  expect(workspace.activeController().draftText()).toBe('Retained unsaved B');
  workspace.requestClose(); workspace.confirmClose(); await expect.poll(() => document.querySelector('[data-floe-geometry-surface="floating-window"]')).toBeNull();
});
it('retains HTML iframe state through switching, close cancellation and rapid reopen', async () => {
  await page.viewport(1280, 900); const workspace = mount();
  await workspace.openPreview(file('page.html')); await expect.poll(() => document.querySelector('iframe.html-preview-frame')).toBeTruthy();
  const frame = document.querySelector<HTMLIFrameElement>('iframe.html-preview-frame')!;
  await new Promise(resolve => setTimeout(resolve, 200));
  const loaded = vi.fn(); frame.addEventListener('load', loaded);
  await workspace.openPreview(file('notes.md'));
  workspace.reorder(['/workspace/notes.md', '/workspace/page.html']); workspace.select('/workspace/page.html');
  expect(document.querySelector('iframe.html-preview-frame')).toBe(frame); expect(transport.read).toHaveBeenCalledTimes(2);
  await new Promise(resolve => setTimeout(resolve, 150)); expect(loaded).not.toHaveBeenCalled();
  await page.screenshot({ element: document.querySelector('[data-floe-floating-window-surface]')!, path: '__screenshots__/file-preview-tabs-porcelain.png' });
  workspace.requestClose(); await workspace.openPreview(file('fresh.md'));
  await expect.poll(() => workspace.entries().length).toBe(1); expect(workspace.activeId()).toBe('/workspace/fresh.md'); expect(workspace.open()).toBe(true);
});
it('keeps mobile tabs in the dialog header and returns to the single-file layout', async () => {
  await page.viewport(390, 844); const workspace = mount();
  await workspace.openPreview(file('one.md')); await workspace.openPreview(file('two.md'));
  await expect.poll(() => document.querySelectorAll('[role="tab"]').length).toBe(2);
  const tab = document.querySelector<HTMLElement>('[role="tab"]')!; await userEvent.click(tab);
  await expect.poll(() => workspace.activeId()).toBe('/workspace/one.md');
  await page.screenshot({ element: document.querySelector('[role="dialog"]')!, path: '__screenshots__/file-preview-tabs-mobile.png' });
  await userEvent.click(page.getByRole('button', { name: 'Close one.md', exact: true })); await expect.poll(() => document.querySelector('[role="tablist"]')).toBeNull();
  expect(workspace.activeId()).toBe('/workspace/two.md');
});

it('keeps active actions tied to their document and recovers one failed tab without reloading another', async () => {
  await page.viewport(1280, 900); const workspace = mount();
  await workspace.openPreview(file('one.md'));
  const first = workspace.activeController();
  transport.read.mockRejectedValueOnce(new Error('Read unavailable'));
  await workspace.openPreview(file('two.md'));
  await expect.element(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await userEvent.click(page.getByRole('button', { name: 'Retry', exact: true }));
  await expect.poll(() => workspace.activeController().error()).toBeNull();
  const two = document.querySelector('[data-preview-document="/workspace/two.md"]');
  expect(two?.querySelector('.file-markdown-body')).toBeTruthy();
  await userEvent.click(page.getByRole('button', { name: 'More file actions', exact: true }));
  await userEvent.click(page.getByRole('menuitem', { name: 'Copy path', exact: true }));
  expect(transport.copy).toHaveBeenLastCalledWith('/workspace/two.md');
  await userEvent.click(page.getByRole('tab', { name: 'one.md' }));
  await expect.poll(() => workspace.activeController()).toBe(first);
  await userEvent.click(page.getByRole('button', { name: 'More file actions', exact: true }));
  await userEvent.click(page.getByRole('menuitem', { name: 'Copy path', exact: true }));
  expect(transport.copy).toHaveBeenLastCalledWith('/workspace/one.md');
  expect(transport.read).toHaveBeenCalledTimes(3);
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const panel = document.getElementById(tab.getAttribute('aria-controls')!);
    expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
    expect(panel?.hasAttribute('inert')).toBe(tab.getAttribute('aria-selected') !== 'true');
  }
});

it.each([390, 640, 1280])('keeps long-name tabs and controls usable at %ipx', async width => {
  await page.viewport(width, 900); const workspace = mount();
  for (let index = 0; index < 9; index++) await workspace.openPreview(file('quarterly-report-with-a-long-document-name-' + index + '.md'));
  const rail = document.querySelector<HTMLElement>('[role="tablist"]')!;
  const tabs = [...rail.querySelectorAll<HTMLElement>('[role="tab"]')];
  await expect.poll(() => rail.scrollWidth > rail.clientWidth).toBe(true);
  tabs[0].focus(); await userEvent.keyboard('{End}');
  await expect.poll(() => workspace.activeId()).toBe('/workspace/quarterly-report-with-a-long-document-name-8.md');
  expect(document.activeElement).toBe(tabs[8]);
  await expect.poll(() => tabs[8].getBoundingClientRect().right <= rail.getBoundingClientRect().right + 1).toBe(true);
  const close = document.querySelector<HTMLElement>('[data-floe-floating-window-control="close"]') ?? [...document.querySelectorAll<HTMLElement>('button')].find(button => button.getAttribute('aria-label') === 'Close')!;
  const closeBounds = close.getBoundingClientRect();
  expect(closeBounds.right).toBeLessThanOrEqual(width + 1); expect(closeBounds.width).toBeGreaterThan(20);
  expect(rail.getBoundingClientRect().right).toBeLessThan(closeBounds.left);
  const screenshotElement = document.querySelector<HTMLElement>('[data-floe-floating-window-surface]') ?? document.querySelector<HTMLElement>('[role="dialog"]')!;
  await page.screenshot({ element: screenshotElement, path: '__screenshots__/file-preview-tabs-overflow-' + width + '.png' });
  await userEvent.keyboard('{Delete}');
  await expect.poll(() => workspace.entries().length).toBe(8);
  expect(workspace.activeId()).toBe('/workspace/quarterly-report-with-a-long-document-name-7.md');
});
it('preserves the CSV source mode when switching to another file and back', async () => {
  await page.viewport(1280, 900); const workspace = mount();
  await workspace.openPreview(file('report.csv'));
  await expect.element(page.getByRole('button', { name: 'Source', exact: true })).toBeVisible();
  await userEvent.click(page.getByRole('button', { name: 'Source', exact: true }));
  const preview = document.querySelector('[data-spreadsheet-format="csv"]');
  await workspace.openPreview(file('notes.md')); workspace.select('/workspace/report.csv');
  expect(document.querySelector('[data-spreadsheet-format="csv"]')).toBe(preview);
  await expect.element(page.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(transport.read).toHaveBeenCalledTimes(2);
});

it('reorders tabs without losing drafts and keeps only Flower and More beside window controls', async () => {
  await page.viewport(1280, 900); const workspace = mount();
  for (const name of ['first.md', 'second.md', 'third.md']) await workspace.openPreview(file(name));
  workspace.select('/workspace/first.md');
  const first = workspace.active()!; first.controller.beginEditing(); first.controller.updateDraft('Retained while sorting');
  const panel = document.querySelector('[data-preview-document="/workspace/first.md"]');
  const tab = document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
  expect(getComputedStyle(tab).userSelect).toBe('none');
  tab.focus(); await userEvent.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
  expect(workspace.entries().map(entry => entry.id)).toEqual(['/workspace/second.md', '/workspace/first.md', '/workspace/third.md']);
  expect(workspace.active()).toBe(first);
  expect(document.querySelector('[data-preview-document="/workspace/first.md"]')).toBe(panel);
  expect(first.controller.draftText()).toBe('Retained while sorting');
  const header = document.querySelector('[data-floe-floating-window-titlebar]')!;
  expect(header.querySelector('[aria-label="Copy path"]')).toBeNull();
  expect(header.querySelector('[aria-label="Download file"]')).toBeNull();
  await expect.element(page.getByRole('button', { name: 'Ask Flower', exact: true })).toBeVisible();
  await userEvent.click(page.getByRole('button', { name: 'More file actions', exact: true }));
  await expect.element(page.getByRole('menuitem', { name: 'Save file', exact: true })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  expect(workspace.open()).toBe(true);
  await page.screenshot({ element: document.querySelector<HTMLElement>('[data-floe-floating-window-surface]')!, path: '__screenshots__/preview-header-polish.png' });
});
