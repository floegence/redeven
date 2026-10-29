import { agentPluginsFixture } from './flower/agentPluginsFixture';
import '../index.css';
import './flower-feature.css';
import './activity-flower-shell.css';

import { createSignal, Show } from 'solid-js';
import { Portal, render } from 'solid-js/web';
import { BottomBarCompanion, type BottomBarCompanionPhase } from '@floegence/floe-webapp-core/layout';
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FlowerSurface, createFlowerComposerDraftCoordinator, type FlowerSurfaceProps } from '../../../../flower_ui/src';
import type { FlowerSurfaceAdapter } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { FlowerExtensionsAdapter } from '../../../../flower_ui/src/extensions/types';
import { withModelDirectoryFixture } from '../../../../flower_ui/testing/modelDirectoryFixture';
import { adapter, thread, liveBootstrap, settingsSnapshot, waitFor } from './FlowerSurface.navigation.testHarness';

beforeEach(async () => { await page.viewport(1280, 850); });

function mountPanels(options: {
  full?: boolean;
  selected?: boolean;
  adapter?: Partial<FlowerSurfaceAdapter>;
  capture?: FlowerSurfaceProps['captureNewConversationContext'];
  anchorHeight?: number;
} = {}) {
  const threads = options.selected ? [thread()] : [];
  const base = adapter(true);
  let snapshot = withModelDirectoryFixture(settingsSnapshot());
  const mutations = {
    ...options.adapter,
    ...(options.adapter?.saveDefaultPermission ? { saveDefaultPermission: vi.fn(async (permission: Parameters<FlowerSurfaceAdapter['saveDefaultPermission']>[0]) => {
      snapshot = withModelDirectoryFixture(await options.adapter!.saveDefaultPermission!(permission));
      return snapshot;
    }) } : {}),
    ...(options.adapter?.saveModelProfile ? { saveModelProfile: vi.fn(async (draft: Parameters<FlowerSurfaceAdapter['saveModelProfile']>[0]) => {
      snapshot = withModelDirectoryFixture(await options.adapter!.saveModelProfile!(draft));
      return snapshot;
    }) } : {}),
  };
  const surfaceAdapter = {
    ...base,
    loadSettings: async () => snapshot,
    loadModelDirectory: async () => snapshot.model_directory!,
    listThreads: vi.fn(async () => threads),
    loadThread: vi.fn(async () => liveBootstrap(thread())),
    connectLiveStream: vi.fn(async function* (input) {
      yield { schema_version: 3 as const, kind: 'ready' as const, baseline_complete: true, summaries: threads };
      await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }));
    }),
    ...mutations,
  } satisfies FlowerSurfaceAdapter;
  const runtime = document.createElement('div');
  const mount = document.createElement('div');
  const fullHost = document.createElement('div');
  Object.assign(fullHost.style, { width: '100%', height: '720px' });
  const anchor = document.createElement('div');
  Object.assign(anchor.style, { position: 'fixed', left: '12px', bottom: '12px', width: '360px', height: `${options.anchorHeight ?? 32}px` });
  const outside = document.createElement('button');
  outside.textContent = 'Outside';
  Object.assign(outside.style, { position: 'fixed', right: '12px', top: '12px' });
  document.body.append(runtime, fullHost, mount, anchor, outside);
  const [full, setFull] = createSignal(options.full ?? false);
  const [open, setOpen] = createSignal(false);
  const [phase, setPhase] = createSignal<BottomBarCompanionPhase>('collapsed');
  const [contentHost, setContentHost] = createSignal<HTMLElement>();
  const [settingsRequest, setSettingsRequest] = createSignal(0);
  const [composerFocus, setComposerFocus] = createSignal(0);
  const requestOpen = vi.fn(() => setOpen(true));
  const collapse = () => { outside.focus(); setOpen(false); };
  const dispose = render(() => <>
    <BottomBarCompanion retained visible={!full()} open={open()} anchor={anchor} mount={mount}
      id="panels-companion" label="Flower" class="flower-activity-companion" expandedWidth={544}
      contentHostRef={setContentHost} onPhaseChange={setPhase}
      isOwnedInteraction={event => event.target instanceof Element && Boolean(
        event.target.closest('.flower-settings-dialog')
        || event.target.closest('[data-floe-dialog-overlay-root]')?.querySelector('.flower-settings-dialog')
      )} onDismiss={reason => {
        if (reason !== 'escape') outside.focus();
        setOpen(false);
        if (reason === 'escape') setComposerFocus(value => value + 1);
      }} />
    <Show when={contentHost()}><Portal mount={full() ? fullHost : contentHost()!} ref={node => node.classList.add('flower-activity-product-portal')}>
      <FlowerSurface adapter={surfaceAdapter} draftCoordinator={createFlowerComposerDraftCoordinator()} notify={vi.fn()}
        presentation={full() ? 'full' : 'companion'} companionPresenceOwner
        companionOpen={full() || open() || phase() !== 'collapsed'} engaged={full() || open()} transcriptVisible={full() || open()}
        companionRegionID="panels-companion" onCompanionOpenRequest={requestOpen}
        settingsFocusRequest={settingsRequest()} focusComposerRequest={composerFocus()}
        focusThreadRequest={options.selected ? { request_id: 'initial', thread_id: 'thread-1' } : undefined}
        captureNewConversationContext={options.capture}
        headerTrailingActions={<Show when={!full()}><button type="button" aria-label="Collapse Flower" onClick={collapse}>Close</button></Show>}
      />
    </Portal></Show>
  </>, runtime);
  onTestFinished(() => { dispose(); runtime.remove(); fullHost.remove(); mount.remove(); anchor.remove(); outside.remove(); });
  return { root: () => document.querySelector<HTMLElement>('#redeven-flower-surface')!,
    mount, outside, full, open, phase, setFull, setOpen, collapse, requestOpen, surfaceAdapter,
    openSettings: () => setSettingsRequest(value => value + 1),
    focusComposer: () => setComposerFocus(value => value + 1) };
}

