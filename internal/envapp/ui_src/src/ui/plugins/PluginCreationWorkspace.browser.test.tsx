import '../../index.css';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { FloeConfigProvider } from '@floegence/floe-webapp-core';
import { bindSessionHTTP } from '../services/sessionHTTP';
import { I18nProvider } from '../i18n';
import { PluginCreationWorkspace } from './PluginCreationWorkspace';
import { SettingsPanelContext } from '../../../../../settings_ui/src/SettingsPanelHost';
import { pluginAuthorSettingsResource } from './pluginSettingsTarget';
import { createFlowerComposerDraftCoordinator, type FlowerEmbeddedConversation } from '../../../../../flower_ui/src';
import type { PluginDraft } from './pluginCreationApi';
import { removePluginComposer } from './pluginComposerPersistence';

let pauseComposerSave: (() => Promise<void>) | undefined;
vi.mock('./pluginComposerPersistence', async importOriginal => {
  const actual = await importOriginal<typeof import('./pluginComposerPersistence')>();
  return { ...actual, savePluginComposer: async (...args: Parameters<typeof actual.savePluginComposer>) => {
    await pauseComposerSave?.();
    return actual.savePluginComposer(...args);
  } };
});
let dispose: (() => void) | undefined;
const baseDraft: PluginDraft = {
  id: 'draft-1',
  title: 'Task timer',
  revision: 2,
  lifecycle: 'active',
  workspace_id: 'author-1',
  created_at: 1,
  updated_at: 1,
};
let draft = baseDraft;
let deletes = 0;
let releaseHTTP: (() => void) | undefined;
const media = commands as unknown as {
  emulateMediaPreferences: (preferences: { reducedMotion?: 'reduce' | 'no-preference'; forcedColors?: 'active' | 'none' }) => Promise<void>;
};
beforeEach(() => {
  pauseComposerSave = undefined;
  deletes = 0;
  draft = baseDraft;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/delete')) {
        deletes++;
        return Response.json({
          ok: true,
          data: { ...draft, lifecycle: 'deleted' },
        });
      }
      if (path.endsWith('/catalog/query')) return Response.json({ ok: true, data: { plugins: [] } });
      if (path.endsWith('/status'))
        return Response.json({
          data: { artifacts: [], preview: {}, plugins: [] },
        });
      return Response.json({ ok: true, data: draft });
    }),
  );
  releaseHTTP = bindSessionHTTP({
    fetch: globalThis.fetch,
    events: async function* () {},
  });
});
afterEach(async () => {
  dispose?.();
  releaseHTTP?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' });
});
function mount(canManage = true, settingsOpen = vi.fn()) {
  const [visible, setVisible] = createSignal(true);
  const onBack = vi.fn();
  const submit = vi.fn();
  const host = document.createElement('div');
  host.style.cssText = 'height:700px;width:100%';
  document.body.append(host);
  dispose = render(
    () => (
      <FloeConfigProvider>
        <I18nProvider>
        <SettingsPanelContext.Provider value={{ open: settingsOpen, close: () => {}, target: () => null, present: () => false, register: () => () => {} }}>
          <PluginCreationWorkspace
            draftCoordinator={createFlowerComposerDraftCoordinator()}
            draftID="draft-1"
            canManage={canManage}
            visible={visible()}
            onBack={onBack}
            onSaved={vi.fn()}
            onInstalled={vi.fn()}
            renderFlower={({ embeddedConversation }) =>
              embeddedConversation.render({
                conversation: <div data-testid="flower-surface">Conversation</div>,
                composer: <textarea aria-label="Message" />,
                submit,
                canSubmit: () => true,
                actionLayout: () => 'chat',
                actions: () => [],
                actionOverlays: null,
                threadID: () => 'thread-1',
              })
            }
          />
        </SettingsPanelContext.Provider>
        </I18nProvider>
      </FloeConfigProvider>
    ),
    host,
  );
  return { host, onBack, submit, setVisible, settingsOpen };
}
it.each([false, true])('reconciles a bound project before opening only for managers (manager: %s)', async canManage => {
  draft = { ...baseDraft, thread_id: 'thread-1' };
  mount(canManage);
  await expect.element(page.getByText('Task timer', { exact: true })).toBeVisible();
  const resumes = vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/resume'));
  expect(resumes).toHaveLength(canManage ? 1 : 0);
});
it.each([false, true])('uses only the ordinary composer in the workspace (conversation: %s)', async (conversationStarted) => {
  if (conversationStarted) draft = { ...baseDraft, thread_id: 'thread-1' };
  await page.viewport(1200, 800);
  const { host, submit } = mount();
  await expect.element(page.getByText('Task timer', { exact: true })).toBeVisible();
  expect(host.querySelector('[data-floe-dialog-presentation]')).toBeNull();
  expect(host.querySelectorAll('textarea')).toHaveLength(1);
  const conversation = host.querySelector('.plugin-creation-main')!.getBoundingClientRect();
  const preview = host.querySelector('.plugin-creation-preview')!.getBoundingClientRect();
  expect(preview.width).toBe(conversationStarted ? 888 : 0);
  expect(conversation.width).toBe(conversationStarted ? 312 : 1200);
  expect(preview.right).toBeLessThanOrEqual(1200);
  await expect.element(page.getByRole('button', { name: 'Create directly', exact: true })).not.toBeInTheDocument();
  expect(host.querySelector('.plugin-creation-flower-composer')!.children).toHaveLength(1);
  expect(submit).not.toHaveBeenCalled();
});
it('animates the empty canvas and pauses it when the workspace or document is hidden', async () => {
  draft = { ...baseDraft, thread_id: 'thread-1' };
  await page.viewport(1200, 800);
  const { host, setVisible } = mount();
  await expect.element(page.getByText('Task timer', { exact: true })).toBeVisible();
  const background = host.querySelector<HTMLElement>('.plugin-creation-empty-preview .plugin-creation-atmosphere')!;
  const grid = background.querySelector('span')!;
  const sculpture = host.querySelector<HTMLElement>('.plugin-creation-sculpture')!;
  const tile = sculpture.querySelector<HTMLElement>('.plugin-sculpture-petal-a')!;
  const [animation] = tile.getAnimations();
  expect(animation.playState).toBe('running');
  const start = Number(animation.currentTime);
  await expect.poll(() => Number(animation.currentTime)).toBeGreaterThan(start);
  animation.pause();
  animation.currentTime = 0;
  const original = getComputedStyle(tile).transform;
  const originalShape = getComputedStyle(tile).borderRadius;
  animation.currentTime = 6000;
  expect(getComputedStyle(tile).transform).not.toBe(original);
  expect(getComputedStyle(tile).borderRadius).not.toBe(originalShape);
  expect(getComputedStyle(tile).backgroundImage).toContain('linear-gradient');
  const tileRect = tile.getBoundingClientRect(), bounds = sculpture.getBoundingClientRect();
  expect(tileRect.left).toBeGreaterThanOrEqual(bounds.left);
  expect(tileRect.right).toBeLessThanOrEqual(bounds.right);
  animation.play();
  setVisible(false);
  expect(getComputedStyle(grid).animationPlayState).toBe('paused');
  expect(getComputedStyle(tile).animationPlayState).toBe('paused');
  setVisible(true);
  expect(getComputedStyle(grid).animationPlayState).toBe('running');
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  try {
    document.dispatchEvent(new Event('visibilitychange'));
    expect(background.dataset.active).toBe('false');
    expect(getComputedStyle(tile).animationPlayState).toBe('paused');
  } finally {
    hidden.mockRestore();
    document.dispatchEvent(new Event('visibilitychange'));
  }
});
it('keeps the canvas static under reduced motion and omits it in forced colors', async () => {
  draft = { ...baseDraft, thread_id: 'thread-1' };
  await page.viewport(1200, 800);
  const { host } = mount();
  await expect.element(page.getByText('Task timer', { exact: true })).toBeVisible();
  await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  const background = host.querySelector<HTMLElement>('.plugin-creation-empty-preview .plugin-creation-atmosphere')!;
  const tiles = host.querySelectorAll<HTMLElement>('.plugin-creation-sculpture *, .plugin-creation-atmosphere > span');
  for (const tile of tiles) expect(getComputedStyle(tile).animationName).toBe('none');
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'active' });
  expect(getComputedStyle(background).display).toBe('none');
  expect(getComputedStyle(host.querySelector('.plugin-sculpture-petal-a')!).animationName).toBe('none');
});
it('requires confirmation before deleting only the selected draft', async () => {
  const { onBack } = mount();
  await expect.element(page.getByText('Task timer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByText('Delete project', { exact: true }).click();
  await expect.element(page.getByRole('dialog')).toBeVisible();
  expect(deletes).toBe(0);
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect.poll(() => deletes).toBe(1);
  await expect.poll(() => onBack.mock.calls.length).toBe(1);
});
it('uses accessible conversation and preview tabs on small screens', async () => {
  draft = { ...baseDraft, thread_id: 'thread-1' };
  await page.viewport(390, 800);
  const { host } = mount();
  await expect.element(page.getByText('Task timer', { exact: true })).toBeVisible();
  await expect.element(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect
    .element(page.getByRole('tab', { name: 'Preview', exact: true }))
    .toHaveAttribute('aria-selected', 'true');
  expect(host.querySelector('.plugin-creation-preview')!.getBoundingClientRect().width).toBeLessThanOrEqual(390);
  await expect.poll(() => getComputedStyle(host.querySelector('.plugin-creation-main')!).display).toBe('none');
});

it('recovers the same accepted install after a page reload', async () => {
  draft = {
    ...baseDraft,
    install_request_id: 'install-original',
    install_artifact_id: 'artifact-1',
    install_inspection_id: 'review-1',
  };
  const original = globalThis.fetch;
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/installation')) {
        calls.push(JSON.parse(String(init?.body)).request_id);
        return Response.json({
          ok: true,
          data: {
            request_id: 'install-original',
            mutation_outcome: 'committed',
            execution: {
              status: 'completed',
              plugin_instance_id: 'installed-1',
            },
          },
        });
      }
      return original(input, init);
    }),
  );
  releaseHTTP?.();
  releaseHTTP = bindSessionHTTP({
    fetch: globalThis.fetch,
    events: async function* () {},
  });
  mount();
  await expect.poll(() => calls).toEqual(['install-original']);
  expect(vi.mocked(globalThis.fetch).mock.calls.some(([input]) => String(input).endsWith('/install'))).toBe(false);
});
it('does not turn a failed saved-draft load into a new conversation', async () => {
  const original = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/drafts/draft-1')
        ? Response.json({ ok: false, error: 'Draft unavailable' }, { status: 503 })
        : original(input, init),
    ),
  );
  releaseHTTP?.();
  releaseHTTP = bindSessionHTTP({
    fetch: globalThis.fetch,
    events: async function* () {},
  });
  const { host } = mount();
  await expect.element(page.getByRole('alert')).toBeVisible();
  expect(host.querySelector('textarea')).toBeNull();
});
it.each(['pending', 'rejected', 'snapshot_failed'].flatMap(outcome => ['toolbar', 'history'].map(navigation => ({ outcome, navigation }))))('retains unsubmitted work when saving is $outcome during $navigation navigation', async ({ outcome, navigation }) => {
  draft = { ...baseDraft, id: crypto.randomUUID() };
  const original = globalThis.fetch;
  let finish: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let rejectCreation = outcome === 'rejected';
  const creationRequests: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/drafts') && init?.method === 'POST') {
      creationRequests.push(JSON.parse(String(init.body)).request_id);
      await pending;
      return rejectCreation
        ? Response.json({ error: 'Draft save rejected' }, { status: 503 })
        : Response.json({ data: draft });
    }
    return original(input, init);
  });
  vi.stubGlobal('fetch', fetch);
  releaseHTTP?.();
  releaseHTTP = bindSessionHTTP({ fetch, events: async function* () {} });
  let navigateFromHistory: ((commit: () => unknown) => Promise<boolean>) | undefined;
  const coordinator = createFlowerComposerDraftCoordinator();
  const session = coordinator.open('navigation-draft');
  session.mutate(value => ({ ...value, text: 'Keep this unsent requirement' }));
  if (outcome === 'snapshot_failed') vi.spyOn(coordinator, 'snapshotForRestart').mockImplementation(() => { throw new Error('Attachment bytes unavailable'); });
  let embedded: FlowerEmbeddedConversation | undefined;
  const onBack = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <FloeConfigProvider><I18nProvider><PluginCreationWorkspace
    draftCoordinator={coordinator} draftID={outcome === 'snapshot_failed' ? draft.id : 'new'} visible canManage
    onBack={onBack} onSaved={vi.fn()} onInstalled={vi.fn()}
    onNavigationReady={navigate => { navigateFromHistory = navigate; }}
    renderFlower={options => { embedded = options.embeddedConversation; return <div>Conversation fixture</div>; }}
  /></I18nProvider></FloeConfigProvider>, host);
  await expect.poll(() => embedded).toBeDefined();
  embedded!.onDraftChange?.(session.snapshot());
  embedded!.onDraftPresence?.(true);
  try {
    if (navigation === 'toolbar') await page.getByRole('button', { name: 'Back to creation history', exact: true }).click();
    else void navigateFromHistory!(onBack);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(onBack).not.toHaveBeenCalled();
    finish?.();
    if (outcome === 'pending') await expect.poll(() => onBack.mock.calls.length).toBe(1);
    else {
      await expect.element(page.getByRole('alert')).toBeVisible();
      expect(onBack).not.toHaveBeenCalled();
      if (outcome === 'rejected') {
        rejectCreation = false;
        await page.getByRole('button', { name: 'Try again', exact: true }).click();
        await expect.poll(() => host.querySelector('[data-plugin-creation-workspace]')?.getAttribute('data-project-id')).toBe(draft.id);
        expect(creationRequests).toHaveLength(2);
        expect(new Set(creationRequests).size).toBe(1);
      }
    }
  } finally {
    finish?.();
    dispose?.(); dispose = undefined;
    coordinator.dispose();
    await removePluginComposer(draft.id);
  }
});
it('does not report a newer edit as saved when an older transaction completes', async () => {
  draft = { ...baseDraft, id: crypto.randomUUID() };
  let finish: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let started = false;
  pauseComposerSave = async () => { started = true; await pending; };
  const coordinator = createFlowerComposerDraftCoordinator();
  const session = coordinator.open('newer-composer-revision');
  session.mutate(value => ({ ...value, text: 'First edit' }));
  let embedded: FlowerEmbeddedConversation | undefined;
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FloeConfigProvider><I18nProvider><PluginCreationWorkspace
    draftCoordinator={coordinator} draftID={draft.id} visible canManage
    onBack={vi.fn()} onSaved={vi.fn()} onInstalled={vi.fn()}
    renderFlower={options => { embedded = options.embeddedConversation; return <div>Conversation fixture</div>; }}
  /></I18nProvider></FloeConfigProvider>, host);
  try {
    await expect.poll(() => embedded).toBeDefined();
    embedded!.onDraftChange?.(session.snapshot());
    await expect.poll(() => started).toBe(true);
    session.mutate(value => ({ ...value, text: 'Second edit' }));
    embedded!.onDraftChange?.(session.snapshot());
    finish?.();
    await new Promise(resolve => setTimeout(resolve, 30));
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await expect.poll(() => host.querySelector('[role="status"]')?.textContent).toBe('Saved');
  } finally {
    finish?.(); dispose?.(); dispose = undefined; coordinator.dispose();
    await removePluginComposer(draft.id);
  }
});

