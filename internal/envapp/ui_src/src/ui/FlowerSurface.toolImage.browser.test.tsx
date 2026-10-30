import '../index.css';
import './flower-feature.css';
import { beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { streamingFixture } from '../../../../flower_ui/testing/streamingFixture';
import type { FlowerSubagentDetail } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { activityItem, activityTimeline, adapter, liveBootstrap, renderSurfaceWithAdapter, renderSurfaceWithAdapterProps, settingsSnapshot, subagentDetail, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';

beforeEach(() => page.viewport(1280, 900));

it('recovers from the read deadline, late responses, forbidden, missing, and corrupt images', async () => {
  const fixture = streamingFixture(3, 0);
  const current = fixture.current();
  const requests: Array<{ signal: AbortSignal; accept: (blob: Blob) => void; reject: (error: Error) => void }> = [];
  const loadToolImage = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise<Blob>((accept, reject) => requests.push({ signal, accept, reject })));
  fixture.replace({ ...current, items: [...current.items!, {
    id: 'deadline-image', ordinal: 4, kind: 'tool', turn_id: current.turn_id!, run_id: current.run_id!,
    activity: { item_id: 'deadline-image', tool_id: 'deadline-image', tool_name: 'image.read', kind: 'tool', status: 'success',
      presentation: { renderer: 'structured', target_refs: [{ kind: 'tool_image', label: 'deadline.png', resource_ref: 'image://' + 'd'.repeat(64) + '/png' }] } },
  }] });
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), ...fixture.adapter, loadToolImage }, {
    focusThreadRequest: { request_id: 'deadline-focus', thread_id: fixture.thread.thread_id }, layout: true,
  });
  await waitFor(() => Boolean(surface.querySelector('[data-flower-activity-item-id="deadline-image"]')));
  const row = surface.querySelector<HTMLElement>('[data-flower-activity-item-id="deadline-image"]')!;
  const toggle = row.querySelector<HTMLButtonElement>('[data-flower-disclosure-trigger]')!;
  toggle.click();
  await waitFor(() => requests.length === 1);
  const composer = surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  composer.focus();
  expect(document.activeElement).toBe(composer);
  expect(composer.disabled).toBe(false);
  expect(surface.querySelector<HTMLButtonElement>('[data-flower-primary-action="stop"]')?.disabled).toBe(false);
  await vi.waitFor(() => expect(row.querySelector('.chat-media-retry')).not.toBeNull(), { timeout: 17_000 });
  expect(requests[0]!.signal.aborted).toBe(true);
  expect(document.activeElement).toBe(composer);
  row.querySelector<HTMLButtonElement>('.chat-media-retry')!.click();
  await waitFor(() => requests.length === 2);
  toggle.click();
  await waitFor(() => row.dataset.state === 'closed');
  expect(requests[1]!.signal.aborted).toBe(true);
  toggle.click();
  await waitFor(() => requests.length === 3);
  const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 12;
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
  requests[0]!.accept(blob); requests[1]!.accept(blob);
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  expect(row.querySelector('.chat-media-image')).toBeNull();
  for (const message of ['403 Forbidden', '404 Not Found']) {
    requests.at(-1)!.reject(new Error(message));
    await waitFor(() => Boolean(row.querySelector('.chat-media-retry')));
    expect(requests.at(-1)!.signal.aborted).toBe(true);
    row.querySelector<HTMLButtonElement>('.chat-media-retry')!.click();
  }
  requests.at(-1)!.accept(new Blob(['corrupt'], { type: 'image/png' }));
  await waitFor(() => Boolean(row.querySelector('.chat-media-retry')));
  expect(requests.at(-1)!.signal.aborted).toBe(true);
  row.querySelector<HTMLButtonElement>('.chat-media-retry')!.click();
  requests.at(-1)!.accept(blob);
  await waitFor(() => Boolean(row.querySelector<HTMLImageElement>('.chat-media-image')?.naturalWidth));
  row.querySelector<HTMLButtonElement>('.chat-media-image-button')!.click();
  await waitFor(() => Boolean(document.querySelector('.chat-media-full-image')));
  document.querySelector<HTMLButtonElement>('[aria-label="Close preview"]')!.click();
  await waitFor(() => document.querySelector('.chat-media-full-image') === null);
  toggle.click();
  await waitFor(() => row.dataset.state === 'closed');
  expect(requests.every(request => request.signal.aborted)).toBe(true);
}, 30000);