type Panels = ReturnType<typeof mountPanels>;
const editorFor = (fixture: Panels) => fixture.root().querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
async function ready(fixture: Panels) {
  await waitFor(() => !!fixture.root()?.querySelector('.flower-composer textarea:not(:disabled)'));
  await waitFor(() => fixture.mount.querySelector('[data-companion-frame-ready="true"]') !== null);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
async function settings(fixture: Panels) {
  fixture.openSettings();
  await waitFor(() => !!document.querySelector('.flower-settings-dialog .flower-settings-providers-section'));
  return document.querySelector<HTMLElement>('.flower-settings-surface')!;
}

it('restores the compact chat entry after leaving settings and retains the dialog form', async () => {
  const capture = vi.fn(() => ({ label: 'Files', title: 'Files', content: '{"page":"files"}' }));
  const fixture = mountPanels({ full: true, capture });
  await ready(fixture);
  const editor = editorFor(fixture);
  await userEvent.fill(editor, 'Retained draft');
  editor.setSelectionRange(2, 7);
  const panel = await settings(fixture);
  const disclosure = panel.querySelector<HTMLButtonElement>('.flower-settings-provider-disclosure')!;
  disclosure.click();
  expect(disclosure.getAttribute('aria-expanded')).toBe('true');
  fixture.outside.focus();
  fixture.setFull(false);
  await waitFor(() => fixture.phase() === 'collapsed');
  await waitFor(() => !document.querySelector('.flower-settings-dialog'));
  expect(panel.getClientRects()).toHaveLength(0);
  expect(editorFor(fixture)).toBe(editor);
  expect(editor.getBoundingClientRect().height).toBeGreaterThan(0);
  expect(fixture.root().dataset.flowerSidePanel).toBe('chat');
  expect(capture).toHaveBeenCalledTimes(1);
  await userEvent.click(editor);
  await waitFor(() => fixture.phase() === 'expanded');
  expect(fixture.root().dataset.flowerSidePanel).toBe('chat');
  expect(editor.value).toBe('Retained draft');
  expect(capture).toHaveBeenCalledTimes(2);
  await settings(fixture);
  expect(document.querySelector('.flower-settings-surface')).toBe(panel);
  expect(disclosure.getAttribute('aria-expanded')).toBe('true');
  expect(editor.isConnected).toBe(true);
  expect(fixture.surfaceAdapter.connectLiveStream).toHaveBeenCalledTimes(1);
});

it('keeps the ordinary editor mounted and inert while settings is active', async () => {
  const fixture = mountPanels({ full: true, selected: true });
  await ready(fixture);
  const editor = editorFor(fixture);
  await userEvent.fill(editor, 'Selection and draft');
  editor.setSelectionRange(2, 9);
  const panel = await settings(fixture);
  expect(editor.isConnected).toBe(true);
  expect(editor.closest('[inert]')).not.toBeNull();
  expect(editor.getBoundingClientRect().height).toBeGreaterThan(0);
  const modalFocus = document.activeElement;
  editor.focus();
  expect(document.activeElement).toBe(modalFocus);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => !document.querySelector('.flower-settings-dialog'));
  expect(editorFor(fixture)).toBe(editor);
  expect(editor.value).toBe('Selection and draft');
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 9]);
  expect(panel.closest('[inert]')).not.toBeNull();
  expect(panel.getClientRects()).toHaveLength(0);
});

