import '../index.css';
import './flower-feature.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { commands, page } from 'vitest/browser';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FlowerSurface, createFlowerComposerDraftCoordinator, type FlowerLiveStreamEnvelope, type FlowerSurfaceAdapter } from '../../../../flower_ui/src';
import { TessivenFlowerPanel, type CanvasFlowerRequest } from '../../../../tessiven_ui/src/TessivenFlowerPanel';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import { canvasFlowerAdapter } from '../styles/tessiven-flower.test-support';

let host: HTMLDivElement;
let dispose: (() => void) | undefined;
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('redeven-flower-transport');
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
});
afterEach(() => {
  dispose?.(); host?.remove();
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark', 'light');
});

function mount(embedded: boolean) {
  host = document.createElement('div');
  host.className = embedded ? 'tessiven' : '';
  host.style.cssText = 'position:absolute;inset:20px;width:calc(100% - 40px);height:700px';
  document.body.append(host);
  const base = canvasFlowerAdapter();
  const pending: Array<{ accept: (value: Awaited<ReturnType<FlowerSurfaceAdapter['launchTurn']>>) => void; reject: (error: unknown) => void }> = [];
  let preparation = Promise.resolve('storage-generation');
  let resumePreparation = () => {};
  const sent = vi.fn((_input: Parameters<FlowerSurfaceAdapter['launchTurn']>[0]) => new Promise<Awaited<ReturnType<FlowerSurfaceAdapter['launchTurn']>>>((resolve, fail) => {
    pending.push({ accept: resolve, reject: fail });
  }));
  const queued: FlowerLiveStreamEnvelope[] = [];
  let wake = () => {};
  const adapter: FlowerSurfaceAdapter = { ...base, launchTurn: sent, resolveStorageGeneration: () => preparation, connectLiveStream: async function* ({ signal }) {
    yield { schema_version: 1, kind: 'ready', summaries: [] };
    while (!signal.aborted) {
      const value = queued.shift();
      if (value) { yield value; continue; }
      await new Promise<void>(resolve => { wake = resolve; signal.addEventListener('abort', () => resolve(), { once: true }); });
    }
  } };
  const Surface = (props: Partial<Parameters<typeof FlowerSurface>[0]>) => {
    const drafts = createFlowerComposerDraftCoordinator();
    onCleanup(() => drafts.dispose());
    return <FlowerSurface adapter={adapter} draftCoordinator={drafts} notify={() => {}} {...props} />;
  };
  const [request, setRequest] = createSignal<CanvasFlowerRequest>({
    selection: { canvas_id: 'commerce', version_id: 1, object_refs: [] }, labels: {}, nonce: 0,
  });
  dispose = render(() => <FloeConfigProvider><LayoutProvider>
    {embedded ? <TessivenFlowerPanel request={request()} visible t={tessivenText('en-US')}
      onRemoveReference={() => {}} onOpenConversation={() => {}}
      renderSurface={props => <Surface {...props} presentation="companion" />} /> : <Surface />}
  </LayoutProvider></FloeConfigProvider>, host);
  let version = 0;
  const canonicalQueue: Array<{ id: string; request_key: string; input: { text: string }; created_at: string }> = [];
  return { sent, setRequest, pausePreparation: () => {
    preparation = new Promise(resolve => { resumePreparation = () => resolve('storage-generation'); });
  }, resumePreparation: () => resumePreparation(), accept: (index = 0, queued = false) => {
    const input = sent.mock.calls[index][0];
    const first = sent.mock.calls[0][0];
    if (queued) canonicalQueue.push({ id: `queue:${input.client_request_id}`, request_key: input.client_request_id, input: { text: input.prompt }, created_at: new Date().toISOString() });
    pending[index].accept({ client_request_id: input.client_request_id, thread_id: 'canvas-thread', current: {
      thread_id: 'canvas-thread', view_version: ++version, activity: 'active', turn_id: 'turn', run_id: 'run',
      run_progress: { phase: 'waiting_response' }, queue: [...canonicalQueue], interactions: [],
      items: [{ id: `user:${first.client_request_id}`, turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'user', text: first.prompt }],
    } });
  }, reject: (index = 0) => pending[index].reject(new Error('Runtime unavailable')), push: (event: FlowerLiveStreamEnvelope) => { queued.push(event); wake(); } };
}