it('keeps an unchanged composer saved when notified again', async () => {
  draft = { ...baseDraft, id: crypto.randomUUID() };
  const coordinator = createFlowerComposerDraftCoordinator();
  const session = coordinator.open('stable-composer-revision');
  session.mutate(value => ({ ...value, text: 'Retained draft' }));
  const writes = vi.fn(async () => {});
  pauseComposerSave = writes;
  let embedded: FlowerEmbeddedConversation | undefined;
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FloeConfigProvider><I18nProvider><PluginCreationWorkspace
    draftCoordinator={coordinator} draftID={draft.id} visible canManage
    onBack={vi.fn()} onSaved={vi.fn()} onInstalled={vi.fn()}
    renderFlower={options => { embedded = options.embeddedConversation; return <div>Conversation fixture</div>; }}
  /></I18nProvider></FloeConfigProvider>, host);
  try {
    await expect.poll(() => embedded).toBeDefined();
    embedded!.onDraftChange?.(session.snapshot());
    await expect.poll(() => host.querySelector('.plugin-creation-save-state')?.textContent).toBe('Saved');
    const count = writes.mock.calls.length;
    embedded!.onDraftChange?.(session.snapshot());
    expect(host.querySelector('.plugin-creation-save-state')?.textContent).toBe('Saved');
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(writes.mock.calls.length).toBe(count);
  } finally {
    dispose?.(); dispose = undefined; coordinator.dispose(); await removePluginComposer(draft.id);
  }
});

