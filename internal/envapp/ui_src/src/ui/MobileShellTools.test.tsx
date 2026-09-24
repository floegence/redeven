// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileShellTools, handleMobileToolsEscape, type MobileToolsPage } from './MobileShellTools';
import type { DownloadManager, DownloadTask } from './downloads/types';

vi.mock('./EnvAppThemePicker', () => ({ EnvAppThemePicker: () => <div data-inline-appearance /> }));
vi.mock('./i18n/LanguagePreferenceMenu', () => ({ LanguagePreferenceMenu: () => <div data-inline-language /> }));

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose());
  document.body.replaceChildren();
});

function mountTools() {
  const [page, setPage] = createSignal<MobileToolsPage>('more');
  const [tasks, setTasks] = createSignal<readonly DownloadTask[]>([]);
  const [activeCount, setActiveCount] = createSignal(0);
  const manager: DownloadManager = {
    tasks, activeCount, latestTask: () => tasks()[0] ?? null,
    getTask: id => tasks().find(task => task.id === id),
    enqueue: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
    reveal: vi.fn(), open: vi.fn(), clearFinished: vi.fn(),
  };
  const actions = { search: vi.fn(), notes: vi.fn(), dashboard: vi.fn(), close: vi.fn() };
  const host = document.createElement('div');
  document.body.appendChild(host);
  disposers.push(render(() => <div onKeyDown={event => handleMobileToolsEscape(event, page(), () => setPage('more'))}>
    <MobileShellTools page={page()} onPageChange={setPage}
    onSearch={actions.search} onNotes={actions.notes} onDashboard={actions.dashboard} onClose={actions.close}
    manager={manager} notify={{ success: vi.fn() }}
    theme={{ onSourceChange: vi.fn(), onShellThemeChange: vi.fn() }} /></div>, host));
  const click = (id: string) => host.querySelector<HTMLButtonElement>(`[data-mobile-tool="${id}"]`)!.click();
  return { host, page, setPage, setTasks, setActiveCount, actions, click };
}

describe('MobileShellTools', () => {
  it('hands commands to the shell and returns from every subpage before closing', () => {
    const tools = mountTools();
    expect(tools.host.querySelectorAll('[data-mobile-tool]')).toHaveLength(6);
    for (const id of ['search', 'notes', 'dashboard'] as const) {
      tools.click(id);
      expect(tools.actions[id]).toHaveBeenCalledOnce();
    }
    for (const id of ['downloads', 'language', 'appearance'] as const) {
      tools.click(id);
      expect(tools.page()).toBe(id);
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      tools.host.firstElementChild!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(tools.page()).toBe('more');
    }
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    tools.host.firstElementChild!.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    tools.host.querySelector<HTMLButtonElement>('[data-floe-autofocus]')!.click();
    expect(tools.actions.close).toHaveBeenCalledOnce();
  });

  it('updates download feedback from the existing manager while the menu stays open', () => {
    const tools = mountTools();
    const row = () => tools.host.querySelector('[data-mobile-tool="downloads"]')!;
    tools.setActiveCount(3);
    expect(row().textContent).toContain('3');
    tools.setActiveCount(0);
    tools.setTasks([{
      id: 'failed-task', status: 'failed', createdAt: 1, bytesRead: 0, cancelable: false,
      platform: 'web_blob', command: { entryKind: 'file', origin: 'file_browser_context_menu',
        source: { kind: 'runtime_file', path: '/workspace/example.txt', name: 'example.txt' } },
    }]);
    expect(row().textContent).toContain('!');
    tools.setTasks([]);
    expect(row().textContent).not.toContain('!');
  });

  it('returns to the top of the tools list after leaving a long subpage', () => {
    const tools = mountTools();
    tools.click('appearance');
    const viewport = tools.host.querySelector<HTMLElement>('.mobile-shell-tools > div')!;
    viewport.scrollTop = 120;
    tools.setPage('more');
    expect(viewport.scrollTop).toBe(0);
  });
});
