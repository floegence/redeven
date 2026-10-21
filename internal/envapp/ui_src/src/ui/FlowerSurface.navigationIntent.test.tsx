// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapter, deferred, flush, liveBootstrap, renderSurfaceWithAdapter, renderSurfaceWithFocusController, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const summaries = ['a', 'b', 'c'].map(id => thread({ thread_id: id, title: 'Thread ' + id.toUpperCase(), messages: [{
  id: id + '-message', turn_id: id + '-turn', role: 'assistant', content: 'Body ' + id.toUpperCase(), status: 'complete', created_at_ms: 2,
}] }));
const select = (host: HTMLElement, id: string) => host.querySelector<HTMLButtonElement>('[data-thread-id="' + id + '"] .flower-thread-card-select-button')!.click();
const committed = (host: HTMLElement) => host.querySelector('main')?.getAttribute('data-flower-selected-thread-id');
const active = (host: HTMLElement) => host.querySelector('.flower-thread-card-active')?.getAttribute('data-thread-id');
function holdFrames() {
  let next = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callbacks.set(++next, callback); return next; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { callbacks.delete(id); });
  return () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(performance.now())); };
}
afterEach(() => vi.restoreAllMocks());

describe('Flower navigation intent', () => {
  it('acknowledges a cold target before committing its header, projection or request', async () => {
    const detail = deferred<ReturnType<typeof liveBootstrap>>();
    const loadThread = vi.fn(() => detail.promise);
    const host = renderSurfaceWithAdapter({ ...adapter(true), listThreads: async () => summaries, loadThread });
    await waitFor(() => !!host.querySelector('[data-thread-id="b"]'));
    const presentFrame = holdFrames();
    select(host, 'b');
    expect(active(host)).toBe('b');
    expect(committed(host)).toBe('');
    expect(host.querySelector<HTMLElement>('[data-flower-panel="chat"]')?.inert).toBe(false);
    expect(host.querySelector('.flower-chat-bottom-dock')?.hasAttribute('inert')).toBe(false);
    const oldInput = new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: 'blocked' });
    host.querySelector('textarea')!.dispatchEvent(oldInput);
    expect(oldInput.defaultPrevented).toBe(true);
    expect(host.querySelector('[data-flower-message-id="b-message"]')).toBeNull();
    expect(loadThread).not.toHaveBeenCalled();
    presentFrame();
    expect(host.querySelector<HTMLElement>('[data-flower-panel="chat"]')?.inert).toBe(false);
    expect(loadThread).not.toHaveBeenCalled();
    await flush();
    expect(committed(host)).toBe('');
    expect(loadThread).not.toHaveBeenCalled();
    presentFrame();
    expect(host.querySelector('.flower-chat-bottom-dock')?.hasAttribute('inert')).toBe(false);
    expect(host.querySelector('.flower-thread-navigation-status')).toBeNull();
    await flush();
    expect(committed(host)).toBe('');
    expect(loadThread).not.toHaveBeenCalled();
    presentFrame(); await flush();
    expect(committed(host)).toBe('');
    presentFrame(); await flush();
    expect(committed(host)).toBe('b');
    expect(loadThread).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.flower-thread-navigation-status')).toBeNull();
    expect(host.querySelector('.flower-thread-loading')).not.toBeNull();
    detail.resolve(liveBootstrap(summaries[1]));
    await waitFor(() => host.textContent?.includes('Body B') ?? false);
    expect(host.querySelector<HTMLElement>('[data-flower-panel="chat"]')?.inert).toBe(false);
  });

  it('retains the old header, body and draft until a warm target commits', async () => {
    const launchTurn = vi.fn(adapter(true).launchTurn);
    const loadThread = vi.fn(async (id: string) => liveBootstrap(summaries.find(value => value.thread_id === id)!));
    const host = renderSurfaceWithAdapter({ ...adapter(true), listThreads: async () => summaries, loadThread, launchTurn });
    await waitFor(() => !!host.querySelector('[data-thread-id="a"]'));
    for (const id of ['b', 'a']) { select(host, id); await waitFor(() => committed(host) === id && !!host.querySelector('[data-flower-message-id="' + id + '-message"]')); }
    const editor = host.querySelector<HTMLTextAreaElement>('textarea')!;
    editor.value = 'Draft owned by A';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const body = host.querySelector('[data-flower-message-id="a-message"]');
    expect(host.querySelector('.flower-thread-navigation-status')).toBeNull();
    const previousChatSibling = host.querySelector('[data-flower-panel="chat"]')?.previousElementSibling;
    const loads = loadThread.mock.calls.length;
    const presentFrame = holdFrames();
    select(host, 'b');
    expect(active(host)).toBe('b');
    expect(committed(host)).toBe('a');
    expect(host.querySelector('.flower-chat-header-title')?.textContent).toBe('Thread A');
    expect(host.querySelector('[data-flower-message-id="a-message"]')).toBe(body);
    expect(host.querySelector('[data-flower-message-id="b-message"]')).toBeNull();
    expect(editor.value).toBe('Draft owned by A');
    expect(host.querySelector('.flower-thread-navigation-status')).toBeNull();
    expect(host.querySelector('[data-flower-panel="chat"]')?.previousElementSibling).toBe(previousChatSibling);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    editor.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('[data-thread-id="b"] .flower-thread-card-select-button'));
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const send = host.querySelector<HTMLButtonElement>('.flower-composer-submit')!;
    expect(send).not.toBeNull();
    send.click();
    expect(launchTurn).not.toHaveBeenCalled();
    expect(loadThread).toHaveBeenCalledTimes(loads);
    presentFrame(); await flush(); presentFrame(); await flush(); presentFrame(); await flush(); presentFrame(); await flush();
    expect(committed(host)).toBe('b');
    expect(host.querySelector('.flower-chat-header-title')?.textContent).toBe('Thread B');
    expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
    select(host, 'a'); presentFrame(); await flush(); presentFrame(); await flush(); presentFrame(); await flush(); presentFrame(); await flush();
    expect(committed(host)).toBe('a');
    expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Draft owned by A');
  });

  it('blocks old composer Stop and approval actions while the rail points at another thread', async () => {
    const waiting = thread({ ...summaries[0], status: 'waiting_approval', permission_type: 'approval_required',
      approval_actions: [{ action_id: 'approval-date', turn_id: 'turn-fixture', run_id: 'run-fixture', origin: 'main_tool',
        tool_id: 'tool-date', tool_name: 'terminal.exec', state: 'requested', status: 'pending', requested_at_ms: 1,
        can_approve: true, summary: { label: 'Check date', command: 'date', targets: [] } }],
    });
    const stopThread = vi.fn(adapter(true).stopThread);
    const submitApproval = vi.fn(adapter(true).submitApproval);
    const host = renderSurfaceWithAdapter({ ...adapter(true), listThreads: async () => [waiting, summaries[1]],
      loadThread: async id => liveBootstrap(id === 'a' ? waiting : summaries[1]), stopThread, submitApproval });
    await waitFor(() => !!host.querySelector('[data-thread-id="a"]'));
    select(host, 'a'); await waitFor(() => !!host.querySelector('.flower-approval-decision-approve'));
    const approve = host.querySelector<HTMLButtonElement>('.flower-approval-decision-approve')!;
    const stop = host.querySelector<HTMLButtonElement>('.flower-composer-stop-thread')!;
    expect(stop).not.toBeNull();
    const presentFrame = holdFrames();
    select(host, 'b');
    approve.click(); stop.click();
    expect(submitApproval).not.toHaveBeenCalled();
    expect(stopThread).not.toHaveBeenCalled();
    expect(committed(host)).toBe('a');
    presentFrame(); await flush(); presentFrame(); await flush(); presentFrame(); await flush(); presentFrame(); await flush();
    expect(committed(host)).toBe('b');
    expect(submitApproval).not.toHaveBeenCalled();
    expect(stopThread).not.toHaveBeenCalled();
  });

  it('lets external focus and new chat supersede a pending rail selection', async () => {
    const loadThread = vi.fn(async (id: string) => liveBootstrap(summaries.find(value => value.thread_id === id)!));
    const control = renderSurfaceWithFocusController({ ...adapter(true), listThreads: async () => summaries, loadThread }, null);
    const host = control.runtime;
    await waitFor(() => !!host.querySelector('[data-thread-id="a"]'));
    select(host, 'a'); await waitFor(() => !!host.querySelector('[data-flower-message-id="a-message"]'));
    const presentFrame = holdFrames();
    select(host, 'b');
    control.setFocusThreadRequest({ request_id: 'focus-c', thread_id: 'c' });
    await flush();
    presentFrame(); await flush();
    expect(committed(host)).toBe('c');
    expect(loadThread.mock.calls.map(([id]) => id)).toEqual(['a', 'c']);
    select(host, 'b');
    host.querySelector<HTMLButtonElement>('.flower-new-chat-button')!.click();
    presentFrame(); await flush();
    expect(committed(host)).toBe('');
    expect(host.querySelector('main')?.hasAttribute('data-flower-pending-thread-id')).toBe(false);
    expect(loadThread.mock.calls.map(([id]) => id)).toEqual(['a', 'c']);
  });

  it('commits only the last target and cancels a pending move when returning to the current thread', async () => {
    const loadThread = vi.fn(async (id: string) => liveBootstrap(summaries.find(value => value.thread_id === id)!));
    const host = renderSurfaceWithAdapter({ ...adapter(true), listThreads: async () => summaries, loadThread });
    await waitFor(() => !!host.querySelector('[data-thread-id="a"]'));
    select(host, 'a'); await waitFor(() => !!host.querySelector('[data-flower-message-id="a-message"]'));
    const presentFrame = holdFrames();
    select(host, 'b'); select(host, 'c');
    expect(active(host)).toBe('c');
    expect(committed(host)).toBe('a');
    presentFrame(); await flush();
    expect(committed(host)).toBe('a');
    expect(loadThread.mock.calls.map(([id]) => id)).toEqual(['a']);
    select(host, 'b');
    expect(active(host)).toBe('b');
    presentFrame(); await flush();
    expect(committed(host)).toBe('a');
    select(host, 'c');
    presentFrame(); await flush();
    expect(committed(host)).toBe('a');
    presentFrame(); await flush();
    expect(committed(host)).toBe('a');
    presentFrame(); await flush();
    expect(committed(host)).toBe('a');
    presentFrame(); await flush();
    expect(committed(host)).toBe('c');
    expect(loadThread.mock.calls.map(([id]) => id)).toEqual(['a', 'c']);
    await waitFor(() => !!host.querySelector('[data-flower-message-id="c-message"]'));
    const body = host.querySelector('[data-flower-message-id="c-message"]');
    select(host, 'b'); select(host, 'c');
    expect(active(host)).toBe('c');
    expect(host.querySelector('main')?.hasAttribute('data-flower-pending-thread-id')).toBe(false);
    expect(host.querySelector<HTMLElement>('[data-flower-panel="chat"]')?.inert).toBe(false);
    presentFrame(); await flush();
    expect(committed(host)).toBe('c');
    expect(host.querySelector('[data-flower-message-id="c-message"]')).toBe(body);
    expect(loadThread.mock.calls.map(([id]) => id)).toEqual(['a', 'c']);
  });
});
