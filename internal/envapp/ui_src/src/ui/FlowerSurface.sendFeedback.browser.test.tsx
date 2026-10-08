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
  let accept!: (value: Awaited<ReturnType<FlowerSurfaceAdapter['launchTurn']>>) => void;
  let reject!: (error: unknown) => void;
  const sent = vi.fn((_input: Parameters<FlowerSurfaceAdapter['launchTurn']>[0]) => new Promise<Awaited<ReturnType<FlowerSurfaceAdapter['launchTurn']>>>((resolve, fail) => {
    accept = resolve; reject = fail;
  }));
  const queued: FlowerLiveStreamEnvelope[] = [];
  let wake = () => {};
  const adapter: FlowerSurfaceAdapter = { ...base, launchTurn: sent, connectLiveStream: async function* ({ signal }) {
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
  return { sent, setRequest, accept: () => {
    const input = sent.mock.calls[0][0];
    accept({ client_request_id: input.client_request_id, thread_id: 'canvas-thread', current: {
      thread_id: 'canvas-thread', view_version: 1, activity: 'active', turn_id: 'turn', run_id: 'run',
      run_progress: { phase: 'waiting_response' }, queue: [], interactions: [],
      items: [{ id: `user:${input.client_request_id}`, turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'user', text: input.prompt }],
    } });
  }, reject: () => reject(new Error('Runtime unavailable')), push: (event: FlowerLiveStreamEnvelope) => { queued.push(event); wake(); } };
}

const editor = () => page.getByRole('textbox').last();
for (const embedded of [false, true]) {
  it(`shows immediate delivery feedback and continuous canonical progress in ${embedded ? 'canvas replies' : 'full Flower'}`, async () => {
    await page.viewport(1200, 800);
    const runtime = mount(embedded);
    await expect.element(editor()).toBeVisible();
    await editor().fill('Draw a service architecture');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
    const boundary = embedded ? '.tessiven-flower-conversation' : '.flower-chat-bottom-dock';
    const indicator = () => document.querySelector<HTMLElement>(`${boundary} .flower-model-status-indicator`);
    await expect.poll(() => indicator()?.textContent).toContain('Sending');
    expect(indicator()?.dataset.flowerProgressRequestId).toBe(runtime.sent.mock.calls[0][0].client_request_id);
    expect(indicator()?.dataset.flowerProgressRunId).toBeUndefined();
    expect(indicator()?.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')).toBe(true);
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
  await expect.poll(() => document.querySelector('.flower-model-status-indicator')).not.toBeNull();
  runtime.reject();
  await expect.poll(() => document.querySelector('.flower-model-status-indicator')).toBeNull();
  await expect.element(editor()).toHaveValue('Draw this canvas');
});

it('keeps pending delivery scoped to the originating canvas while another canvas remains editable', async () => {
  await page.viewport(1200, 800);
  const runtime = mount(true);
  await expect.element(editor()).toBeVisible();
  await editor().fill('Draw commerce');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  await expect.poll(() => document.querySelector('.flower-model-status-indicator')).not.toBeNull();
  runtime.setRequest({ selection: { canvas_id: 'analytics', version_id: 1, object_refs: [] }, labels: {}, nonce: 1 });
  await expect.poll(() => document.querySelector('.flower-model-status-indicator')).toBeNull();
  await editor().fill('Analytics draft');
  runtime.setRequest({ selection: { canvas_id: 'commerce', version_id: 1, object_refs: [] }, labels: {}, nonce: 2 });
  await expect.poll(() => document.querySelector('.flower-model-status-indicator')?.textContent).toContain('Sending');
  expect(runtime.sent).toHaveBeenCalledTimes(1);
  runtime.reject();
  await expect.poll(() => document.querySelector('.flower-model-status-indicator')).toBeNull();
  runtime.setRequest({ selection: { canvas_id: 'analytics', version_id: 1, object_refs: [] }, labels: {}, nonce: 3 });
  await expect.element(editor()).toHaveValue('Analytics draft');
});