it('blocks a document reload until the latest composer transaction completes', async () => {
  draft = { ...baseDraft, id: crypto.randomUUID() };
  const coordinator = createFlowerComposerDraftCoordinator();
  const session = coordinator.open('document-reload-draft');
  session.mutate(value => ({ ...value, text: 'Do not lose this on reload' }));
  let embedded: FlowerEmbeddedConversation | undefined;
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FloeConfigProvider><I18nProvider><PluginCreationWorkspace
    draftCoordinator={coordinator} draftID={draft.id} visible canManage
    onBack={vi.fn()} onSaved={vi.fn()} onInstalled={vi.fn()}
    renderFlower={options => { embedded = options.embeddedConversation; return <div>Conversation fixture</div>; }}
  /></I18nProvider></FloeConfigProvider>, host);
  try {
    await expect.poll(() => embedded).toBeDefined();
    embedded!.onDraftChange?.(session.snapshot());
    const pendingReload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(pendingReload);
    expect(pendingReload.defaultPrevented).toBe(true);
    await expect.poll(() => host.querySelector('[role="status"]')?.textContent).toBe('Saved');
    const savedReload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(savedReload);
    expect(savedReload.defaultPrevented).toBe(false);
  } finally {
    dispose?.(); dispose = undefined; coordinator.dispose();
    await removePluginComposer(draft.id);
  }
});

