import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import '../index.css';
import './flower-feature.css';
import { adapter, liveBootstrap, renderSurfaceWithAdapter, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const touchCommands = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
beforeEach(() => page.viewport(1280, 900));
afterEach(() => touchCommands.emulateTouchInput(false));

async function setup() {
  const initial = thread({ title: 'Review the deployment plan', title_status: 'ready', title_generation: 2 });
  const renameThread = vi.fn(async (threadID: string, title: string) => liveBootstrap(thread({
    ...initial, thread_id: threadID, title, title_status: 'ready', title_generation: 3,
  }), 2));
  const runtime = renderSurfaceWithAdapter({
    ...adapter(true),
    listThreads: vi.fn(async () => [initial]),
    loadThread: vi.fn(async () => liveBootstrap(initial)),
    renameThread,
  });
  await waitFor(() => !!runtime.querySelector('[data-thread-id="thread-1"] button'));
  expect(runtime.querySelector('.flower-chat-header-rename')).toBeNull();
  runtime.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
  await waitFor(() => !!runtime.querySelector('.flower-chat-header-rename'));
  return { runtime, renameThread, initial };
}

describe('Flower title rename shortcut', () => {
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
    const input = runtime.querySelector<HTMLInputElement>('.flower-rename-input')!;
    await waitFor(() => document.activeElement === input);
    expect(input.value).toBe(initial.title);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(initial.title.length);
    expect(runtime.querySelector<HTMLButtonElement>('.flower-rename-primary')!.disabled).toBe(true);
    await userEvent.fill(input, 'Release checklist');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    expect(renameThread).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => !runtime.querySelector('.flower-rename-dialog'));
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
    const input = runtime.querySelector<HTMLInputElement>('.flower-rename-input')!;
    await userEvent.fill(input, 'Unsaved title');
    await userEvent.click(runtime.querySelector<HTMLButtonElement>('.flower-rename-primary')!);
    await waitFor(() => !!runtime.querySelector('.flower-rename-error'));
    expect(input.value).toBe('Unsaved title');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(runtime.querySelector('.flower-chat-header-title')?.textContent).toBe(initial.title);
    await userEvent.click(input);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => !runtime.querySelector('.flower-rename-dialog'));
    expect(renameThread).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    await userEvent.click(trigger);
    expect(runtime.querySelector<HTMLInputElement>('.flower-rename-input')!.value).toBe(initial.title);
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
    expect(runtime.querySelector<HTMLInputElement>('.flower-rename-input')!.value).toBe(initial.title.trim());
  });

  it('omits the shortcut when the host cannot rename conversations', async () => {
    const runtime = renderSurfaceWithAdapter(adapter(true));
    await waitFor(() => !!runtime.querySelector('[data-thread-id="thread-1"] button'));
    runtime.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
    await waitFor(() => runtime.querySelector('.flower-chat-header-title')?.textContent === 'Deploy plan');
    expect(runtime.querySelector('.flower-chat-header-rename')).toBeNull();
  });
});