const editor = () => page.getByRole('textbox').last();
for (const embedded of [false, true]) {
  it(`preserves edits made before ordinary admission in ${embedded ? 'canvas replies' : 'full Flower'}`, async () => {
    await page.viewport(1200, 800);
    const runtime = mount(embedded);
    await expect.element(editor()).toBeVisible();
    await editor().fill('Original request');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
    await editor().fill('Newer draft');
    document.querySelector('textarea')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(runtime.sent).toHaveBeenCalledTimes(1);
    runtime.accept();
    await expect.poll(() => document.querySelector('.flower-composer-submit')?.getAttribute('aria-busy')).not.toBe('true');
    await expect.element(editor()).toHaveValue('Newer draft');
    expect(runtime.sent.mock.calls[0][0].prompt).toBe('Original request');
  });

  it(`captures successive queued drafts before preparation or HTTP settles in ${embedded ? 'canvas replies' : 'full Flower'}`, async () => {
    await page.viewport(1200, 800);
    const runtime = mount(embedded);
    await expect.element(editor()).toBeVisible();
    await editor().fill('Start work');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
    runtime.accept();
    await expect.element(editor()).toHaveValue('');
    runtime.pausePreparation();
    await editor().fill('Queued A');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const rows = () => [...document.querySelectorAll<HTMLElement>('[data-flower-queued-turn-dock-id]')];
    await expect.poll(() => rows().length).toBe(1);
    const firstRow = rows()[0];
    expect(firstRow.textContent).toContain('Waiting to queue');
    expect(firstRow.querySelector('.animate-spin, .motion-safe\\:animate-spin')).toBeNull();
    await expect.element(editor()).toHaveValue('');
    await editor().fill('Queued B');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => rows().length).toBe(2);
    expect(rows().map(row => row.querySelector('.flower-queued-turn-label')?.textContent)).toEqual(['Queued A', 'Queued B']);
    expect(runtime.sent).toHaveBeenCalledTimes(1);
    await editor().fill('Keep editing');
    runtime.resumePreparation();
    await expect.poll(() => runtime.sent.mock.calls.length).toBe(2);
    runtime.accept(1, true);
    await expect.poll(() => runtime.sent.mock.calls.length).toBe(3);
    expect(rows()[0]).toBe(firstRow);
    expect(firstRow.getAttribute('data-flower-transport-outbox-id')).toBeNull();
    expect(firstRow.getAttribute('aria-label')).toBe('Queued: Queued A');
    runtime.accept(2, true);
    await expect.poll(() => document.querySelectorAll('[data-flower-transport-outbox-id]').length).toBe(0);
    await expect.element(editor()).toHaveValue('Keep editing');
  });

  it(`shows immediate delivery feedback and continuous canonical progress in ${embedded ? 'canvas replies' : 'full Flower'}`, async () => {
    await page.viewport(1200, 800);
    const runtime = mount(embedded);
    await expect.element(editor()).toBeVisible();
    await editor().fill('Draw a service architecture');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
    const boundary = embedded ? '.tessiven-flower-conversation' : '.flower-chat-bottom-dock';
    const indicator = () => document.querySelector<HTMLElement>(`${boundary} .flower-model-status-indicator`);
    await expect.element(editor()).toHaveValue('Draw a service architecture');
    expect(document.querySelector('.flower-composer-submit')?.getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector('[data-flower-transport-outbox-id]')).toBeNull();
    expect(indicator()).toBeNull();
    runtime.accept();
    const userID = `user:${runtime.sent.mock.calls[0][0].client_request_id}`;
    await expect.poll(() => indicator()?.dataset.flowerProgressRunId).toBe('run');
    expect(indicator()?.textContent).toContain('Waiting for model response');
    const retained = indicator();
    runtime.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'canvas-thread', current: {
      thread_id: 'canvas-thread', view_version: 2, activity: 'active', turn_id: 'turn', run_id: 'run',
      run_progress: { phase: 'streaming' }, queue: [], interactions: [],
      items: [{ id: userID, turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'user', text: 'Draw a service architecture' }],
    } });
    await expect.poll(() => indicator()?.dataset.flowerProgressKind).toBe('streaming');
    expect(indicator()).toBe(retained);
    if (embedded) {
      expect(host.querySelector('.tessiven-flower-composer .flower-model-status-lane')).toBeNull();
      const window = document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]')!;
      const rect = indicator()!.getBoundingClientRect(), bounds = window.getBoundingClientRect();
      expect(rect.top).toBeGreaterThan(bounds.top);
      expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
      for (const name of ['porcelain-light', 'porcelain-dark']) {
        const preset = builtInShellThemePresets.find(item => item.name === name)!;
        document.documentElement.classList.toggle('dark', preset.mode === 'dark');
        for (const [token, value] of Object.entries(preset.semanticTokens ?? {}))
          if (value) document.documentElement.style.setProperty(token, value);
        await page.screenshot({ element: window, path: `__screenshots__/flower-send-feedback-${name}.png` });
      }
      await page.viewport(390, 800);
      await expect.poll(() => window.getBoundingClientRect().right).toBeLessThanOrEqual(390);
      expect(indicator()!.scrollWidth).toBe(indicator()!.clientWidth);
      await page.screenshot({ element: window, path: '__screenshots__/flower-send-feedback-narrow.png' });
      const media = commands as unknown as { emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
      try {
        await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
        expect(indicator()?.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')).toBe(false);
        expect(indicator()?.textContent).toContain('Thinking');
      } finally {
        await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
      }
    }
    runtime.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'canvas-thread', current: {
      thread_id: 'canvas-thread', view_version: 3, activity: 'idle', queue: [], interactions: [],
      items: [{ id: userID, turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'user', text: 'Draw a service architecture' },
        { id: 'reply', turn_id: 'turn', run_id: 'run', ordinal: 2, kind: 'assistant', text: 'The canvas is ready.' }],
    } });
    await expect.poll(indicator).toBeNull();
    await expect.element(page.getByText('The canvas is ready.')).toBeVisible();
  });
}