it.each(['pending', 'rejected'])('flushes the active draft before Desktop restart when creation is %s', async outcome => {
  draft = { ...baseDraft, id: crypto.randomUUID() };
  let finish: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const original = globalThis.fetch;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/drafts') && init?.method === 'POST') {
      await pending;
      return outcome === 'rejected' ? Response.json({ error: 'Draft creation unavailable' }, { status: 503 }) : Response.json({ data: draft });
    }
    return original(input, init);
  });
  vi.stubGlobal('fetch', fetch);
  releaseHTTP?.(); releaseHTTP = bindSessionHTTP({ fetch, events: async function* () {} });
  const coordinator = createFlowerComposerDraftCoordinator();
  const session = coordinator.open('restart-pending-creation');
  session.mutate(value => ({ ...value, text: 'The latest unsent requirement' }));
  let embedded: FlowerEmbeddedConversation | undefined;
  let prepareRestart: (() => Promise<string | undefined>) | undefined;
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FloeConfigProvider><I18nProvider><PluginCreationWorkspace
    draftCoordinator={coordinator} draftID="new" visible canManage
    onBack={vi.fn()} onSaved={vi.fn()} onInstalled={vi.fn()} onRestartReady={save => { prepareRestart = save; }}
    renderFlower={options => { embedded = options.embeddedConversation; return <div>Conversation fixture</div>; }}
  /></I18nProvider></FloeConfigProvider>, host);
  try {
    await expect.poll(() => embedded).toBeDefined();
    embedded!.onDraftChange?.(session.snapshot());
    embedded!.onDraftPresence?.(true);
    let completed = false;
    const result = prepareRestart!().then(id => { completed = true; return { id }; }, error => ({ error: String(error) }));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(completed).toBe(false);
    finish!();
    if (outcome === 'pending') expect(await result).toEqual({ id: draft.id });
    else { expect(await result).toHaveProperty('error'); expect(completed).toBe(false); }
    expect(session.snapshot().value.text).toBe('The latest unsent requirement');
  } finally { finish?.(); dispose?.(); dispose = undefined; coordinator.dispose(); await removePluginComposer(draft.id); }
});

