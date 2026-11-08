import '../../index.css';
import { onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, commands, userEvent } from 'vitest/browser';
import { FloeConfigProvider } from '@floegence/floe-webapp-core';
import { createFlowerComposerDraftCoordinator, type FlowerConversationParts, type FlowerEmbeddedConversation } from '../../../../../flower_ui/src';
import { readUIStorageItem, removeUIStorageItem } from '../services/uiStorage';
import { bindSessionHTTP } from '../services/sessionHTTP';
import { I18nProvider } from '../i18n';
import { writeStoredLanguagePreference } from '../i18n/storage';
import { PluginCreationWorkspace } from './PluginCreationWorkspace';
import { loadPluginComment, savePluginComment, removePluginComposer } from './pluginComposerPersistence';
import { buildDesktopWindowChromeStyleText } from '../../../../../../desktop/src/shared/windowChromeContract';
import { resolveDesktopWindowChromeSnapshot } from '../../../../../../desktop/src/shared/windowChromePlatform';

type PreviewProps = { registerClose: (close: (() => Promise<boolean>) | null) => void; onContextMenu: (event: { sequence: number; frameGenerationId: string; surfaceHandle: string; isCurrent: () => boolean; point: { x: number; y: number }; viewport: { width: number; height: number }; target: { tag: string; role: string; text: string; selector: string; bounds: { x: number; y: number; width: number; height: number } } }) => void };
const surface = { props: undefined as PreviewProps | undefined, opens: 0, closes: 0, current: true };
vi.mock('./PluginAuthorPreview', () => ({ PluginAuthorPreview: (props: PreviewProps) => {
  surface.props = props;
  onMount(() => { surface.opens++; props.registerClose(async () => true); });
  onCleanup(() => { surface.closes++; props.registerClose(null); });
  return <iframe title="Preview fixture" style={{ width: '100%', height: '100%', border: 0 }} />;
} }));
let dispose: (() => void) | undefined;
let release: (() => void) | undefined;
const id = 'canvas-comment-fixture';
afterEach(async () => { dispose?.(); release?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); writeStoredLanguagePreference('en-US'); await removePluginComposer(id); surface.opens = 0; surface.closes = 0; surface.current = true; removeUIStorageItem('redeven.plugin-creation.conversation-width.v1'); await page.viewport(1280, 800); });
function mount(title = 'Focus Timer', pendingUpdate = false) {
  let embedded!: FlowerEmbeddedConversation;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/status')) return Response.json({ data: {
      artifacts: [...(pendingUpdate ? [{ artifact_id: 'artifact-2', version: '0.1.1', stages: [] }] : []), { artifact_id: 'artifact-1', version: '0.1.0', stages: [] }],
      preview: { artifact_id: 'artifact-1', plugin_instance_id: 'preview-1', generation: 1 },
    } });
    if (String(input).endsWith('/catalog/query')) return Response.json({ ok: true, data: { plugins: [{
      plugin_id: 'dev.example.focus', plugin_instance_id: 'preview-1', management_revision: 4,
      manifest: { plugin: { display_name: 'Focus Timer' }, surfaces: [{ kind: 'view', surface_id: 'focus.view' }] },
    }] } });
    return Response.json({ data: { id, title, lifecycle: 'active', revision: 3, workspace_id: 'author-1', thread_id: 'thread-1' } });
  });
  vi.stubGlobal('fetch', fetch); release = bindSessionHTTP({ fetch, events: async function* () {} });
  const host = document.createElement('div'); host.style.cssText = 'height:800px;width:100%'; document.body.append(host);
  const submit = vi.fn<NonNullable<FlowerConversationParts['submitMessage']>>(async () => true);
  dispose = render(() => <FloeConfigProvider><I18nProvider><PluginCreationWorkspace
    draftCoordinator={createFlowerComposerDraftCoordinator()} draftID={id} visible canManage
    onBack={vi.fn()} onSaved={vi.fn()} onInstalled={vi.fn()}
    renderFlower={options => { embedded = options.embeddedConversation; return embedded.render({ conversation: <div>Conversation</div>, composer: <textarea aria-label="Ordinary draft" />,
      submit: vi.fn(), canSubmit: () => true, submitMessage: submit, canSubmitMessage: () => true,
      threadID: () => 'thread-1', actionLayout: () => 'chat', actions: () => [], actionOverlays: null,
    }); }} /></I18nProvider></FloeConfigProvider>, host);
  return { host, submit, fetch, embedded: () => embedded };
}
function select(host: HTMLElement) {
  const frame = host.querySelector('iframe')!;
  surface.props!.onContextMenu({ sequence: 1, frameGenerationId: 'frame_current', surfaceHandle: 'surface_current', isCurrent: () => surface.current,
    point: { x: .3, y: .4 }, viewport: { width: frame.clientWidth, height: frame.clientHeight },
    target: { tag: 'button', role: '', text: 'Start', selector: 'button:nth-of-type(1)', bounds: { x: .2, y: .3, width: .2, height: .1 } },
  });
}
it('uses the verified preview name when the draft has no user-assigned title', async () => {
  const { host } = mount('');
  await expect.poll(() => surface.opens).toBe(1);
  await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Focus Timer');
  expect(host.querySelector('.plugin-creation-atmosphere')).toBeNull();
  expect(host.querySelector('.plugin-creation-blueprint')).toBeNull();
});
it('preserves the user-assigned draft title above the generated plugin name', async () => {
  mount('Daily routine');
  await expect.poll(() => surface.opens).toBe(1);
  await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Daily routine');
});
it('does not attach workspace instructions to ordinary messages', async () => {
  const fixture = mount();
  await expect.poll(() => surface.opens).toBe(1);
  expect(fixture.embedded().contextAction).toBeUndefined();
  expect(fixture.embedded().initialContextAction).toBeUndefined();
});
it.each(['darwin', 'win32', 'linux'] as const)('keeps the content toolbar compact below the %s shell chrome', async platform => {
  await page.viewport(1280, 800);
  const chrome = resolveDesktopWindowChromeSnapshot(platform, { fullScreen: false });
  const style = document.createElement('style');
  style.textContent = buildDesktopWindowChromeStyleText(chrome);
  document.head.append(style);
  try {
    const { host } = mount();
    await expect.poll(() => surface.opens).toBe(1);
    const toolbar = host.querySelector<HTMLElement>('.plugin-creation-toolbar')!;
    expect(host.querySelectorAll('header')).toHaveLength(1);
    for (const button of toolbar.querySelectorAll('button')) {
      const rect = button.getBoundingClientRect();
      if (!rect.width) continue;
      expect(rect.left).toBeGreaterThanOrEqual(10);
      expect(rect.right).toBeLessThanOrEqual(1270);
    }
    expect(toolbar.getAttribute('data-redeven-desktop-titlebar-drag-region')).toBeNull();
    expect(toolbar.getBoundingClientRect().height).toBe(44);
    expect(toolbar.getBoundingClientRect().height).toBeLessThanOrEqual(48);
  } finally { style.remove(); }
});
it.each([320, 390].flatMap(width => [false, true].map(pendingUpdate => ({ width, pendingUpdate }))))('retains usable toolbar touch targets at $width px with pending update $pendingUpdate', async ({ width, pendingUpdate }) => {
  await page.viewport(width, 800);
  const { host } = mount('Focus Timer', pendingUpdate);
  await expect.poll(() => surface.opens).toBe(1);
  const toolbar = host.querySelector<HTMLElement>('.plugin-creation-toolbar')!;
  expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
  expect(toolbar.querySelector('h1')!.getBoundingClientRect().width).toBeGreaterThanOrEqual(36);
  if (pendingUpdate) await page.screenshot({ path: `__screenshots__/canvas-pending-${width}.png` });
  for (const button of toolbar.querySelectorAll('button')) {
    const rect = button.getBoundingClientRect();
    if (!rect.width) continue;
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  if (pendingUpdate) await expect.element(page.getByRole('menuitem', { name: 'Update preview', exact: true })).toBeVisible();
  await page.getByText('Comment', { exact: true }).click();
  await expect.element(page.getByRole('dialog', { name: 'Comment', exact: true })).toBeVisible();
  await expect.element(page.getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute('aria-selected', 'true');
});
it.each(['de-DE', 'fr-FR', 'ru-RU', 'zh-CN'] as const)('retains readable title space and touch controls at 320 px in %s', async locale => {
  await page.viewport(320, 800);
  writeStoredLanguagePreference(locale);
  const { host } = mount('Focus Timer', true);
  await expect.poll(() => surface.opens).toBe(1);
  const toolbar = host.querySelector<HTMLElement>('.plugin-creation-toolbar')!;
  expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
  expect(toolbar.querySelector('h1')!.getBoundingClientRect().width).toBeGreaterThanOrEqual(36);
  for (const button of toolbar.querySelectorAll('button')) {
    const rect = button.getBoundingClientRect();
    if (!rect.width) continue;
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeGreaterThanOrEqual(44);
  }
});
it('sends exact artifact-bound visual context and keeps the preview mounted through resizing and comment submission', async () => {
  await page.viewport(1280, 800);
  const { host, submit } = mount();
  await expect.poll(() => surface.opens).toBe(1);
  const frame = host.querySelector('iframe');
  select(host);
  await expect.element(page.getByRole('dialog', { name: 'Comment', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'What would you like Flower to change?' }).fill('Make Start more compact');
  await page.getByRole('button', { name: 'Phone width', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Ask Flower to change', exact: true })).toBeDisabled();
  await expect.element(page.getByText('The preview changed. Select a location again; your comment is kept.')).toBeVisible();
  expect(host.querySelector('iframe')).toBe(frame);
  select(host);
  await page.getByRole('button', { name: 'Ask Flower to change', exact: true }).click();
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit.mock.calls[0][0]).toMatchObject({ prompt: 'Make Start more compact' });
  const snapshot = submit.mock.calls[0][0].context!.context[0];
  if (snapshot.kind !== 'text_snapshot') throw new Error('Expected a visual context snapshot');
  const context = JSON.parse(snapshot.content);
  expect(context).toMatchObject({ artifact_id: 'artifact-1', preview_generation: 1, version: '0.1.0', target: { text: 'Start' } });
  expect(host.querySelector('iframe')).toBe(frame); expect(surface.closes).toBe(0);
  await expect.poll(() => loadPluginComment(id)).toBeUndefined();
});
it('rejects a retired surface and preserves its text for a fresh selection', async () => {
  const { host, submit } = mount();
  await expect.poll(() => surface.opens).toBe(1); select(host);
  await page.getByRole('textbox', { name: 'What would you like Flower to change?' }).fill('Preserve this comment');
  surface.current = false;
  await expect.element(page.getByRole('button', { name: 'Ask Flower to change' })).toBeDisabled();
  await expect.poll(() => loadPluginComment(id)).toBe('Preserve this comment');
  expect(submit).not.toHaveBeenCalled();
});
it('shows Flower progress after accepting a narrow-screen comment without replacing the preview', async () => {
  await page.viewport(390, 800);
  const { host, submit } = mount();
  await expect.poll(() => surface.opens).toBe(1);
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect.poll(() => host.querySelector('iframe')!.clientWidth).toBeGreaterThan(0);
  const frame = host.querySelector('iframe');
  select(host);
  await page.getByRole('textbox', { name: 'What would you like Flower to change?' }).fill('Clarify the timer action');
  await page.getByRole('button', { name: 'Ask Flower to change', exact: true }).click();
  await expect.poll(() => submit.mock.calls.length).toBe(1);
  await expect.element(page.getByRole('tab', { name: 'Conversation', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(host.querySelector('iframe')).toBe(frame);
  expect(surface.closes).toBe(0);
});
it('restores comment text without restoring live surface targeting', async () => {
  await savePluginComment(id, 'Unsent from the last visit'); mount();
  await expect.element(page.getByRole('textbox', { name: 'What would you like Flower to change?' })).toHaveValue('Unsent from the last visit');
  await expect.element(page.getByRole('button', { name: 'Ask Flower to change' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close comment', exact: true }).click();
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Ask Flower to change' })).toBeEnabled();
  await expect.element(page.getByRole('textbox', { name: 'What would you like Flower to change?' })).toHaveValue('Unsent from the last visit');
});

it.each([{ width: 1280, theme: 'light' }, { width: 1280, theme: 'dark' }, { width: 390, theme: 'dark' }])('presents the generated canvas and comment at $width px in $theme', async ({ width, theme }) => {
  await page.viewport(width, 800);
  document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme);
  const { host } = mount();
  await expect.poll(() => surface.opens).toBe(1);
  if (width < 720) await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect.poll(() => host.querySelector('iframe')!.clientWidth).toBeGreaterThan(0);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  select(host);
  await page.getByRole('textbox', { name: 'What would you like Flower to change?' }).fill('Make this action quieter and align it with the timer.');
  await expect.poll(() => getComputedStyle(host.querySelector('.plugin-canvas-comment')!).opacity).toBe('1');
  await page.screenshot({ path: `__screenshots__/canvas-comment-${width}-${theme}.png` });
  expect(host.scrollWidth).toBeLessThanOrEqual(width);
  document.documentElement.classList.remove(theme);
});

it('keeps preview controls in the single workspace toolbar and anchors comments beside the selection', async () => {
  await page.viewport(1280, 800);
  const { host } = mount();
  await expect.poll(() => surface.opens).toBe(1);
  const toolbar = host.querySelector('.plugin-creation-toolbar')!;
  expect(toolbar.querySelector('[aria-label="Fit canvas"]')).not.toBeNull();
  expect(host.querySelector('.plugin-creation-section-header')).toBeNull();
  select(host);
  await expect.element(page.getByRole('dialog', { name: 'Comment', exact: true })).toBeVisible();
  const frame = host.querySelector('iframe')!.getBoundingClientRect();
  await expect.poll(() => {
    const panel = host.querySelector('.plugin-canvas-comment')!.getBoundingClientRect();
    return Math.abs(panel.top - (frame.top + frame.height * .4));
  }).toBeLessThan(40);
});

it('retains unsaved comments and prevents navigation until storage recovers', async () => {
  await page.viewport(1280, 800);
  const { host } = mount();
  await expect.poll(() => surface.opens).toBe(1);
  select(host);
  const original = IDBDatabase.prototype.transaction;
  let failing = true;
  const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, stores, mode, options) {
    if (this.name === 'redeven-plugin-composer' && mode === 'readwrite' && failing) throw new DOMException('Comment storage full', 'QuotaExceededError');
    return original.call(this, stores, mode, options);
  });
  try {
    await page.getByRole('textbox', { name: 'What would you like Flower to change?' }).fill('Retain this unsaved review');
    await expect.element(page.getByRole('alert')).toHaveTextContent('Comment storage full');
    const exit = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(exit);
    expect(exit.defaultPrevented).toBe(true);
    failing = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect.poll(() => loadPluginComment(id)).toBe('Retain this unsaved review');
    const savedExit = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(savedExit);
    expect(savedExit.defaultPrevented).toBe(false);
  } finally { transaction.mockRestore(); }
});

it('preserves new comment edits while the prior submission is being saved', async () => {
  await page.viewport(1280, 800);
  const { host, submit } = mount();
  await expect.poll(() => surface.opens).toBe(1);
  select(host);
  let accept!: (value: boolean) => void;
  submit.mockImplementation(() => new Promise(resolve => { accept = resolve; }));
  const editor = page.getByRole('textbox', { name: 'What would you like Flower to change?' });
  await editor.fill('First review');
  await page.getByRole('button', { name: 'Ask Flower to change', exact: true }).click();
  await expect.poll(() => submit.mock.calls.length).toBe(1);
  await editor.fill('A second thought');
  accept(true);
  await expect.element(editor).toHaveValue('A second thought');
  await expect.poll(() => loadPluginComment(id)).toBe('A second thought');
});

it('does not revive an old selection after resizing away and back', async () => {
  await page.viewport(1280, 800);
  const { host } = mount();
  await expect.poll(() => surface.opens).toBe(1);
  select(host);
  await page.getByRole('textbox', { name: 'What would you like Flower to change?' }).fill('Use the original selection only');
  await page.getByRole('button', { name: 'Phone width', exact: true }).click();
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Ask Flower to change', exact: true })).toBeDisabled();
});

it('keeps the live canvas and composer on package conflict and sends one explicit repair request', async () => {
  const fixture = mount('Focus Timer', true);
  await expect.poll(() => surface.opens).toBe(1);
  const original = fixture.fetch.getMockImplementation()!;
  fixture.fetch.mockImplementation(async input => String(input).endsWith('/check')
    ? Response.json({ error: { code: 'plugin_author_package_conflict', message: 'raw integrity error' } }, { status: 409 })
    : original(input));
  const frame = fixture.host.querySelector('iframe');
  await page.getByRole('textbox', { name: 'Ordinary draft' }).fill('Keep this unsent note');
  await page.getByRole('button', { name: 'Install in this environment', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Ask Flower to fix', exact: true })).toBeVisible();
  expect(fixture.host.querySelector('iframe')).toBe(frame);
  expect(surface.closes).toBe(0);
  expect(fixture.fetch.mock.calls.some(([url]) => /\/(apply|install)$/.test(String(url)))).toBe(false);
  expect(fixture.submit).not.toHaveBeenCalled();
  expect(fixture.host.textContent).not.toContain('raw integrity error');
  await page.getByRole('button', { name: 'Ask Flower to fix', exact: true }).click();
  expect(fixture.submit).toHaveBeenCalledOnce();
  expect(fixture.submit.mock.calls[0][0].prompt).toContain('Preserve plugin identity and data');
  expect(fixture.submit.mock.calls[0][0].context).toBeUndefined();
  await expect.element(page.getByRole('textbox', { name: 'Ordinary draft' })).toHaveValue('Keep this unsent note');
});

it('resizes with the pointer and keyboard, persists locally and clamps narrow windows without losing the preference', async () => {
  await page.viewport(1280, 800);
  const fixture = mount();
  await expect.poll(() => surface.opens).toBe(1);
  const handle = fixture.host.querySelector<HTMLElement>('[data-plugin-conversation-resizer]')!;
  const frame = fixture.host.querySelector('iframe');
  const initial = Number(handle.getAttribute('aria-valuenow'));
  await (commands as unknown as { resizePluginConversation: (delta: number) => Promise<void> }).resizePluginConversation(150);
  const resized = Number(handle.getAttribute('aria-valuenow'));
  expect(resized).toBeGreaterThan(initial + 140);
  expect(resized).toBeLessThan(initial + 180);
  expect(fixture.host.querySelector('iframe')).toBe(frame);
  expect(readUIStorageItem('redeven.plugin-creation.conversation-width.v1')).toBe(String(resized));
  handle.focus(); await userEvent.keyboard('{ArrowRight}');
  const saved = resized + 10;
  expect(readUIStorageItem('redeven.plugin-creation.conversation-width.v1')).toBe(String(saved));
  await page.viewport(760, 800);
  await expect.poll(() => handle.getAttribute('aria-valuenow')).toBe('400');
  expect(fixture.host.scrollWidth).toBeLessThanOrEqual(760);
  expect(readUIStorageItem('redeven.plugin-creation.conversation-width.v1')).toBe(String(saved));
  await page.viewport(390, 800);
  await expect.poll(() => fixture.host.querySelector('[data-plugin-conversation-resizer]')).toBeNull();
  await page.viewport(1280, 800);
  await expect.poll(() => fixture.host.querySelector('[data-plugin-conversation-resizer]')?.getAttribute('aria-valuenow')).toBe(String(saved));
  dispose?.(); release?.(); fixture.host.remove();
  const reopened = mount();
  await expect.poll(() => reopened.host.querySelector('[data-plugin-conversation-resizer]')?.getAttribute('aria-valuenow')).toBe(String(saved));
});
