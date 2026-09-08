import '../index.css';
import './flower-feature.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowerThreadList } from '../../../../flower_ui/src/threads/FlowerThreadList';
import type { FlowerThreadListItem } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const disposers: Array<() => void> = [];
afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  document.body.replaceChildren();
});

const thread: FlowerThreadListItem = {
  thread_id: 'directory-menu', title: 'Working directory navigation', title_status: 'ready',
  model_id: 'provider/model', working_dir: '/workspace/original', pinned: false,
  created_at_ms: 1, updated_at_ms: 1, preview: '', status: 'running', source_label: 'local',
  target_labels: [], read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } },
};

async function frames() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

describe('Flower directory menus in projected surfaces', () => {
  it.each(['pointer', 'button', 'keyboard'])('preserves the directory snapshot and local floating layer through refresh from %s', async (entry) => {
    await page.viewport(1000, 760);
    const host = document.createElement('div');
    host.setAttribute('data-floe-dialog-surface-host', 'true');
    host.style.cssText = 'position:relative;width:800px;height:720px;transform:translate(60px, 20px) scale(0.8);transform-origin:top left';
    document.body.appendChild(host);
    const [items, setItems] = createSignal<readonly FlowerThreadListItem[]>([thread]);
    const action = vi.fn();
    const select = vi.fn();
    disposers.push(render(() => (
      <FlowerThreadList items={items()} query="" activeThreadID="another-thread"
        onQueryChange={() => undefined} onRefresh={() => undefined} onSelect={select} onMenuAction={action}
        directoryActions={{ browse: { enabled: true }, terminal: { enabled: true } }}
        actionsBusy
      />
    ), host));
    await frames();
    const card = host.querySelector<HTMLElement>('[data-flower-thread-card]')!;
    const button = card.querySelector<HTMLButtonElement>('.flower-thread-card-menu-button')!;
    const selectButton = card.querySelector<HTMLButtonElement>('.flower-thread-card-select-button')!;
    if (entry === 'button') await userEvent.click(button);
    else if (entry === 'keyboard') {
      selectButton.focus();
      await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    } else {
      const rect = card.getBoundingClientRect();
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 100, clientY: rect.top + 10 }));
    }
    await frames();
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu).toBeTruthy();
    const layer = menu.closest('[data-floe-local-interaction-surface="true"]');
    expect(layer).toBeTruthy();
    expect(host.contains(layer)).toBe(true);
    expect(menu.style.position).not.toBe('fixed');
    expect(menu.style.left).toBe('');
    expect(menu.style.top).toBe('');
    expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(1000);

    setItems([{ ...thread, title: 'Updated title', working_dir: '/workspace/replaced', pinned: true }]);
    await frames();
    expect(document.querySelector('[role="menu"]')).toBe(menu);
    expect(menu.textContent).toContain('/workspace/original');
    expect(menu.textContent).not.toContain('/workspace/replaced');
    const browse = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent?.includes('Browse working directory'))!;
    expect(browse.getAttribute('aria-disabled')).toBe('false');
    await userEvent.click(browse);
    expect(action).toHaveBeenCalledExactlyOnceWith('browse_workdir', expect.objectContaining({ thread_id: thread.thread_id, working_dir: '/workspace/original' }), expect.any(HTMLElement));
    expect(select).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('keeps denied actions keyboard-readable with a reason and restores focus on Escape', async () => {
    await page.viewport(800, 600);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const action = vi.fn();
    disposers.push(render(() => (
      <FlowerThreadList items={[thread]} query="" onQueryChange={() => undefined} onRefresh={() => undefined}
        onSelect={() => undefined} onMenuAction={action}
        directoryActions={{ terminal: { enabled: false, reason: 'Execution permission required' } }}
      />
    ), host));
    const trigger = host.querySelector<HTMLButtonElement>('.flower-thread-card-menu-button')!;
    await userEvent.click(trigger);
    await frames();
    const terminal = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent?.includes('Open terminal in working directory'))!;
    terminal.focus();
    expect(terminal.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(terminal.getAttribute('aria-describedby')!)?.textContent).toBe('Execution permission required');
    await userEvent.keyboard('{Enter}');
    expect(action).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