it.each(['rename', 'delete', 'rename_empty'])('completes %s after a new draft finishes creating', async action => {
  const original = globalThis.fetch;
  let finish: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const operations: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/drafts') && init?.method === 'POST') { await pending; return Response.json({ data: baseDraft }); }
    if (path.endsWith('/rename')) { operations.push('rename'); draft = { ...draft, revision: draft.revision + 1, title: JSON.parse(String(init?.body)).title }; return Response.json({ data: draft }); }
    if (path.endsWith('/delete')) operations.push('delete');
    return original(input, init);
  });
  vi.stubGlobal('fetch', fetch); releaseHTTP?.();
  releaseHTTP = bindSessionHTTP({ fetch, events: async function* () {} });
  let embedded: FlowerEmbeddedConversation | undefined;
  const onBack = vi.fn();
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FloeConfigProvider><I18nProvider><PluginCreationWorkspace
    draftCoordinator={createFlowerComposerDraftCoordinator()} draftID="new" visible canManage
    onBack={onBack} onSaved={vi.fn()} onInstalled={vi.fn()}
    renderFlower={options => { embedded = options.embeddedConversation; return <div>Conversation fixture</div>; }}
  /></I18nProvider></FloeConfigProvider>, host);
  if (action !== 'rename_empty') embedded!.onDraftPresence?.(true);
  try {
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByText(action !== 'delete' ? 'Rename project' : 'Delete project', { exact: true }).click();
    if (action !== 'delete') {
      await page.getByRole('textbox', { name: 'Rename project', exact: true }).fill('Renamed draft');
      finish?.();
      await expect.element(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Delete project', exact: true }).click();
      expect(onBack).not.toHaveBeenCalled();
      finish?.();
    }
    await expect.poll(() => operations).toEqual([action === 'rename_empty' ? 'rename' : action]);
    if (action === 'delete') await expect.poll(() => onBack.mock.calls.length).toBe(1);
    else await expect.element(page.getByRole('heading', { name: 'Renamed draft', exact: true })).toBeVisible();
  } finally { finish?.(); }
});
it('requests a fresh review after an installation is authoritatively not committed', async () => {
  draft = {
    ...baseDraft,
    install_request_id: 'rejected-install',
    install_artifact_id: 'artifact-1',
    install_inspection_id: 'expired-review',
  };
  const original = globalThis.fetch;
  const inspections: unknown[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/status')) return Response.json({ data: {
      artifacts: [{ artifact_id: 'artifact-1', version: '0.1.0', stages: [] }],
      preview: { artifact_id: 'artifact-1', generation: 1 },
    } });
    if (path.endsWith('/installation')) return Response.json({ data: {
      request_id: 'rejected-install', mutation_outcome: 'not_committed',
      execution: { status: 'failed', error: { message: 'Review expired' } },
    } });
    if (path.endsWith('/inspect')) {
      inspections.push(JSON.parse(String(init?.body)));
      return Response.json({ error: { message: 'Fresh review unavailable' } }, { status: 503 });
    }
    return original(input, init);
  });
  vi.stubGlobal('fetch', fetch);
  releaseHTTP?.();
  releaseHTTP = bindSessionHTTP({ fetch, events: async function* () {} });
  mount();
  await expect.element(page.getByText('Review expired', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => inspections).toEqual([{ artifact_id: 'artifact-1' }]);
  expect(fetch.mock.calls.some(([input]) => String(input).endsWith('/install'))).toBe(false);
});
it('blocks preview changes while installation is unknown and queries the original request on retry', async () => {
  await page.viewport(1200, 800);
  draft = {
    ...baseDraft,
    install_request_id: 'install-original',
    install_artifact_id: 'artifact-1',
    install_inspection_id: 'review-1',
  };
  const original = globalThis.fetch;
  const queries: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/status'))
        return Response.json({
          data: {
            artifacts: [
              { artifact_id: 'artifact-2', version: '0.2.0', stages: [] },
              { artifact_id: 'artifact-1', version: '0.1.0', stages: [] },
            ],
            preview: { artifact_id: 'artifact-1' },
          },
        });
      if (String(input).endsWith('/installation')) {
        queries.push(JSON.parse(String(init?.body)).request_id);
        const recovered = queries.length > 1;
        return Response.json({
          data: {
            request_id: 'install-original',
            mutation_outcome: recovered ? 'committed' : 'unknown',
            execution: {
              status: recovered ? 'completed' : 'failed',
              plugin_instance_id: 'installed-1',
              error: { message: 'Outcome is unknown' },
            },
          },
        });
      }
      return original(input, init);
    }),
  );
  releaseHTTP?.();
  releaseHTTP = bindSessionHTTP({
    fetch: globalThis.fetch,
    events: async function* () {},
  });
  mount();
  await expect.element(page.getByText('Outcome is unknown', { exact: true })).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Update preview', exact: true })).toBeDisabled();
  await expect
    .element(
      page.getByRole('button', {
        name: 'Install in this environment',
        exact: true,
      }),
    )
    .toBeDisabled();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Update preview', exact: true })).toBeEnabled();
  expect(queries).toEqual(['install-original', 'install-original']);
  expect(vi.mocked(globalThis.fetch).mock.calls.some(([input]) => /\/(install|apply)$/.test(String(input)))).toBe(
    false,
  );
});
it('renames a draft with its current revision', async () => {
  const original = globalThis.fetch;
  const renames: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/rename')) {
        const body = JSON.parse(String(init?.body));
        renames.push(body);
        draft = { ...draft, title: body.title, revision: draft.revision + 1 };
        return Response.json({ ok: true, data: draft });
      }
      return original(input, init);
    }),
  );
  releaseHTTP?.();
  releaseHTTP = bindSessionHTTP({
    fetch: globalThis.fetch,
    events: async function* () {},
  });
  mount();
  await expect.element(page.getByText('Task timer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByText('Rename project', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Rename project' }).fill('Focused timer');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.element(page.getByText('Focused timer', { exact: true })).toBeVisible();
  expect(renames).toEqual([{ revision: 2, title: 'Focused timer' }]);
});

