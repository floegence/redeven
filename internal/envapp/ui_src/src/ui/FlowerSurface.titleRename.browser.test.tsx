import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import '../index.css';
import './flower-feature.css';
import { adapter, deferred, flush, liveBootstrap, renderSurfaceWithAdapter, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const touchCommands = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
beforeEach(() => page.viewport(1280, 900));
afterEach(() => touchCommands.emulateTouchInput(false));

async function setup(otherThreads: ReturnType<typeof thread>[] = []) {
  const initial = thread({ title: 'Review the deployment plan', title_status: 'ready', title_generation: 2 });
  let revision = 1;
  const renameThread = vi.fn(async (threadID: string, title: string) => {
    revision += 1;
    return liveBootstrap(thread({
      ...initial, thread_id: threadID, title, title_status: 'ready', title_generation: revision + 1,
    }), revision);
  });
  const runtime = renderSurfaceWithAdapter({
    ...adapter(true),
    listThreads: vi.fn(async () => [initial, ...otherThreads]),
    loadThread: vi.fn(async (threadID: string) => liveBootstrap(otherThreads.find(thread => thread.thread_id === threadID) ?? initial)),
    renameThread,
  });
  await waitFor(() => !!runtime.querySelector('[data-thread-id="thread-1"] button'));
  expect(runtime.querySelector('.flower-chat-header-rename')).toBeNull();
  runtime.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
  await waitFor(() => !!runtime.querySelector('.flower-chat-header-rename'));
  return { runtime, renameThread, initial };
}

describe('Flower title rename shortcut', () => {
  it('preserves pencil focus while a deferred conversation selection finishes', async () => {
    const initial = thread({ title: 'Deferred selection', title_status: 'ready' });
    const detail = deferred<ReturnType<typeof liveBootstrap>>();
    const loadThread = vi.fn(() => detail.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true), listThreads: vi.fn(async () => [initial]), loadThread, renameThread: vi.fn(),
    });
    await waitFor(() => !!runtime.querySelector('[data-thread-id="thread-1"] button'));
    runtime.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
    const trigger = runtime.querySelector<HTMLButtonElement>('.flower-chat-header-rename')!;
    trigger.focus();
    await waitFor(() => loadThread.mock.calls.length > 0);
    detail.resolve(liveBootstrap(initial));
    await waitFor(() => !!runtime.querySelector('.flower-composer textarea'));
    await flush();
    expect(document.activeElement).toBe(trigger);
    await userEvent.keyboard('{Enter}');
    expect(runtime.querySelector('.flower-chat-header-title-input')).not.toBeNull();
  });

  it('selects the current title, saves with Enter and restores focus to the pencil', async () => {
    const { runtime, renameThread, initial } = await setup();
    const trigger = runtime.querySelector<HTMLButtonElement>('.flower-chat-header-rename')!;
    expect(trigger.getAttribute('aria-label')).toBe('Rename conversation');
    expect(trigger.title).toBe('Rename conversation');
    expect(trigger.closest('.flower-chat-header-identity')).not.toBeNull();
    expect(getComputedStyle(trigger).cursor).toBe('pointer');
    expect(trigger.querySelector('svg')).not.toBeNull();
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const input = runtime.querySelector<HTMLInputElement>('.flower-chat-header-title-input')!;
    expect(input.closest('.flower-chat-header-identity')).not.toBeNull();
    expect(runtime.querySelector('.flower-rename-dialog')).toBeNull();
    await waitFor(() => document.activeElement === input);
    expect(input.value).toBe(initial.title);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(initial.title.length);
    expect(runtime.querySelector<HTMLButtonElement>('.flower-chat-header-rename')!.disabled).toBe(false);
    await userEvent.fill(input, 'Release checklist');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    expect(renameThread).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => !runtime.querySelector('.flower-chat-header-title-input'));
    expect(renameThread).toHaveBeenCalledExactlyOnceWith('thread-1', 'Release checklist');
    expect(runtime.querySelector('.flower-chat-header-title')?.textContent).toBe('Release checklist');
    expect(runtime.querySelector('[data-thread-id="thread-1"]')?.textContent).toContain('Release checklist');
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps edits after a failed save and cancels with Escape without changing the title', async () => {
    const { runtime, renameThread, initial } = await setup();
    renameThread.mockRejectedValueOnce(new Error('Title could not be saved'));
    const trigger = runtime.querySelector<HTMLButtonElement>('.flower-chat-header-rename')!;
    await userEvent.click(trigger);
    const input = runtime.querySelector<HTMLInputElement>('.flower-chat-header-title-input')!;
    await userEvent.fill(input, 'Unsaved title');
    await userEvent.click(runtime.querySelector<HTMLButtonElement>('.flower-chat-header-rename')!);
    await waitFor(() => !!runtime.querySelector('.flower-chat-header-title-error'));
    expect(input.value).toBe('Unsaved title');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(runtime.querySelector('[data-thread-id="thread-1"]')?.textContent).toContain(initial.title);
    await userEvent.click(input);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => !runtime.querySelector('.flower-chat-header-title-input'));
    expect(renameThread).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    await userEvent.click(trigger);
    expect(runtime.querySelector<HTMLInputElement>('.flower-chat-header-title-input')!.value).toBe(initial.title);
  });

  it('keeps the pencil visible beside a long title on a narrow header while work is running', async () => {
    const initial = thread({ title: 'A long conversation title '.repeat(8).trim(), title_status: 'ready', status: 'running' });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true), listThreads: vi.fn(async () => [initial]),
      loadThread: vi.fn(async () => liveBootstrap(initial)), renameThread: vi.fn(),
    });
    await waitFor(() => !!runtime.querySelector('[data-thread-id="thread-1"] button'));
    runtime.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
    await waitFor(() => !!runtime.querySelector('.flower-chat-header-rename'));
    await page.viewport(390, 844);
    await touchCommands.emulateTouchInput(true);
    const trigger = runtime.querySelector<HTMLButtonElement>('.flower-chat-header-rename')!;
    const title = runtime.querySelector<HTMLElement>('.flower-chat-header-title')!;
    const header = runtime.querySelector<HTMLElement>('.flower-chat-header')!;
    const triggerBounds = trigger.getBoundingClientRect();
    expect(triggerBounds.width).toBeGreaterThanOrEqual(44);
    expect(triggerBounds.height).toBeGreaterThanOrEqual(44);
    expect(triggerBounds.right).toBeLessThanOrEqual(header.getBoundingClientRect().right);
    expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(triggerBounds.left);
    expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
    await userEvent.click(trigger);
    const input = runtime.querySelector<HTMLInputElement>('.flower-chat-header-title-input')!;
    expect(input.value).toBe(initial.title.trim());
    expect(input.getBoundingClientRect().width).toBeGreaterThan(120);
    expect(input.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    const actions = runtime.querySelector<HTMLElement>('.flower-chat-header-actions')!;
    expect(getComputedStyle(actions).display).not.toBe('none');
    expect(actions.getBoundingClientRect().top).toBeGreaterThanOrEqual(input.getBoundingClientRect().bottom);
    const cancel = runtime.querySelector<HTMLButtonElement>('.flower-chat-header-rename-cancel')!;
    expect(cancel.getBoundingClientRect().right).toBeLessThanOrEqual(header.getBoundingClientRect().right);
    expect(input.getBoundingClientRect().right).toBeLessThanOrEqual(trigger.getBoundingClientRect().left);
  });

  it('omits the shortcut when the host cannot rename conversations', async () => {
    const runtime = renderSurfaceWithAdapter(adapter(true));
    await waitFor(() => !!runtime.querySelector('[data-thread-id="thread-1"] button'));
    runtime.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
    await waitFor(() => runtime.querySelector('.flower-chat-header-title')?.textContent === 'Deploy plan');
    expect(runtime.querySelector('.flower-chat-header-rename')).toBeNull();
  });

  it('saves on blur without stealing focus from the composer', async () => {
    const { runtime, renameThread } = await setup();
    await userEvent.click(runtime.querySelector<HTMLButtonElement>('.flower-chat-header-rename')!);
    const input = runtime.querySelector<HTMLInputElement>('.flower-chat-header-title-input')!;
    await userEvent.fill(input, 'Saved from the header');
    const composer = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    await userEvent.click(composer);
    await waitFor(() => !runtime.querySelector('.flower-chat-header-title-input'));
    expect(renameThread).toHaveBeenCalledExactlyOnceWith('thread-1', 'Saved from the header');
    expect(document.activeElement).toBe(composer);
  });

  it('cancels from the inline button without saving and dismisses an unchanged or empty title', async () => {
    const { runtime, renameThread, initial } = await setup();
    const trigger = runtime.querySelector<HTMLButtonElement>('.flower-chat-header-rename')!;
    await userEvent.click(trigger);
    await userEvent.fill(runtime.querySelector<HTMLInputElement>('.flower-chat-header-title-input')!, 'Discard this');
    await userEvent.click(runtime.querySelector<HTMLButtonElement>('.flower-chat-header-rename-cancel')!);
    await waitFor(() => !runtime.querySelector('.flower-chat-header-title-input'));
    expect(document.activeElement).toBe(trigger);
    await userEvent.click(trigger);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => !runtime.querySelector('.flower-chat-header-title-input'));
    await userEvent.click(trigger);
    await userEvent.fill(runtime.querySelector<HTMLInputElement>('.flower-chat-header-title-input')!, '   ');
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!);
    await waitFor(() => !runtime.querySelector('.flower-chat-header-title-input'));
    expect(runtime.querySelector('.flower-chat-header-title')?.textContent).toBe(initial.title);
    expect(renameThread).not.toHaveBeenCalled();
  });

  it('admits one save and keeps a late result isolated after switching conversations', async () => {
    const other = thread({ thread_id: 'other', title: 'Another conversation', title_status: 'ready' });
    const { runtime, renameThread, initial } = await setup([other]);
    const pending = deferred<ReturnType<typeof liveBootstrap>>();
    renameThread.mockImplementationOnce(() => pending.promise);
    await userEvent.click(runtime.querySelector<HTMLButtonElement>('.flower-chat-header-rename')!);
    const input = runtime.querySelector<HTMLInputElement>('.flower-chat-header-title-input')!;
    await userEvent.fill(input, 'Slow rename');
    await userEvent.keyboard('{Enter}');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(input.readOnly).toBe(true);
    expect(renameThread).toHaveBeenCalledTimes(1);
    expect(runtime.querySelector<HTMLButtonElement>('.flower-chat-header-rename-cancel')!.disabled).toBe(true);
    await userEvent.click(runtime.querySelector<HTMLButtonElement>('[data-thread-id="other"] button')!);
    await waitFor(() => runtime.querySelector('.flower-chat-header-title')?.textContent === other.title);
    await userEvent.click(runtime.querySelector<HTMLButtonElement>('.flower-chat-header-rename')!);
    const otherInput = runtime.querySelector<HTMLInputElement>('.flower-chat-header-title-input')!;
    await userEvent.fill(otherInput, 'Keep this new draft');
    pending.resolve(liveBootstrap(thread({ ...initial, title: 'Slow rename', title_generation: 3 }), 2));
    await flush();
    expect(runtime.querySelector<HTMLInputElement>('.flower-chat-header-title-input')).toBe(otherInput);
    expect(otherInput.value).toBe('Keep this new draft');
    expect(otherInput.readOnly).toBe(false);
    expect(document.activeElement).toBe(otherInput);
    expect(runtime.querySelector('[data-thread-id="thread-1"]')?.textContent).toContain('Slow rename');
    expect(renameThread).toHaveBeenCalledTimes(1);
  });

  it('keeps composer focus when an explicit save finishes after the user moves on', async () => {
    const { runtime, renameThread, initial } = await setup();
    const pending = deferred<ReturnType<typeof liveBootstrap>>();
    renameThread.mockImplementationOnce(() => pending.promise);
    const trigger = runtime.querySelector<HTMLButtonElement>('.flower-chat-header-rename')!;
    trigger.focus();
    await userEvent.keyboard(' ');
    await userEvent.fill(runtime.querySelector<HTMLInputElement>('.flower-chat-header-title-input')!, 'Save while composing');
    await userEvent.keyboard('{Enter}');
    const composer = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    await userEvent.click(composer);
    pending.resolve(liveBootstrap(thread({ ...initial, title: 'Save while composing', title_generation: 3 }), 2));
    await waitFor(() => !runtime.querySelector('.flower-chat-header-title-input'));
    expect(runtime.querySelector('.flower-chat-header-title')?.textContent).toBe('Save while composing');
    expect(document.activeElement).toBe(composer);
  });

  it('retains sidebar rename in its existing dialog', async () => {
    const { runtime, renameThread } = await setup();
    runtime.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await waitFor(() => !!runtime.querySelector('.flower-rename-dialog'));
    expect(runtime.querySelector('.flower-chat-header-title-input')).toBeNull();
    await userEvent.fill(runtime.querySelector<HTMLInputElement>('.flower-rename-input')!, 'Sidebar title');
    await userEvent.click(runtime.querySelector<HTMLButtonElement>('.flower-rename-primary')!);
    await waitFor(() => !runtime.querySelector('.flower-rename-dialog'));
    expect(renameThread).toHaveBeenCalledExactlyOnceWith('thread-1', 'Sidebar title');
    expect(runtime.querySelector('.flower-chat-header-title')?.textContent).toBe('Sidebar title');
    const trigger = runtime.querySelector<HTMLButtonElement>('.flower-chat-header-rename')!;
    await userEvent.click(trigger);
    await userEvent.fill(runtime.querySelector<HTMLInputElement>('.flower-chat-header-title-input')!, 'Header title');
    await userEvent.click(trigger);
    await waitFor(() => !runtime.querySelector('.flower-chat-header-title-input'));
    expect(runtime.querySelector('.flower-chat-header-title')?.textContent).toBe('Header title');
    expect(document.activeElement).toBe(trigger);
  });
});
