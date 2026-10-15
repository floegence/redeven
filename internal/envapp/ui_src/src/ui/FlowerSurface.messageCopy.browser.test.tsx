import '../index.css';
import './flower-feature.css';

import { expect, it, onTestFinished, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { streamingFixture } from '../../../../flower_ui/testing/streamingFixture';
import {
  adapter,
  deferred,
  flowerSurfaceNotifications,
  liveBootstrap,
  renderSurfaceWithAdapterProps,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

it('copies assistant output and shows a temporary checkmark', async () => {
  const text = 'Inspect the workspace before changing the configuration.';
  const snapshot = thread({ messages: [{
    id: 'assistant-copy', turn_id: 'turn-copy', role: 'assistant',
    content: text, status: 'complete', created_at_ms: 2,
    blocks: [{ type: 'markdown', content: text }],
  }] });
  const pending = deferred<void>();
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockReturnValue(pending.promise);
  onTestFinished(() => write.mockRestore());
  const runtime = renderSurfaceWithAdapterProps({
    ...adapter(),
    listThreads: vi.fn(async () => [snapshot]),
    loadThread: vi.fn(async () => liveBootstrap(snapshot)),
  }, { focusThreadRequest: { request_id: 'copy', thread_id: snapshot.thread_id } });
  await waitFor(() => Boolean(runtime.querySelector('.flower-message-copy-button-assistant')));
  const button = runtime.querySelector<HTMLButtonElement>('.flower-message-copy-button-assistant')!;
  await userEvent.click(button);
  expect(write).toHaveBeenCalledWith(text);
  expect(button.dataset.copied).toBe('false');
  pending.resolve();
  await waitFor(() => button.dataset.copied === 'true');
  expect(button.getAttribute('aria-label')).toBe('Copied');
  await waitFor(() => getComputedStyle(button.querySelector('.flower-message-copy-icon-copied')!).opacity === '1');
  await waitFor(() => button.dataset.copied === 'false', 2500);
  expect(button.getAttribute('aria-label')).toBe('Copy message');
  await waitFor(() => getComputedStyle(button.querySelector('.flower-message-copy-icon-idle')!).opacity === '1');
});

it('copies the latest streamed text after live updates and retains copied feedback', async () => {
  const fixture = streamingFixture(2, 0);
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  onTestFinished(() => write.mockRestore());
  const runtime = renderSurfaceWithAdapterProps(fixture.adapter, {
    focusThreadRequest: { request_id: 'stream-copy', thread_id: fixture.thread.thread_id },
  });
  const message = () => runtime.querySelector('[data-flower-message-id="streaming-tail"]')!;
  await waitFor(() => Boolean(message()?.querySelector('.flower-message-copy-button')));
  fixture.append('The complete result is ready.');
  await waitFor(() => Boolean(message()?.textContent?.includes('The complete result is ready.')));
  const button = message().querySelector<HTMLButtonElement>('.flower-message-copy-button')!;
  await userEvent.click(button);
  expect(write).toHaveBeenLastCalledWith('# Streaming answer\n\nThe complete result is ready.');
  await waitFor(() => button.dataset.copied === 'true');
  fixture.append(' Continue with verification.');
  await waitFor(() => Boolean(message()?.textContent?.includes('Continue with verification.')));
  expect(message().querySelector('.flower-message-copy-button')).toBe(button);
  expect(button.dataset.copied).toBe('true');
  await waitFor(() => getComputedStyle(button.querySelector('.flower-message-copy-icon-copied')!).opacity === '1');
  await userEvent.click(button);
  expect(write).toHaveBeenLastCalledWith('# Streaming answer\n\nThe complete result is ready. Continue with verification.');
  fixture.replace({ ...fixture.current(), view_version: fixture.current().view_version + 1, activity: 'idle',
    items: fixture.current().items?.map(item => ({ ...item, live: false })) });
  await waitFor(() => message().getAttribute('data-flower-message-status') === 'complete');
  expect(message().querySelector('.flower-message-copy-button')).toBe(button);
  await waitFor(() => button.dataset.copied === 'false', 2500);
  await userEvent.click(button);
  expect(write).toHaveBeenLastCalledWith('# Streaming answer\n\nThe complete result is ready. Continue with verification.');
  await waitFor(() => button.dataset.copied === 'true');
});

it('reports clipboard failures without showing a copied checkmark', async () => {
  const fixture = streamingFixture(2, 0);
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard permission denied.'));
  const legacy = vi.spyOn(document, 'execCommand').mockReturnValue(false);
  onTestFinished(() => { write.mockRestore(); legacy.mockRestore(); });
  const runtime = renderSurfaceWithAdapterProps(fixture.adapter, {
    focusThreadRequest: { request_id: 'failed-copy', thread_id: fixture.thread.thread_id },
  });
  await waitFor(() => Boolean(runtime.querySelector('.flower-message-copy-button-assistant')));
  const button = runtime.querySelector<HTMLButtonElement>('.flower-message-copy-button-assistant')!;
  await userEvent.click(button);
  await waitFor(() => flowerSurfaceNotifications().some(notice => notice.message === 'Clipboard permission denied.'));
  expect(button.dataset.copied).toBe('false');
  expect(button.getAttribute('aria-label')).toBe('Copy message');
  expect(getComputedStyle(button.querySelector('.flower-message-copy-icon-copied')!).opacity).toBe('0');
});

it('preserves user message copying and keeps feedback scoped to the copied message', async () => {
  const fixture = streamingFixture(2, 0);
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  onTestFinished(() => write.mockRestore());
  const runtime = renderSurfaceWithAdapterProps(fixture.adapter, {
    focusThreadRequest: { request_id: 'user-copy', thread_id: fixture.thread.thread_id },
  });
  await waitFor(() => Boolean(runtime.querySelector('.flower-message-copy-button-user')));
  const userButton = runtime.querySelector<HTMLButtonElement>('.flower-message-copy-button-user')!;
  const assistantButton = runtime.querySelector<HTMLButtonElement>('.flower-message-copy-button-assistant')!;
  await userEvent.click(userButton);
  expect(write).toHaveBeenLastCalledWith(fixture.current().items![0].text!.trim());
  await waitFor(() => userButton.dataset.copied === 'true');
  fixture.append('Unrelated assistant update.');
  await waitFor(() => Boolean(runtime.textContent?.includes('Unrelated assistant update.')));
  expect(runtime.querySelector('.flower-message-copy-button-user')).toBe(userButton);
  expect(userButton.dataset.copied).toBe('true');
  await userEvent.click(assistantButton);
  await waitFor(() => assistantButton.dataset.copied === 'true');
  expect(userButton.dataset.copied).toBe('false');
  expect(userButton.getAttribute('aria-label')).toBe('Copy message');
});