it('authorizes parent and child images independently and releases child media on switch and close', async () => {
  const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 12;
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
  const loadToolImage = vi.fn(async (_input: { thread_id: string }) => blob);
  const loadMessageFile = vi.fn(async () => blob);
  const children = ['child-one', 'child-two'].map(thread_id => subagentSummary({ parent_thread_id: 'media-parent', thread_id, task_name: thread_id }));
  const resourceRef = 'image://' + 'c'.repeat(64) + '/png';
  const imageActivity = (id: string) => activityItem({ item_id: id, tool_id: id, tool_name: 'image.read', renderer: 'structured',
    target_refs: [{ kind: 'tool_image', label: 'chart.png', resource_ref: resourceRef }] });
  const parent = thread({ thread_id: 'media-parent', working_dir: '/parent-private', subagents: children, messages: [
    { id: 'parent-media', role: 'assistant', content: '', status: 'complete', created_at_ms: 1, turn_id: 'parent-turn', run_id: 'parent-run', blocks: [
      activityTimeline({ thread_id: 'media-parent', turn_id: 'parent-turn', run_id: 'parent-run', status: 'success', items: [imageActivity('parent-image'),
        activityItem({ item_id: 'spawn-media', tool_id: 'spawn-media', tool_name: 'subagents', renderer: 'subagent_operation',
          payload: { action: 'spawn', targets: children, requested_count: 2, completed_count: 0 } })] }),
    ] },
  ] });
  const loadSubagentDetail = vi.fn(async (_parent: string, child: string): Promise<FlowerSubagentDetail> => {
    const summary = children.find(value => value.thread_id === child)!;
    const base = subagentDetail({ summary });
    return { ...base, current: { ...base.current, activity: 'idle' as const, last_outcome: 'completed', items: [
      { id: child + '-image', turn_id: 'child-turn-1', run_id: 'child-run-1', ordinal: 1, kind: 'tool' as const,
        activity: { item_id: child + '-image', tool_id: child + '-image', tool_name: 'image.read', kind: 'tool', status: 'success',
          presentation: { renderer: 'structured', target_refs: [{ kind: 'tool_image', label: 'child.png', resource_ref: resourceRef }] } } },
      { id: child + '-relative', turn_id: 'child-turn-1', run_id: 'child-run-1', ordinal: 2, kind: 'assistant' as const, text: '![relative](./secret.png)' },
    ] } };
  });
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [parent], loadThread: async () => liveBootstrap(parent),
    loadToolImage, loadMessageFile, loadSubagentDetail }, { focusThreadRequest: { request_id: 'media-parent-focus', thread_id: parent.thread_id }, layout: true });
  await waitFor(() => Boolean(surface.querySelector('[data-flower-activity-item-id="parent-image"]')));
  surface.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="parent-image"] [data-flower-disclosure-trigger]')!.click();
  await waitFor(() => Boolean(surface.querySelector<HTMLImageElement>('.chat-media-image')?.naturalWidth));
  const parentImage = surface.querySelector<HTMLImageElement>('.chat-media-image')!;
  const parentURL = parentImage.src;
  surface.querySelector<HTMLButtonElement>('[data-flower-subagent-capsule]')!.click();
  await waitFor(() => Boolean(document.querySelector('.flower-subagent-detail-transcript')));
  const openChildImage = async (child: string) => {
    await waitFor(() => Boolean(document.querySelector('[data-flower-activity-item-id="' + child + '-image"]')));
    document.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="' + child + '-image"] [data-flower-disclosure-trigger]')!.click();
    await waitFor(() => Boolean(document.querySelector<HTMLImageElement>('.flower-subagent-detail-window .chat-media-image')?.naturalWidth));
    expect(loadToolImage).toHaveBeenLastCalledWith(expect.objectContaining({ thread_id: child, resource_ref: resourceRef }));
    expect(loadMessageFile).not.toHaveBeenCalled();
    const image = document.querySelector<HTMLImageElement>('.flower-subagent-detail-window .chat-media-image')!;
    const url = image.src;
    image.closest('button')!.click();
    await waitFor(() => Boolean(document.querySelector('.chat-media-full-image')));
    return url;
  };
  await openChildImage('child-one');
  document.querySelector<HTMLButtonElement>('[data-flower-subagent-switch="child-two"]')!.click();
  await waitFor(() => document.querySelector('.chat-media-full-image') === null);
  await openChildImage('child-two');
  document.querySelector<HTMLButtonElement>('.flower-subagent-detail-window button[aria-label*="Close"]')!.click();
  await waitFor(() => document.querySelector('.flower-subagent-detail-window') === null);
  await waitFor(() => document.querySelector('.chat-media-full-image') === null);
  expect(parentImage.isConnected).toBe(true);
  expect(parentImage.src).toBe(parentURL);
  expect(loadToolImage.mock.calls.map(call => (call[0] as { thread_id: string }).thread_id)).toEqual(['media-parent', 'child-one', 'child-two']);
}, 20000);