it('shows actual failed build stages and bounded command output', async () => {
  await page.viewport(1200, 800);
  const original = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/status')
        ? Response.json({
            data: {
              artifacts: [],
              preview: {},
              build: {
                status: 'failed',
                error: 'Typecheck failed',
                stages: [
                  { name: 'typecheck', status: 'failed' },
                  { name: 'test', status: 'not_run' },
                ],
                commands: [
                  {
                    arguments: ['npm', 'run', 'typecheck'],
                    output: 'ui/timer.ts: Unknown timerState',
                    truncated: true,
                  },
                ],
              },
            },
          })
        : original(input, init),
    ),
  );
  releaseHTTP?.();
  releaseHTTP = bindSessionHTTP({
    fetch: globalThis.fetch,
    events: async function* () {},
  });
  mount();
  await expect.element(page.getByText('Task timer', { exact: true })).toBeVisible();
  await expect.element(page.elementLocator(document.querySelector('.plugin-creation-check-button')!)).toHaveAttribute('data-build-state', 'failed');
  expect(getComputedStyle(document.querySelector('.plugin-sculpture-petal-a')!).animationPlayState).toBe('paused');
  await page.elementLocator(document.querySelector('.plugin-creation-placeholder-checks')!).click();
  await expect.element(page.getByRole('dialog').getByText('Failed', { exact: true })).toBeVisible();
  await expect.element(page.getByText('Not run', { exact: true })).toBeVisible();
  await expect.element(page.getByText('Typecheck failed', { exact: true })).toBeVisible();
  await page.getByText('Output', { exact: true }).click();
  await expect.element(page.getByText('npm run typecheck', { exact: true })).toBeVisible();
  await expect.element(page.getByText('ui/timer.ts: Unknown timerState', { exact: true })).toBeVisible();
  await expect.element(page.getByText('Showing partial content (truncated).', { exact: true })).toBeVisible();
});

it('routes preview permissions to the global settings dialog with exact author identity', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (...args) => String(args[0]).endsWith('/status')
    ? Response.json({ data: { artifacts: [], preview: { plugin_instance_id: 'preview-exact', generation: 1 }, plugins: [] } })
    : original(...args));
  const { settingsOpen } = mount();
  await expect.element(page.getByText('Task timer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Permissions', exact: true }).click();
  expect(settingsOpen).toHaveBeenCalledWith({ section: 'plugins', resource: pluginAuthorSettingsResource({ draftID: 'draft-1', workspaceID: 'author-1', pluginInstanceID: 'preview-exact' }) });
  expect(document.querySelector('[data-plugin-author-access]')).toBeNull();
});
