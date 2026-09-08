// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adapter, deferred, flush, liveBootstrap, renderSurfaceWithAdapter, thread, waitFor,
} from './FlowerSurface.navigation.testHarness';
import type { FlowerSurfaceAdapter } from '../../../../flower_ui/src';

afterEach(() => vi.unstubAllGlobals());

function openMenu(target: HTMLElement): void {
  target.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: 120, clientY: 100,
  }));
}

function menuAction(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    .find((item) => item.textContent?.includes(label));
  expect(button, label).toBeTruthy();
  return button!;
}

async function fixture(overrides: Partial<FlowerSurfaceAdapter> = {}) {
  const a = thread({ thread_id: 'directory-a', title: 'Task A', working_dir: '/workspace/a' });
  const b = thread({ thread_id: 'directory-b', title: 'Task B', working_dir: '/workspace/中文 folder\'s;$HOME' });
  const openFiles = vi.fn(async () => undefined);
  const openTerminal = vi.fn(async () => undefined);
  const loadThread = vi.fn(async (id: string) => liveBootstrap(id === a.thread_id ? a : b));
  const surface = renderSurfaceWithAdapter({
    ...adapter(), listThreads: async () => [a, b], loadThread,
    openWorkingDirectoryInFileBrowser: openFiles,
    openWorkingDirectoryInTerminal: openTerminal,
    ...overrides,
  });
  await waitFor(() => Boolean(surface.querySelector('[data-thread-id="directory-a"] button')));
  (surface.querySelector('[data-thread-id="directory-a"] button') as HTMLButtonElement).click();
  await waitFor(() => surface.querySelector('main')?.getAttribute('data-flower-selected-thread-loading') === 'false');
  return { surface, a, b, openFiles, openTerminal, loadThread };
}

describe('Flower working directory actions', () => {
  it('opens the right-clicked thread directory without selecting or loading that thread', async () => {
    const { surface, b, openFiles, loadThread } = await fixture();
    openMenu(surface.querySelector('[data-thread-id="directory-b"]')!);
    menuAction('Browse working directory').click();
    await flush();
    expect(openFiles).toHaveBeenCalledExactlyOnceWith({ thread_id: b.thread_id, path: b.working_dir });
    expect(loadThread.mock.calls.map(([id]) => id)).not.toContain(b.thread_id);
    expect(surface.querySelector('main')?.getAttribute('data-flower-selected-thread-id')).toBe('directory-a');
  });

  it('uses the selected thread directory from the transcript and does not reclaim handed-off focus', async () => {
    const { surface, a, openTerminal } = await fixture();
    const terminalInput = document.createElement('textarea');
    document.body.appendChild(terminalInput);
    openTerminal.mockImplementation(async () => { terminalInput.focus(); });
    openMenu(surface.querySelector('.flower-chat-transcript')!);
    menuAction('Open terminal in working directory').click();
    await flush();
    expect(openTerminal).toHaveBeenCalledExactlyOnceWith({ thread_id: a.thread_id, path: a.working_dir });
    expect(document.activeElement).toBe(terminalInput);
  });

  it('keeps links and editable controls under their own context-menu ownership', async () => {
    const { surface } = await fixture();
    const transcript = surface.querySelector('.flower-chat-transcript')!;
    for (const tag of ['a', 'input', 'textarea']) {
      const control = document.createElement(tag);
      if (control instanceof HTMLAnchorElement) control.href = 'https://example.com';
      transcript.appendChild(control);
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      control.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(document.querySelector('[role="menu"]')).toBeNull();
    }
  });

  it('copies the exact local selection captured before the menu receives focus', async () => {
    const { surface } = await fixture();
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const transcript = surface.querySelector<HTMLElement>('.flower-chat-transcript')!;
    const text = document.createElement('p');
    text.textContent = '  selected text\nwith whitespace  ';
    transcript.appendChild(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const expected = selection.toString();
    openMenu(text);
    selection.removeAllRanges();
    menuAction('Copy selected text').click();
    await flush();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it('does not copy a selection from another surface or close on an automatic transcript scroll', async () => {
    const { surface } = await fixture();
    const outside = document.createElement('p');
    outside.textContent = 'Another widget';
    document.body.appendChild(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const transcript = surface.querySelector<HTMLElement>('.flower-chat-transcript')!;
    openMenu(transcript);
    const menu = document.querySelector('[role="menu"]');
    expect(menu?.textContent).not.toContain('Copy selected text');
    transcript.dispatchEvent(new Event('scroll'));
    await flush();
    expect(document.querySelector('[role="menu"]')).toBe(menu);
    selection.removeAllRanges();
  });

  it('uses the same terminal action from the row menu button and preserves handed-off focus', async () => {
    const { surface, b, openTerminal } = await fixture();
    const destination = document.createElement('textarea');
    document.body.appendChild(destination);
    openTerminal.mockImplementation(async () => { destination.focus(); });
    (surface.querySelector('[data-thread-id="directory-b"] .flower-thread-card-menu-button') as HTMLButtonElement).click();
    menuAction('Open terminal in working directory').click();
    await flush();
    expect(openTerminal).toHaveBeenCalledExactlyOnceWith({ thread_id: b.thread_id, path: b.working_dir });
    expect(document.activeElement).toBe(destination);
  });

  it('disables a pending transcript directory instead of using the previous thread path', async () => {
    const pending = deferred<ReturnType<typeof liveBootstrap>>();
    const { surface, openFiles } = await fixture({
      loadThread: async (id) => id === 'directory-b' ? pending.promise : liveBootstrap(thread({ thread_id: id, working_dir: '/workspace/a' })),
    });
    (surface.querySelector('[data-thread-id="directory-b"] button') as HTMLButtonElement).click();
    await waitFor(() => surface.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === 'directory-b');
    openMenu(surface.querySelector('.flower-chat-transcript')!);
    const browse = menuAction('Browse working directory');
    expect(browse.getAttribute('aria-disabled')).toBe('true');
    expect(document.querySelector('.flower-directory-menu-path')?.textContent).not.toContain('/workspace/a');
    browse.click();
    expect(openFiles).not.toHaveBeenCalled();
    pending.resolve(liveBootstrap(thread({ thread_id: 'directory-b', working_dir: '/workspace/b' })));
    await flush();
  });

  it('keeps file navigation independent of AI mutation permission and terminal permission', async () => {
    const { surface, openFiles, openTerminal } = await fixture({
      canMutate: false,
      workingDirectoryActionAvailability: () => ({ browse: { enabled: true }, terminal: { enabled: false, reason: 'Execution permission required' } }),
    });
    openMenu(surface.querySelector('[data-thread-id="directory-b"]')!);
    const terminal = menuAction('Open terminal in working directory');
    expect(terminal.getAttribute('aria-disabled')).toBe('true');
    terminal.click();
    expect(openTerminal).not.toHaveBeenCalled();
    menuAction('Browse working directory').click();
    await flush();
    expect(openFiles).toHaveBeenCalledTimes(1);
  });

  it('dismisses the transcript menu when clicking elsewhere inside the transcript', async () => {
    const { surface } = await fixture();
    const transcript = surface.querySelector<HTMLElement>('.flower-chat-transcript')!;
    openMenu(transcript);
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    transcript.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await flush();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