it.each([false, true])('retains a tool image and open preview through 300 complete thinking frames (nonempty decorations: %s)', async nonempty => {
  const fixture = streamingFixture(3, 0);
  const resourceRef = 'image://' + 'b'.repeat(64) + '/png';
  const initial = fixture.current();
  const imageItem = { id: 'stable-image', ordinal: 2, kind: 'tool' as const, turn_id: initial.turn_id!, run_id: initial.run_id!,
    activity: { item_id: 'stable-image', tool_id: 'stable-image', tool_name: 'image.read', kind: 'tool', status: 'success',
      presentation: { renderer: 'structured', target_refs: [{ kind: 'tool_image', label: 'chart.png', resource_ref: resourceRef }] } } };
  fixture.replace({ ...initial, items: [...initial.items!.filter(item => item.id !== 'streaming-tail'), imageItem,
    { ...initial.items!.at(-1)!, ordinal: 3, kind: 'thinking', text: 'Thinking 0' }] });
  const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 12;
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
  const loadToolImage = vi.fn(async () => blob);
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), ...fixture.adapter, loadToolImage }, {
    focusThreadRequest: { request_id: 'stable-image-focus', thread_id: fixture.thread.thread_id }, layout: true,
  });
  await waitFor(() => Boolean(surface.querySelector('[data-flower-activity-item-id="stable-image"]')));
  const row = surface.querySelector<HTMLElement>('[data-flower-activity-item-id="stable-image"]')!;
  row.querySelector<HTMLButtonElement>('[data-flower-disclosure-trigger]')!.click();
  await waitFor(() => Boolean(row.querySelector<HTMLImageElement>('.chat-media-image')?.naturalWidth));
  const image = row.querySelector<HTMLImageElement>('.chat-media-image')!;
  const url = image.src;
  const decoration = { decoration_id: 'image-compaction', kind: 'context_compaction' as const, ordinal: 0,
    anchor: { target_kind: 'message' as const, message_id: 'message-0', edge: 'after' as const },
    compaction: { operation_id: 'image-compaction', turn_id: initial.turn_id!, canonical_ordinal: 1,
      phase: 'complete' as const, status: 'compacted' as const, updated_at_ms: 1 } };
  const context = { model_context: null, context_usage: null, context_compactions: nonempty ? [decoration.compaction] : [],
    timeline_decorations: nonempty ? [decoration] : [] };
  fixture.replace({ ...fixture.current(), view_version: fixture.current().view_version + 1 }, structuredClone(context));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const thinkingToggle = surface.querySelector<HTMLButtonElement>('.flower-thinking-toggle')!;
  if (thinkingToggle.getAttribute('aria-expanded') !== 'true') thinkingToggle.click();
  await waitFor(() => surface.textContent?.includes('Thinking 0') === true);
  row.querySelector<HTMLButtonElement>('.chat-media-image-button')!.click();
  await waitFor(() => Boolean(document.querySelector('.chat-media-full-image')));
  const preview = document.querySelector('.chat-media-full-image');
  for (let index = 1; index <= 300; index++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const current = fixture.current();
    fixture.replace({ ...current, view_version: current.view_version + 1,
      items: current.items!.map(item => item.id === 'streaming-tail' ? { ...item, text: 'Thinking ' + index } : structuredClone(item)) }, {
      ...structuredClone(context),
    });
  }
  await waitFor(() => surface.textContent?.includes('Thinking 300') === true);
  expect(loadToolImage).toHaveBeenCalledTimes(1);
  expect(row.querySelector('.chat-media-image')).toBe(image);
  expect(image.src).toBe(url);
  expect(document.querySelector('.chat-media-full-image')).toBe(preview);
  expect(row.querySelector('.chat-media-placeholder')).toBeNull();
  document.querySelector<HTMLButtonElement>('[aria-label="Close preview"]')!.click();
  await waitFor(() => document.querySelector('.chat-media-full-image') === null);
}, 20000);

