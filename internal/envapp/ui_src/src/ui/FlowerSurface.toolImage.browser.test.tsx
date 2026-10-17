import '../index.css';
import './flower-feature.css';
import { beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { activityItem, activityTimeline, adapter, flowerSurfaceNotifications, liveBootstrap, renderSurfaceWithAdapter, renderSurfaceWithAdapterProps, settingsSnapshot, thread, waitFor } from './FlowerSurface.navigation.testHarness';

beforeEach(() => page.viewport(1280, 900));

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

it('retains the compatible model after an image-context rejection and allows another model', async () => {
  const base = settingsSnapshot();
  const snapshot = { ...base, model_profile: { ...base.model_profile!, providers: [{ ...base.model_profile!.providers[0], models: [
    { model_name: 'gpt-5.2', input_modalities: ['text', 'image'], context_window: 400000 },
    { model_name: 'text-only', input_modalities: ['text'], context_window: 400000 },
    { model_name: 'vision-next', input_modalities: ['text', 'image'], context_window: 400000 },
  ] }] } };
  const seed = thread();
  const setThreadModel = vi.fn(async (_id: string, modelID: string) => {
    if (modelID === 'openai/text-only') throw Object.assign(new Error('Private backend details'), { code: 'thread_image_model_unsupported' });
    return liveBootstrap(thread({ model_id: modelID, settings_revision: 2 }), 2);
  });
  const surface = renderSurfaceWithAdapter({ ...adapter(), loadSettings: async () => snapshot, listThreads: async () => [seed], loadThread: async () => liveBootstrap(seed, 1), setThreadModel });
  await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"] button')));
  surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
  await waitFor(() => surface.querySelector('.flower-model-reasoning-model-label')?.textContent?.includes('gpt-5.2') === true);
  const choose = async (name: string) => {
    surface.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger')!.click();
    await waitFor(() => Boolean(document.querySelector('.flower-model-menu')));
    [...document.querySelectorAll<HTMLButtonElement>('.flower-model-menu-item')].find(button => button.textContent?.includes(name))!.click();
  };
  await choose('text-only');
  await waitFor(() => flowerSurfaceNotifications().some(notification => notification.message.includes('image')));
  expect(flowerSurfaceNotifications().at(-1)?.message).not.toContain('Private backend details');
  expect(surface.querySelector('.flower-model-reasoning-model-label')?.textContent).toContain('gpt-5.2');
  await choose('vision-next');
  await waitFor(() => surface.querySelector('.flower-model-reasoning-model-label')?.textContent?.includes('vision-next') === true);
  expect(setThreadModel).toHaveBeenCalledTimes(2);
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')?.disabled).toBe(false);
});
