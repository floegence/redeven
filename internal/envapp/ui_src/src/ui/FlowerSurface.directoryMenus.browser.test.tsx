import '../index.css';
import './flower-feature.css';
import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

function menuAction(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[role=menuitem]'))
    .find(item => item.textContent?.includes(label));
  expect(button, label).toBeTruthy();
  return button!;
}

describe('Flower conversation directory menus', () => {
  it.each([false, true])('keeps directory favorites out of conversation actions (already saved: %s)', async saved => {
    await page.viewport(1280, 900);
    const wasDark = document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', saved);
    onTestFinished(() => { document.documentElement.classList.toggle('dark', wasDark); });
    const selected = thread({ thread_id: 'directory-a', title: 'Current conversation', working_dir: '/workspace/a' });
    const other = thread({ thread_id: 'directory-b', title: 'Other conversation', working_dir: '/workspace/b' });
    const onSetFavorite = vi.fn(async () => undefined);
    const openFiles = vi.fn(async () => undefined);
    const openTerminal = vi.fn(async () => undefined);
    const loadThread = vi.fn(async (id: string) => liveBootstrap(id === selected.thread_id ? selected : other));
    const setThreadPinned = vi.fn(async (threadID: string, pinned: boolean) => pinned
      ? [{ thread_id: threadID, pinned_at_ms: 1, pin_rank: 0, settings_revision: 1 }] : []);
    const surface = renderSurfaceWithAdapterProps({ ...adapter(),
      listThreads: async () => [selected, other], loadThread, setThreadPinned,
      directoryFavorites: () => ({ paths: saved ? [selected.working_dir, other.working_dir] : [], editable: true, onSetFavorite }),
      openWorkingDirectoryInFileBrowser: openFiles, openWorkingDirectoryInTerminal: openTerminal,
    }, { layout: true });
    surface.style.cssText = 'width:1280px;height:850px;position:relative;';
    await waitFor(() => !!surface.querySelector('[data-thread-id=directory-a] button'));
    await userEvent.click(surface.querySelector<HTMLButtonElement>('[data-thread-id=directory-a] .flower-thread-card-select-button')!);
    await waitFor(() => surface.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === selected.thread_id
      && surface.querySelector('main')?.getAttribute('data-flower-selected-thread-loading') === 'false');

    for (const entry of ['transcript', 'thread', 'more'] as const) {
      const row = surface.querySelector<HTMLElement>('[data-thread-id=directory-b]')!;
      if (entry === 'more') await userEvent.click(row.querySelector<HTMLButtonElement>('.flower-thread-card-menu-button')!);
      else {
        const target = entry === 'transcript' ? surface.querySelector<HTMLElement>('.flower-chat-transcript')! : row;
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 180 }));
      }
      await waitFor(() => !!document.querySelector('[role=menu]'));
      const labels = Array.from(document.querySelectorAll('[role=menuitem]')).map(item => item.textContent?.trim());
      expect(labels).not.toContain('Favorite');
      expect(labels).not.toContain('Unfavorite');
      await page.screenshot({ element: document.querySelector<HTMLElement>('[role=menu]')!,
        path: `__screenshots__/flower-directory-menu-${entry}-${saved ? 'dark' : 'light'}.png` });
      for (const label of ['Browse working directory', 'Open terminal in working directory', 'Copy working directory']) {
        expect(menuAction(label).getAttribute('aria-disabled')).not.toBe('true');
      }
      if (entry === 'transcript') {
        await userEvent.click(menuAction('Browse working directory'));
        expect(openFiles).toHaveBeenCalledExactlyOnceWith({ thread_id: selected.thread_id, path: selected.working_dir });
      } else if (entry === 'thread') {
        expect(menuAction('Pin conversation').getAttribute('aria-disabled')).not.toBe('true');
        await userEvent.click(menuAction('Open terminal in working directory'));
        expect(openTerminal).toHaveBeenCalledExactlyOnceWith({ thread_id: other.thread_id, path: other.working_dir });
      } else {
        await userEvent.click(menuAction('Pin conversation'));
        await expect.poll(() => setThreadPinned.mock.calls).toEqual([[other.thread_id, true]]);
      }
      await waitFor(() => !document.querySelector('[role=menu]'));
    }
    expect(onSetFavorite).not.toHaveBeenCalled();
    expect(loadThread.mock.calls.map(([id]) => id)).not.toContain(other.thread_id);
    expect(surface.querySelector('main')?.getAttribute('data-flower-selected-thread-id')).toBe(selected.thread_id);
  });
});