it.each(['header', 'escape'] as const)('dismisses settings with %s while retaining the expanded companion', async reason => {
  const fixture = mountPanels({ selected: true });
  await ready(fixture);
  fixture.setOpen(true);
  await waitFor(() => fixture.phase() === 'expanded');
  const editor = editorFor(fixture);
  await userEvent.fill(editor, 'Existing conversation draft');
  editor.setSelectionRange(1, 5);
  const panel = await settings(fixture);
  if (reason === 'header') await userEvent.click(page.getByRole('button', { name: 'Close', exact: true }));
  else {
    panel.querySelector<HTMLButtonElement>('[role="radio"]')!.focus();
    await userEvent.keyboard('{Escape}');
  }
  await waitFor(() => !document.querySelector('.flower-settings-dialog'));
  expect(fixture.phase()).toBe('expanded');
  expect(fixture.root().dataset.flowerSidePanel).toBe('chat');
  expect(panel.getClientRects()).toHaveLength(0);
  expect(panel.closest('[inert]')).not.toBeNull();
  expect(editorFor(fixture)).toBe(editor);
  expect(editor.value).toBe('Existing conversation draft');
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([1, 5]);
  expect(fixture.root().dataset.flowerSelectedThreadId).toBe('thread-1');
  expect(fixture.surfaceAdapter.connectLiveStream).toHaveBeenCalledTimes(1);
});

it('opens chat when explicit editing reverses settings dismissal and preserves its form state', async () => {
  const fixture = mountPanels();
  await ready(fixture);
  fixture.setOpen(true);
  await waitFor(() => fixture.phase() === 'expanded');
  const editor = editorFor(fixture);
  await userEvent.fill(editor, 'IME draft');
  editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  const panel = await settings(fixture);
  const details = panel.querySelector<HTMLButtonElement>('.flower-settings-provider-disclosure')!;
  details.click();
  fixture.collapse();
  await waitFor(() => fixture.phase() === 'collapsing');
  editor.click();
  expect(fixture.open()).toBe(true);
  expect(fixture.root().dataset.flowerSidePanel).toBe('chat');
  await waitFor(() => fixture.phase() === 'expanded');
  expect(editorFor(fixture)).toBe(editor);
  expect(editor.value).toBe('IME draft');
  editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  await settings(fixture);
  expect(details.getAttribute('aria-expanded')).toBe('true');
  fixture.outside.focus();
  fixture.focusComposer();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(document.activeElement).not.toBe(editor);
  expect(fixture.surfaceAdapter.launchTurn).not.toHaveBeenCalled();
});

it.each(['success', 'failure'] as const)('preserves a pending settings save and its %s result across collapse', async outcome => {
  let resolveSave!: (value: Awaited<ReturnType<FlowerSurfaceAdapter['saveDefaultPermission']>>) => void;
  let rejectSave!: (reason: Error) => void;
  const saveDefaultPermission = vi.fn(() => new Promise<Awaited<ReturnType<FlowerSurfaceAdapter['saveDefaultPermission']>>>((resolve, reject) => {
    resolveSave = resolve; rejectSave = reject;
  }));
  const fixture = mountPanels({ adapter: { saveDefaultPermission } });
  await ready(fixture);
  fixture.setOpen(true);
  await waitFor(() => fixture.phase() === 'expanded');
  const panel = await settings(fixture);
  panel.querySelectorAll<HTMLButtonElement>('[role="radio"]')[2].click();
  await waitFor(() => saveDefaultPermission.mock.calls.length === 1);
  expect(panel.textContent).toContain('Saving');
  fixture.collapse();
  await waitFor(() => fixture.phase() === 'collapsed');
  expect(panel.isConnected).toBe(true);
  if (outcome === 'failure') rejectSave(new Error('Settings save unavailable'));
  else resolveSave(withModelDirectoryFixture({ ...await adapter(true).loadSettings(), defaults: { permission_type: 'full_access' } }));
  await waitFor(() => panel.textContent!.includes(outcome === 'failure' ? 'Settings save unavailable' : 'Saved'));
  await userEvent.click(editorFor(fixture));
  await waitFor(() => fixture.phase() === 'expanded');
  await settings(fixture);
  expect(document.querySelector('.flower-settings-surface')).toBe(panel);
  expect(panel.textContent).toContain(outcome === 'failure' ? 'Settings save unavailable' : 'Saved');
  expect(panel.querySelectorAll('[role="radio"]')[outcome === 'failure' ? 1 : 2].getAttribute('aria-checked')).toBe('true');
  expect(saveDefaultPermission).toHaveBeenCalledTimes(1);
});