it.each([
  { width: 1280, resourceRef: 'image://' + 'a'.repeat(64) + '/png' },
  { width: 390, resourceRef: 'image://' + 'a'.repeat(64) + '/png' },
  { width: 1280, resourceRef: 'media:v1:' + 'a'.repeat(64) },
  { width: 390, resourceRef: 'media:v1:' + 'a'.repeat(64) },
])('shows authorized tool image $resourceRef with preview recovery at $width px', async ({ width, resourceRef }) => {
  await page.viewport(width, 900);
  const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 12;
  canvas.getContext('2d')!.fillRect(0, 0, 16, 12);
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
  const loadToolImage = vi.fn(async () => {
    if (loadToolImage.mock.calls.length === 1) throw new Error('Temporarily unavailable');
    return blob;
  });
  const loadMessageFile = vi.fn();
  const item = activityItem({ item_id: 'read-image', tool_id: 'read-image', tool_name: 'image.read', label: 'chart.png', renderer: 'structured',
    target_refs: [{ kind: 'tool_image', label: 'chart.png', resource_ref: resourceRef }] });
  const seed = thread({ thread_id: 'image-thread', messages: [{ id: 'image-result', turn_id: 'image-turn', role: 'assistant', status: 'complete', content: '', created_at_ms: 2,
    blocks: [activityTimeline({ thread_id: 'image-thread', turn_id: 'image-turn', run_id: 'image-run', status: 'success', items: [item] })] }] });
  const surface = renderSurfaceWithAdapterProps(
    { ...adapter(), listThreads: async () => [seed], loadThread: async () => liveBootstrap(seed, 1), loadToolImage, loadMessageFile },
    { focusThreadRequest: { request_id: 'focus-image', thread_id: seed.thread_id }, layout: true },
  );
  await waitFor(() => Boolean(surface.querySelector('[data-flower-activity-item-id="read-image"]')));
  const row = surface.querySelector<HTMLElement>('[data-flower-activity-item-id="read-image"]')!;
  const toggle = () => row.querySelector<HTMLButtonElement>('[data-flower-disclosure-trigger]')!.click();
  const expectCompactThumbnail = () => {
    const thumbnail = row.querySelector<HTMLElement>('[data-media-kind="image"]')!;
    const viewport = thumbnail.querySelector<HTMLElement>('.chat-media-viewport')!;
    expect(thumbnail.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(thumbnail.getBoundingClientRect().width).toBeLessThanOrEqual(320);
    expect(viewport.getBoundingClientRect().height).toBeLessThanOrEqual(180.5);
    expect(getComputedStyle(viewport).padding).toBe('0px');
    expect(getComputedStyle(viewport).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(viewport, '::before').display).toBe('none');
    expect(getComputedStyle(thumbnail.querySelector('.chat-media-header')!).display).toBe('none');
  };
  expect(row.querySelector('[data-media-kind="image"]')).toBeNull();
  toggle();
  const retry = () => [...surface.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Retry');
  await waitFor(() => Boolean(retry()));
  expectCompactThumbnail();
  retry()!.click();
  await waitFor(() => Boolean(surface.querySelector<HTMLImageElement>('.chat-media-image')?.naturalWidth));
  expect(loadToolImage).toHaveBeenCalledTimes(2);
  expect(loadToolImage).toHaveBeenLastCalledWith(expect.objectContaining({ thread_id: seed.thread_id, resource_ref: resourceRef, signal: expect.any(AbortSignal) }));
  expect(loadMessageFile).not.toHaveBeenCalled();
  expect(surface.querySelector('.chat-media-image')?.getAttribute('src')).toMatch(/^blob:/u);
  expectCompactThumbnail();
  row.querySelector<HTMLButtonElement>('.chat-media-image-button')!.click();
  await waitFor(() => Boolean(document.querySelector('.chat-media-full-image')));
  document.querySelector<HTMLButtonElement>('[aria-label="Close preview"]')!.click();
  await waitFor(() => document.querySelector('.chat-media-full-image') === null);
  toggle();
  await waitFor(() => row.dataset.state === 'closed');
  expect(row.querySelector('[data-media-kind="image"]')).toBeNull();
  toggle();
  await waitFor(() => Boolean(row.querySelector<HTMLImageElement>('.chat-media-image')?.naturalWidth));
  expectCompactThumbnail();
});

it('allows text and image models with retained image context', async () => {
  const base = settingsSnapshot();
  const snapshot = { ...base, model_profile: { ...base.model_profile!, providers: [{ ...base.model_profile!.providers[0], models: [
    { model_name: 'gpt-5.2', input_modalities: ['text', 'image'], context_window: 400000 },
    { model_name: 'text-only', input_modalities: ['text'], context_window: 400000 },
    { model_name: 'vision-next', input_modalities: ['text', 'image'], context_window: 400000 },
  ] }] } };
  const seed = thread();
  let revision = 1;
  const setThreadModel = vi.fn(async (_id: string, modelID: string) => {
    revision += 1;
    return liveBootstrap(thread({ model_id: modelID, settings_revision: revision }), revision);
  });
  const surface = renderSurfaceWithAdapter({ ...adapter(), loadSettings: async () => snapshot, persistDefaultModel: async () => snapshot, listThreads: async () => [seed], loadThread: async () => liveBootstrap(seed, 1), setThreadModel });
  await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"] button')));
  surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
  await waitFor(() => {
    const main = surface.querySelector('main');
    return main?.getAttribute('data-flower-selected-thread-id') === seed.thread_id
      && !main.hasAttribute('data-flower-pending-thread-id')
      && main.getAttribute('data-flower-selected-thread-loading') === 'false';
  });
  await waitFor(() => surface.querySelector('.flower-model-reasoning-model-label')?.textContent?.includes('gpt-5.2') === true);
  const choose = async (name: string) => {
    surface.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger')!.click();
    await waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('.flower-model-menu-item')].some(button => button.textContent?.includes(name)));
    [...document.querySelectorAll<HTMLButtonElement>('.flower-model-menu-item')].find(button => button.textContent?.includes(name))!.click();
  };
  await choose('text-only');
  await waitFor(() => surface.querySelector('.flower-model-reasoning-model-label')?.textContent?.includes('text-only') === true);
  await choose('vision-next');
  await waitFor(() => surface.querySelector('.flower-model-reasoning-model-label')?.textContent?.includes('vision-next') === true);
  expect(setThreadModel).toHaveBeenCalledTimes(2);
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')?.disabled).toBe(false);
});
