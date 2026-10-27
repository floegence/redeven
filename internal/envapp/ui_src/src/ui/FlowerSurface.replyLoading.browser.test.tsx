import '../index.css';
import './flower-feature.css';
import { afterEach, expect, it, onTestFinished, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import type { FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import type { EnvAppTranslationKey } from './i18n';
import { adapter, deferred, liveBootstrap, readStatus, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
afterEach(() => document.documentElement.classList.remove('dark'));

it.each([{ width: 1280, slow: true }, { width: 390, slow: true }, { width: 1280, slow: false }])('keeps a short reply stationary during catch-up: $width pixels, slow=$slow', async ({ width, slow }) => {
  await page.viewport(width, 900);
  document.documentElement.classList.add('dark');
  const i18n = createTestI18nHelpers('zh-CN');
  const copy = createLocalizedFlowerSurfaceCopy({ locale: 'zh-CN',
    t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
    tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
  const initial = thread({ thread_id: 'reply-loading', status: 'running', active_run_id: 'run',
    read_status: readStatus(false, 2), messages: [
      { id: 'hi', turn_id: 'turn', run_id: 'run', role: 'user', content: 'hi', status: 'complete', created_at_ms: 1 },
      { id: 'reply', turn_id: 'turn', run_id: 'run', role: 'assistant', content: 'Hi! What can I help you with today?', status: 'streaming', created_at_ms: 2 },
    ] });
  const completed = thread({ ...initial, status: 'success', active_run_id: undefined, run_progress: undefined,
    read_status: readStatus(false, 3), messages: initial.messages.map(message => ({ ...message, status: 'complete' as const })) });
  const summary = deferred<void>();
  const detail = deferred<ReturnType<typeof liveBootstrap>>();
  let finishing = false;
  const loadHistory = vi.fn(async () => finishing ? detail.promise : liveBootstrap(initial, 1));
  const root = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [initial], loadHistory,
    async *connectLiveStream({ signal }): AsyncIterable<FlowerLiveStreamEnvelope> {
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'reply-observer', summaries: [initial] };
      await summary.promise;
      if (signal.aborted) return;
      yield { schema_version: 3, kind: 'summary.batch', summaries: [completed] };
      if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  }, { copy, focusThreadRequest: { request_id: 'open-reply', thread_id: initial.thread_id } });
  root.style.cssText = 'height:780px;width:' + width + 'px';
  await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="reply"]'))
    && root.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
  await frames();
  const reply = root.querySelector<HTMLElement>('[data-flower-message-id="reply"]')!;
  const user = root.querySelector<HTMLElement>('[data-flower-message-id="hi"]')!;
  const viewport = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
  const before = { reply: reply.getBoundingClientRect().top, user: user.getBoundingClientRect().top, scroll: viewport.scrollTop };
  const initialHeight = viewport.scrollHeight;
  const initialViewport = viewport.getBoundingClientRect();
  const paintedFrames: number[][] = [];
  let sampleFrame = 0;
  const sample = () => {
    const bounds = viewport.getBoundingClientRect();
    paintedFrames.push([reply.getBoundingClientRect().top - before.reply, user.getBoundingClientRect().top - before.user,
      viewport.scrollHeight - initialHeight, bounds.top - initialViewport.top, bounds.height - initialViewport.height]);
    sampleFrame = requestAnimationFrame(sample);
  };
  sampleFrame = requestAnimationFrame(sample);
  onTestFinished(() => cancelAnimationFrame(sampleFrame));
  const verifyPaintedFrames = () => {
    cancelAnimationFrame(sampleFrame);
    expect(paintedFrames.length).toBeGreaterThan(0);
    expect(Math.max(...paintedFrames.flat().map(Math.abs))).toBeLessThanOrEqual(1);
    expect(viewport.querySelector('.flower-chat-notice')).toBeNull();
  };
  let notices = 0;
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof Element && (node.matches('.flower-history-loading-notice') || node.querySelector('.flower-history-loading-notice'))) notices++;
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  finishing = true;
  summary.resolve();
  await waitFor(() => loadHistory.mock.calls.length === 2);
  if (!slow) {
    detail.resolve(liveBootstrap(completed, 2));
    await new Promise(resolve => setTimeout(resolve, 250));
    observer.disconnect();
    expect(notices).toBe(0);
    expect(root.querySelector('[data-flower-message-id="reply"]')).toBe(reply);
    expect(Math.abs(reply.getBoundingClientRect().top - before.reply)).toBeLessThanOrEqual(1);
    expect(Math.abs(user.getBoundingClientRect().top - before.user)).toBeLessThanOrEqual(1);
    verifyPaintedFrames();
    return;
  }
  await waitFor(() => Boolean(root.querySelector('.flower-history-loading-notice')));
  await frames();
  expect(Math.abs(reply.getBoundingClientRect().top - before.reply)).toBeLessThanOrEqual(1);
  expect(Math.abs(user.getBoundingClientRect().top - before.user)).toBeLessThanOrEqual(1);
  expect(viewport.scrollTop).toBe(before.scroll);
  const notice = root.querySelector<HTMLElement>('.flower-history-loading-notice')!;
  expect(notice).not.toBeNull();
  expect(notice.closest('.flower-chat-transcript')).toBeNull();
  expect(notice.parentElement?.classList.contains('flower-chat-notices')).toBe(true);
  expect(getComputedStyle(notice.parentElement!).position).toBe('absolute');
  expect(root.querySelectorAll('.flower-history-loading-notice')).toHaveLength(1);
  expect(notice.getAttribute('role')).toBe('status');
  expect(notice.textContent).toBe(copy.chat.history.loading);
  expect(notice.querySelectorAll('.flower-thread-wave-bar')).toHaveLength(4);
  expect(getComputedStyle(notice.querySelector('.flower-thread-wave-bar')!).animationName).toBe('flower-thread-wave');
  const media = commands as unknown as { emulateMediaPreferences: (input: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
  try {
    await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
    expect(getComputedStyle(notice.querySelector('.flower-thread-wave-bar')!).animationName).toBe('none');
  } finally { await media.emulateMediaPreferences({ reducedMotion: 'no-preference' }); }
  await page.screenshot({ element: root, path: '__screenshots__/flower-reply-loading-' + width + '.png' });
  detail.resolve(liveBootstrap(completed, 2));
  await waitFor(() => !root.querySelector('.flower-history-loading-notice'));
  await frames();
  observer.disconnect();
  expect(notices).toBe(1);
  expect(root.querySelector('[data-flower-message-id="reply"]')).toBe(reply);
  expect(Math.abs(reply.getBoundingClientRect().top - before.reply)).toBeLessThanOrEqual(1);
  expect(Math.abs(user.getBoundingClientRect().top - before.user)).toBeLessThanOrEqual(1);
  expect(loadHistory).toHaveBeenCalledTimes(2);
  verifyPaintedFrames();
});