it.each(['success', 'failure'] as const)('retains provider saving and its %s result when reopening chat', async outcome => {
  let resolveSave!: (value: Awaited<ReturnType<FlowerSurfaceAdapter['saveModelProfile']>>) => void;
  let rejectSave!: (reason: Error) => void;
  const saveModelProfile = vi.fn<FlowerSurfaceAdapter['saveModelProfile']>(() => new Promise((resolve, reject) => {
    resolveSave = resolve; rejectSave = reject;
  }));
  const fixture = mountPanels({ selected: true, adapter: { saveModelProfile } });
  await ready(fixture);
  fixture.setOpen(true);
  await waitFor(() => fixture.phase() === 'expanded');
  const editor = editorFor(fixture);
  await userEvent.fill(editor, 'Provider transition draft');
  const panel = await settings(fixture);
  const toggle = () => panel.querySelector<HTMLButtonElement>('.flower-settings-provider-toggle')!;
  await userEvent.click(toggle());
  await waitFor(() => saveModelProfile.mock.calls.length === 1);
  expect(toggle().getAttribute('aria-checked')).toBe('false');
  expect(toggle().disabled).toBe(true);
  expect(panel.querySelector('.flower-settings-title-feedback')!.textContent).toContain('Saving');
  fixture.collapse();
  await waitFor(() => fixture.phase() === 'collapsed');
  await userEvent.click(editor);
  await waitFor(() => fixture.phase() === 'expanded');
  expect(fixture.root().dataset.flowerSidePanel).toBe('chat');
  expect(editorFor(fixture)).toBe(editor);
  expect(editor.value).toBe('Provider transition draft');
  await settings(fixture);
  expect(document.querySelector('.flower-settings-surface')).toBe(panel);
  expect(toggle().disabled).toBe(true);
  expect(panel.querySelector('.flower-settings-title-feedback')!.textContent).toContain('Saving');
  if (outcome === 'failure') rejectSave(new Error('Provider save unavailable'));
  else resolveSave(withModelDirectoryFixture({
    ...await adapter(true).loadSettings(), model_profile: saveModelProfile.mock.calls[0][0].model_profile,
  }));
  await waitFor(() => !toggle().disabled);
  expect(toggle().getAttribute('aria-checked')).toBe(outcome === 'success' ? 'false' : 'true');
  expect(panel.textContent).toContain(outcome === 'success' ? 'Saved' : 'Provider save unavailable');
  expect(saveModelProfile).toHaveBeenCalledTimes(1);
  expect(fixture.surfaceAdapter.connectLiveStream).toHaveBeenCalledTimes(1);
});

function extensionsAdapter(): FlowerExtensionsAdapter {
  const catalog = { skills: [{ id: 'review', name: 'Review', description: 'Review changes.', path: '/skills/review/SKILL.md',
    scope: 'user', enabled: true, effective: true }], catalog_version: 1 };
  return {
    plugins: agentPluginsFixture(),
    canInteract: () => true, canAdmin: () => false,
    listSkills: vi.fn(async () => catalog), listSkillSources: vi.fn(async () => ({ items: [] })),
    toggleSkill: vi.fn(async () => catalog), createSkill: vi.fn(async () => catalog), deleteSkill: vi.fn(async () => catalog),
    reinstallSkill: vi.fn(async () => ({ catalog, reinstalled: [] })),
    validateSkillImport: vi.fn(async () => ({ resolved: [] })), importSkills: vi.fn(async () => ({ catalog, imports: [] })),
    browseSkillTree: vi.fn(async () => ({ root: '', dir: '', entries: [] })),
    browseSkillFile: vi.fn(async () => ({ root: '', file: '', encoding: 'utf8', truncated: false, size: 0, content: '' })),
    listMCP: vi.fn(async () => ({ servers: [] })), saveMCP: vi.fn(async () => ({ servers: [] })),
    checkMCP: vi.fn(async () => ({ servers: [] })), deleteMCP: vi.fn(async () => ({ servers: [] })),
  };
}