it('clears delivery feedback after a rejected send without leaving an endless animation', async () => {
  await page.viewport(1200, 800);
  const runtime = mount(true);
  await expect.element(editor()).toBeVisible();
  await editor().fill('Draw this canvas');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  await expect.poll(() => document.querySelector('.flower-composer-submit')?.getAttribute('aria-busy')).toBe('true');
  runtime.reject();
  await expect.poll(() => document.querySelector('.flower-model-status-indicator')).toBeNull();
  await expect.element(editor()).toHaveValue('Draw this canvas');
  expect(document.querySelector('.flower-composer-submit')?.getAttribute('aria-busy')).not.toBe('true');
  await expect.element(page.getByRole('button', { name: 'Retry send', exact: true })).toBeEnabled();
});

it('keeps pending delivery scoped to the originating canvas while another canvas remains editable', async () => {
  await page.viewport(1200, 800);
  const runtime = mount(true);
  await expect.element(editor()).toBeVisible();
  await editor().fill('Draw commerce');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  await expect.poll(() => document.querySelector('.flower-composer-submit')?.getAttribute('aria-busy')).toBe('true');
  runtime.setRequest({ selection: { canvas_id: 'analytics', version_id: 1, object_refs: [] }, labels: {}, nonce: 1 });
  await expect.poll(() => document.querySelector('.flower-model-status-indicator')).toBeNull();
  await editor().fill('Analytics draft');
  runtime.setRequest({ selection: { canvas_id: 'commerce', version_id: 1, object_refs: [] }, labels: {}, nonce: 2 });
  await expect.poll(() => document.querySelector('.flower-composer-submit')?.getAttribute('aria-busy')).toBe('true');
  await expect.element(editor()).toHaveValue('Draw commerce');
  expect(runtime.sent).toHaveBeenCalledTimes(1);
  runtime.reject();
  await expect.poll(() => document.querySelector('.flower-model-status-indicator')).toBeNull();
  runtime.setRequest({ selection: { canvas_id: 'analytics', version_id: 1, object_refs: [] }, labels: {}, nonce: 3 });
  await expect.element(editor()).toHaveValue('Analytics draft');
});

for (const embedded of [false, true]) {
  it.each([1200, 390])(`keeps Send geometry and accessible loading stable in ${embedded ? 'canvas replies' : 'full Flower'} at %s px`, async width => {
    await page.viewport(width, 800);
    const runtime = mount(embedded);
    await expect.element(editor()).toBeVisible();
    await editor().fill('Preserve button size');
    const button = () => document.querySelector<HTMLButtonElement>('.flower-composer-submit')!;
    const size = () => { const rect = button().getBoundingClientRect(); return [rect.width, rect.height]; };
    const originalSize = size();
    expect(originalSize[0]).toBeGreaterThanOrEqual(28);
    expect(originalSize[1]).toBeGreaterThanOrEqual(28);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
    expect(size()).toEqual(originalSize);
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(button().disabled).toBe(true);
    expect(button().getAttribute('aria-label')).toBe('Sending');
    await editor().fill('New editable draft');
    expect(document.activeElement).toBe(document.querySelector('.flower-composer textarea'));
    runtime.accept();
    await expect.poll(() => button().getAttribute('aria-busy')).not.toBe('true');
    expect(size()).toEqual(originalSize);
    expect(button().disabled).toBe(false);
    expect(button().getAttribute('aria-label')).toBe('Send');
    await expect.element(editor()).toHaveValue('New editable draft');
    if (width === 390) await page.screenshot({ element: host, path: `__screenshots__/flower-send-button-${embedded ? 'canvas' : 'full'}-narrow.png` });
  });
}
