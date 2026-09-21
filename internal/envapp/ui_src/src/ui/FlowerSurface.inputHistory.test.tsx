// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import {
  adapter, inputRequest, liveBootstrap, renderSurfaceWithAdapter, renderSurfaceWithAdapterProps,
  renderSurfaceWithDraftCoordinator, thread, waitFor,
} from './FlowerSurface.navigation.testHarness';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});

function historyAdapter() {
  const value = thread({ messages: [
    { id: 'old', turn_id: 't1', role: 'user', content: '第一行\n第二行 🙂', status: 'complete', created_at_ms: 1 },
    { id: 'answer', turn_id: 't1', role: 'assistant', content: 'An answer', status: 'complete', created_at_ms: 2 },
    { id: 'recent', turn_id: 't2', role: 'user', content: 'Latest input', status: 'complete', created_at_ms: 3 },
  ] });
  return { ...adapter(),
    listThreads: vi.fn(async () => [value]),
    loadThread: vi.fn(async () => liveBootstrap(value)),
  };
}

async function selectComposer(runtime: HTMLElement) {
  await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-1"] button')));
  (runtime.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
  await waitFor(() => runtime.querySelector('[data-flower-selected-thread-loading="false"]') !== null
    && runtime.textContent?.includes('Latest input') === true);
  const editor = runtime.querySelector('.flower-composer textarea') as HTMLTextAreaElement;
  editor.focus();
  return editor;
}

function press(editor: HTMLTextAreaElement | HTMLInputElement, key: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
  editor.dispatchEvent(event);
  return event;
}

describe('Flower input history', () => {
  it('recalls only user text, traverses both ends and never sends implicitly', async () => {
    const host = historyAdapter();
    const editor = await selectComposer(renderSurfaceWithAdapter(host));
    expect(press(editor, 'ArrowDown').defaultPrevented).toBe(false);
    expect(press(editor, 'ArrowUp').defaultPrevented).toBe(true);
    expect(editor.value).toBe('Latest input');
    expect(editor.selectionStart).toBe(editor.value.length);
    press(editor, 'ArrowUp'); expect(editor.value).toBe('第一行\n第二行 🙂');
    press(editor, 'ArrowUp'); expect(editor.value).toBe('第一行\n第二行 🙂');
    press(editor, 'ArrowDown'); expect(editor.value).toBe('Latest input');
    press(editor, 'ArrowDown'); expect(editor.value).toBe('');
    press(editor, 'ArrowUp'); press(editor, 'Escape'); expect(editor.value).toBe('');
    expect(host.launchTurn).not.toHaveBeenCalled();
  });

  it('keeps shared attachments, references and external drafts intact', async () => {
    const coordinator = createFlowerComposerDraftCoordinator();
    const session = coordinator.open('thread-1');
    const references = [{ local_id: 'ref', kind: 'file' as const, path: '/workspace/test.ts', label: 'test.ts' }];
    const attachments = [{ local_id: 'attachment', source: 'file' as const, name: 'draft.txt',
      mime_type: 'text/plain', size_bytes: 12, upload_request_id: 'upload', attempt_state: 'reselect_required' }];
    session.mutate(value => ({ ...value, references, attachments }));
    const editor = await selectComposer(renderSurfaceWithDraftCoordinator(historyAdapter(), coordinator));
    press(editor, 'ArrowUp');
    expect(session.snapshot().value.text).toBe('Latest input');
    expect(session.snapshot().value.references).toEqual(references);
    expect(session.snapshot().value.attachments).toEqual(attachments);
    press(editor, 'Escape');
    expect(session.snapshot().value.text).toBe('');
    expect(session.snapshot().value.references).toEqual(references);
    expect(session.snapshot().value.attachments).toEqual(attachments);
    press(editor, 'ArrowUp');
    session.mutate(value => ({ ...value, text: 'Changed elsewhere' }));
    expect(editor.value).toBe('Changed elsewhere');
    expect(press(editor, 'ArrowDown').defaultPrevented).toBe(false);
    expect(press(editor, 'Escape').defaultPrevented).toBe(false);
    expect(editor.value).toBe('Changed elsewhere');
  });

  it('ends local browsing when another surface writes identical text', async () => {
    const coordinator = createFlowerComposerDraftCoordinator();
    const editor = await selectComposer(renderSurfaceWithDraftCoordinator(historyAdapter(), coordinator));
    press(editor, 'ArrowUp');
    coordinator.open('thread-1').mutate(value => ({ ...value, text: 'Latest input' }));
    expect(press(editor, 'Escape').defaultPrevented).toBe(false);
    expect(editor.value).toBe('Latest input');
  });

  it('retains recalled text when the surface hides and becomes visible again', async () => {
    const [engaged, setEngaged] = createSignal(true);
    const editor = await selectComposer(renderSurfaceWithAdapterProps(historyAdapter(), { get engaged() { return engaged(); } }));
    press(editor, 'ArrowUp');
    setEngaged(false);
    setEngaged(true);
    editor.focus();
    expect(press(editor, 'Escape').defaultPrevented).toBe(false);
    expect(editor.value).toBe('Latest input');
  });

  it('does not overwrite whitespace or consume IME and selection shortcuts', async () => {
    const editor = await selectComposer(renderSurfaceWithAdapter(historyAdapter()));
    for (const extra of [{ isComposing: true }, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(press(editor, 'ArrowUp', extra).defaultPrevented).toBe(false);
      expect(editor.value).toBe('');
    }
    editor.value = '\n ';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(press(editor, 'ArrowUp').defaultPrevented).toBe(false);
    expect(editor.value).toBe('\n ');
  });

  it('accepts a recalled input as an ordinary draft when editing starts', async () => {
    const editor = await selectComposer(renderSurfaceWithAdapter(historyAdapter()));
    press(editor, 'ArrowUp');
    press(editor, 'ArrowLeft');
    expect(press(editor, 'ArrowDown').defaultPrevented).toBe(false);
    expect(editor.value).toBe('Latest input');
    editor.value = 'Edited input';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(press(editor, 'Escape').defaultPrevented).toBe(false);
    expect(editor.value).toBe('Edited input');
  });

  it('submits recalled text only after an explicit Enter', async () => {
    const host = historyAdapter();
    const editor = await selectComposer(renderSurfaceWithAdapter(host));
    press(editor, 'ArrowUp');
    expect(host.launchTurn).not.toHaveBeenCalled();
    press(editor, 'Enter');
    await waitFor(() => vi.mocked(host.launchTurn).mock.calls.length === 1);
    expect(vi.mocked(host.launchTurn).mock.calls[0]?.[0]).toMatchObject({ prompt: 'Latest input', thread_id: 'thread-1' });
  });

  it.each([false, true])('never recalls into structured answers (secret=%s)', async (secret) => {
    const host = historyAdapter();
    const request = inputRequest({ questions: [{ id: 'answer', header: 'Answer', question: 'Answer', response_mode: 'write',
      ...(secret ? { is_secret: true } : {}),
    }] });
    host.loadThread = vi.fn(async () => liveBootstrap(thread({ status: 'waiting_user', input_request: request })));
    const runtime = renderSurfaceWithAdapterProps(host, { focusThreadRequest: { request_id: 'question', thread_id: 'thread-1' } });
    await waitFor(() => runtime.querySelector('[data-flower-selected-thread-loading="false"]') !== null
      && runtime.querySelector(secret ? '.flower-composer input[type="password"]' : '.flower-composer textarea') !== null);
    const editor = runtime.querySelector(secret ? '.flower-composer input[type="password"]' : '.flower-composer textarea') as HTMLTextAreaElement;
    editor.focus();
    expect(press(editor, 'ArrowUp').defaultPrevented).toBe(false);
    expect(editor.value).toBe('');
  });

  it('resets across thread selection while retaining each thread draft', async () => {
    const host = historyAdapter();
    const other = thread({ thread_id: 'thread-2', title: 'Other thread' });
    const originalLoad = host.loadThread;
    host.listThreads = vi.fn(async () => [thread(), other]);
    host.loadThread = vi.fn(async (id?: string) => id === 'thread-2' ? liveBootstrap(other) : originalLoad());
    const runtime = renderSurfaceWithAdapter(host);
    const editor = await selectComposer(runtime);
    press(editor, 'ArrowUp');
    (runtime.querySelector('[data-thread-id="thread-2"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-selected-thread-id="thread-2"][data-flower-selected-thread-loading="false"]') !== null);
    editor.focus(); press(editor, 'ArrowUp'); expect(editor.value).toBe('Plan deploy');
    (runtime.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
    await waitFor(() => editor.value === 'Latest input');
    editor.focus(); expect(press(editor, 'Escape').defaultPrevented).toBe(false);
    expect(editor.value).toBe('Latest input');
  });
});