it('retains extensions tabs and filters while its shared header closes the companion', async () => {
  const extensions = extensionsAdapter();
  const fixture = mountPanels({ full: true, adapter: { extensions } });
  await ready(fixture);
  const editor = editorFor(fixture);
  fixture.root().querySelector<HTMLButtonElement>('.flower-sidebar-extensions-button')!.click();
  await waitFor(() => !!fixture.root().querySelector('.flower-extension-search input'));
  const panel = fixture.root().querySelector<HTMLElement>('.flower-extensions')!;
  const search = panel.querySelector<HTMLInputElement>('.flower-extension-search input')!;
  await userEvent.fill(search, 'Retained filter');
  panel.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click();
  await waitFor(() => vi.mocked(extensions.listMCP).mock.calls.length === 1);
  fixture.setOpen(true);
  fixture.setFull(false);
  await waitFor(() => fixture.phase() === 'expanded');
  panel.querySelector<HTMLButtonElement>('button[aria-label="Collapse Flower"]')!.click();
  await waitFor(() => fixture.phase() === 'collapsing');
  expect(fixture.root().dataset.flowerSidePanel).toBe('extensions');
  await waitFor(() => fixture.phase() === 'collapsed');
  expect(fixture.root().dataset.flowerSidePanel).toBe('chat');
  expect(panel.closest('[inert]')).not.toBeNull();
  expect(panel.getClientRects()).toHaveLength(0);
  await userEvent.click(editor);
  await waitFor(() => fixture.phase() === 'expanded');
  fixture.setFull(true);
  await waitFor(() => !!fixture.root().querySelector('.flower-sidebar-extensions-button'));
  fixture.root().querySelector<HTMLButtonElement>('.flower-sidebar-extensions-button')!.click();
  expect(fixture.root().querySelector('.flower-extensions')).toBe(panel);
  expect(search.value).toBe('Retained filter');
  expect(panel.querySelectorAll('[role="tab"]')[1].getAttribute('aria-selected')).toBe('true');
  expect(extensions.listMCP).toHaveBeenCalledTimes(1);
  expect(fixture.root().querySelectorAll('.flower-composer textarea')).toHaveLength(1);
  expect(editorFor(fixture)).toBe(editor);
});

it.each([{ theme: 'light', width: 1280, height: 32 }, { theme: 'dark', width: 360, height: 24 }])(
  'dissolves settings before restoring the entry in $theme at $width px with $height px anchor', async ({ theme, width, height }) => {
    await page.viewport(width, 850);
    const previousTheme = document.documentElement.className;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    onTestFinished(() => { document.documentElement.className = previousTheme; });
    const fixture = mountPanels({ anchorHeight: height });
    await ready(fixture);
    fixture.setOpen(true);
    await waitFor(() => fixture.phase() === 'expanded');
    const panel = await settings(fixture);
    const close = panel.querySelector<HTMLButtonElement>('button[aria-label="Collapse Flower"]')!;
    expect(document.querySelector('.flower-settings-dialog')!.getBoundingClientRect().right).toBeLessThanOrEqual(width);
    close.click();
    await waitFor(() => fixture.phase() === 'collapsing');
    const tail: number[] = [];
    while (fixture.phase() === 'collapsing') {
      if (fixture.mount.querySelector('#panels-companion')!.getBoundingClientRect().height < 80) {
        tail.push(Number(getComputedStyle(fixture.root()).opacity));
        expect(fixture.root().dataset.flowerSidePanel).toBe('settings');
      }
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    expect(tail.length).toBeGreaterThan(0);
    expect(Math.max(...tail)).toBeLessThanOrEqual(0.01);
    await waitFor(() => !document.querySelector('.flower-settings-dialog'));
    expect(panel.getClientRects()).toHaveLength(0);
    expect(fixture.mount.querySelector('#panels-companion')!.getBoundingClientRect().height).toBe(height);
    expect(editorFor(fixture).getBoundingClientRect().height).toBeGreaterThan(0);
  });
